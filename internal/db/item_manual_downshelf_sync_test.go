package db

import (
	"context"
	"testing"
)

// TestManualDownShelfSurvivesFullSync 验证明确下架商品不因平台在售列表缺失而删除本地资料和发货规则。
func TestManualDownShelfSurvivesFullSync(t *testing.T) {
	// store、cleanup 是本次独立的 SQLite 测试数据库和释放回调，不访问用户真实商品。
	store, cleanup := newTestDB(t)
	defer cleanup()
	// ctx 是本轮持久化操作共享的生命周期。
	ctx := context.Background()
	// created、createErr 是测试账号归属用户的创建结果。
	created, createErr := store.Users.Create(ctx, "off-shelf-owner", "off-shelf-owner@example.com", "password")
	if createErr != nil || !created {
		t.Fatalf("创建测试用户失败: %v", createErr)
	}
	// user、userErr 是隔离的测试用户，不涉及真实登录凭证。
	user, userErr := store.Users.GetByUsername(ctx, "off-shelf-owner")
	if userErr != nil {
		t.Fatal(userErr)
	}
	// err 是准备测试账号凭证时的数据库错误。
	if err := store.Cookies.Save(ctx, "off-shelf-account", "unb=test", user.ID); err != nil {
		t.Fatal(err)
	}
	// oldItem 是已经由平台确认下架的商品，本地仍保留标题与图片。
	oldItem := &ItemInfoRow{CookieID: "off-shelf-account", ItemID: "off-item", ItemTitle: "旧商品", ItemDetail: `{"shelf_state":"off","item_image":"old.png"}`}
	// err 是写入下架测试商品时的数据库错误。
	if err := store.Items.Upsert(ctx, oldItem); err != nil {
		t.Fatal(err)
	}
	// ruleID、ruleErr 保存该商品原先配置的付款自动发货规则，必须在同步后仍然存在。
	ruleID, ruleErr := store.Automation.Create(ctx, AutomationRuleInput{
		UserID: user.ID, CookieID: "off-shelf-account", ItemID: "off-item", Name: "原商品发货",
		TriggerType: "order_paid", Enabled: true, Priority: 10, Actions: []AutomationActionInput{{ActionType: "send_text", MessageTemplate: "测试资料", Enabled: true}},
	})
	if ruleErr != nil || ruleID <= 0 {
		t.Fatalf("创建测试发货规则失败: %v", ruleErr)
	}
	// result、syncErr 是远端完整在售列表为空时的真实事务执行结果。
	result, syncErr := store.Items.SyncFromRemote(ctx, "off-shelf-account", nil)
	if syncErr != nil || result.Deleted != 0 {
		t.Fatalf("手动下架商品不得被同步删除: result=%+v err=%v", result, syncErr)
	}
	// item、itemErr 是同步后仍可供用户重新上架的本地商品。
	item, itemErr := store.Items.Get(ctx, "off-shelf-account", "off-item")
	if itemErr != nil || item.ItemTitle != "旧商品" {
		t.Fatalf("手动下架商品本地记录必须保留: %v", itemErr)
	}
	// matched、matchErr 是同步后依然存在的原商品发货规则匹配结果。
	matched, matchErr := store.Automation.Match(ctx, "off-shelf-account", "off-item", "order_paid")
	if matchErr != nil || len(matched) != 1 || matched[0].ID != ruleID {
		t.Fatalf("同步不可删除显式下架商品的发货规则: %v", matchErr)
	}
}
