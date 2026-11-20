package db

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"xianyu-go/internal/supportpolicy"
)

// TestMultiDB_CustomerSupportAndCollectorIsolation 验证新增客服存储与采集幂等查询在真实三方言中的隔离及并发语义。
func TestMultiDB_CustomerSupportAndCollectorIsolation(t *testing.T) {
	// target 是各方言独立建立的临时数据库，不连接业务库。
	for _, target := range allTestTargets(t) {
		t.Run(target.name, func(t *testing.T) {
			defer target.cleanup()
			// ctx 是本轮隔离数据库访问的固定上下文。
			ctx := context.Background()
			// store 是当前方言的测试仓储。
			store := target.store
			// userID、accountID 是第一个测试用户及店铺。
			userID, accountID := seedAccount(t, store)
			// created、err 创建独立所有者。
			created, err := store.Users.Create(ctx, "support-other", "support-other@example.invalid", "fixture-password")
			if err != nil || !created {
				t.Fatal("独立测试用户创建失败", err)
			}
			// other、err 查询另一个用户主键。
			other, err := store.Users.GetByUsername(ctx, "support-other")
			if err != nil {
				t.Fatal(err)
			}
			// err 保存第二个纯测试账号，不会启动任何账号运行时。
			if err := store.Cookies.Save(ctx, "support-other-account", "fixture-only", other.ID); err != nil {
				t.Fatal(err)
			}
			// raw 是第一位用户私有知识，不包含真实业务信息。
			raw := `{"enabled":true,"entries":[{"scope":"global","account_id":"","item_id":"","title":"测试资料","question":"怎么使用","answer":"请查看测试说明"}]}`
			// err 验证配置持久化。
			if err := store.UserSettings.SetForUser(ctx, userID, supportpolicy.ConfigKey, raw); err != nil {
				t.Fatal(err)
			}
			// repo 是实际客服仓储。
			repo := NewSupportRepository(store)
			// cfg、err 读取第一个用户的知识并匹配。
			cfg, err := repo.Load(ctx, accountID)
			if err != nil || !cfg.Enabled || cfg.Resolve(accountID, "", "怎么使用？").Answer != "请查看测试说明" {
				t.Fatal("知识读取或匹配失败", err)
			}
			// privateCfg、err 确认第二个用户不能读取第一个用户的配置。
			privateCfg, err := repo.Load(ctx, "support-other-account")
			if err != nil || privateCfg.Enabled || len(privateCfg.Entries) != 0 {
				t.Fatal("跨用户知识泄漏", err)
			}
			// group 等待所有并发的本地状态更新。
			var group sync.WaitGroup
			// failures 收集固定数量并发执行中的数据库错误。
			failures := make(chan error, 16)
			// index 控制八次风险接管与八次有限期人工接管。
			for index := 0; index < 16; index++ {
				group.Add(1)
				go func(index int) {
					defer group.Done()
					// until 是有限期人工窗口或无限期风险窗口。
					until := time.Now().Add(time.Minute).Unix()
					// reason 是固定的接管分类。
					reason := "human"
					if index%2 == 0 {
						until = -1
						reason = "risk"
					}
					failures <- repo.MarkTakeover(ctx, accountID, "fixture-chat", reason, until)
				}(index)
			}
			group.Wait()
			close(failures)
			// writeErr 是任何一个并发接管写入的错误。
			for writeErr := range failures {
				if writeErr != nil {
					t.Fatal(writeErr)
				}
			}
			// restarted 使用同一个数据库构造新的仓储。
			restarted := NewSupportRepository(store)
			// state、err 确认并发有限时长不能覆盖风险接管。
			state, err := restarted.ReadTakeover(ctx, accountID, "fixture-chat@goofish")
			if err != nil || state.Until != -1 || !state.Active(time.Now()) {
				t.Fatal("风险接管被缩短", err)
			}
			// foreign、err 查询另一账号的同名会话，不得继承接管。
			foreign, err := restarted.ReadTakeover(ctx, "support-other-account", "fixture-chat")
			if err != nil || foreign.Active(time.Now()) {
				t.Fatal("跨账号接管污染", err)
			}
			state.Until, state.Reason, state.UpdatedAt = 0, "resumed", time.Now().UnixMilli()
			// resumed、err 是显式人工恢复记录。
			resumed, err := json.Marshal(state)
			if err != nil {
				t.Fatal(err)
			}
			// err 验证恢复状态写入数据库。
			if err := store.UserSettings.SetSupportTakeover(ctx, userID, supportpolicy.TakeoverKey(accountID, "fixture-chat"), string(resumed)); err != nil {
				t.Fatal(err)
			}
			// after、err 是恢复后重新查询的独立状态。
			after, err := restarted.ReadTakeover(ctx, accountID, "fixture-chat")
			if err != nil || after.Active(time.Now()) || after.Reason != "resumed" {
				t.Fatal("人工恢复失败", err)
			}
			// template 是合成转存请求。
			template := ProductTemplate{UserID: userID, CollectorKey: "fixture-dedup", Name: "测试模板", Title: "原始标题", PriceCents: 100, Quantity: 1}
			// id、err 是首次模板落库结果。
			id, err := store.ProductTemplates.Create(ctx, template)
			if err != nil || id == 0 {
				t.Fatal("模板创建失败", err)
			}
			template.Title = "重复请求不能覆盖旧模板"
			// same、err 是相同摘要的再次创建结果。
			same, err := store.ProductTemplates.Create(ctx, template)
			if err != nil || same != id {
				t.Fatal("转存幂等失败", err)
			}
			// original、err 验证查询及内容未覆盖。
			original, err := store.ProductTemplates.FindByCollectorKey(ctx, userID, template.CollectorKey)
			if err != nil || original == nil || original.ID != id || original.Title != "原始标题" {
				t.Fatal("原模板被覆盖", err)
			}
			// err 是跨用户查询的明确拒绝结果。
			if _, err := store.ProductTemplates.FindByCollectorKey(ctx, other.ID, template.CollectorKey); !errors.Is(err, ErrNotFound) {
				t.Fatal("跨用户模板查询未隔离", err)
			}
		})
	}
}
