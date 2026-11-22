package engine

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"xianyu-go/internal/supportpolicy"
)

// TestLocalOllamaMovieKnowledgePriority 仅显式启用时以本机模型验证旧电影票描述不会覆盖已核实的网盘事实。
func TestLocalOllamaMovieKnowledgePriority(t *testing.T) {
	if os.Getenv("RUN_LOCAL_OLLAMA_MOVIE") != "1" {
		t.Skip("需要显式启用本机 Ollama 电影知识测试")
	}
	// replier、store 是只使用临时 SQLite 的合成客服环境，不访问真实闲鱼和买家。
	replier, store, _ := setupGapAI(t, "full_service")
	// ctx 将单轮本地模型响应限制在两分钟内。
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	// options 是本机 Ollama 兼容接口使用的非敏感运行时设置。
	options := map[string]string{
		"ai_api_key": "ollama",
		"ai_api_url": "http://127.0.0.1:11434/v1",
		"ai_model":   "qwen3.5:9b-q4_K_M",
	}
	// key、value 是待写入测试数据库的设置。
	for key, value := range options {
		// err 是当前测试设置写入失败原因。
		if err := store.Settings.Set(ctx, key, value); err != nil {
			t.Fatal(err)
		}
	}
	// err 模拟一个历史商品把网盘影视资源错误描述为电影票代购的情况。
	if _, err := store.DB.ExecContext(ctx, `INSERT INTO item_info (cookie_id,item_id,item_title,item_price,item_description)
VALUES ('cid','movie-test','特价电影票《幻视任务》全8大结局完结','8.00','全国代订电影票，代买代购服务')`); err != nil {
		t.Fatal(err)
	}
	// owner、err 是隔离测试账号的所有者身份。
	owner, err := store.Cookies.GetOwnerID(ctx, "cid")
	if err != nil {
		t.Fatal(err)
	}
	// knowledge 是商家确认的全局电影类型和真实交付方式。
	knowledge := supportpolicy.Config{Enabled: true, Entries: []supportpolicy.Entry{{
		Scope: "global", Title: "电影类商品统一说明",
		Answer: "本店所有电影类商品都是网盘电子资源，不是电影票代买、代购、代订服务。电影资源均为高清版本、带中文字幕，通过百度网盘和夸克网盘双盘发货。即使旧商品描述写着电影票代订也应以商家核实的实际交付事实为准。",
	}}}
	// raw、err 是经过相同策略解码器校验的合成公开知识配置。
	raw, err := json.Marshal(knowledge)
	if err != nil {
		t.Fatal(err)
	}
	// err 是合成知识校验异常；保存前必须经过同样的受控验证。
	if _, err := supportpolicy.Decode(string(raw)); err != nil {
		t.Fatal(err)
	}
	// err 是隔离数据库知识保存失败原因。
	if err := store.UserSettings.SetForUser(ctx, owner, supportpolicy.ConfigKey, string(raw)); err != nil {
		t.Fatal(err)
	}
	// reply、err 是真实本机模型按错误历史上架标题与权威知识生成的无投递沙盒结果。
	reply, err := replier.PreviewSupport(ctx, "movie-test", "高清吗")
	if err != nil || reply == nil {
		t.Fatalf("电影知识沙盒失败: %v", err)
	}
	t.Logf("MOVIE_PREVIEW source=%q manual=%v text=%q reason=%q", reply.Source, reply.NotifyManual, reply.Text, reply.ManualReason)
	if reply.NotifyManual || !strings.Contains(reply.Text, "高清") || !strings.Contains(reply.Text, "网盘") {
		t.Fatal("未能按已核实知识说明高清网盘资源")
	}
	if strings.Contains(reply.Text, "电影票代订服务") && !strings.Contains(reply.Text, "不是电影票代订服务") {
		t.Fatal("仍错误地将网盘商品解释为电影票代买服务")
	}
}
