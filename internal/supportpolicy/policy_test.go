package supportpolicy

import (
	"testing"
	"time"
)

// TestScopedKnowledgeAndFAQ 验证商品优先、店铺隔离、全局回退和精确问题匹配。
func TestScopedKnowledgeAndFAQ(t *testing.T) {
	// cfg 是三个归属层级和两个店铺的合成配置。
	cfg := Config{Enabled: true, Entries: []Entry{
		{Scope: "global", Title: "通用", Question: "怎么使用？", Answer: "请阅读说明书"},
		{Scope: "account", AccountID: "a", Title: "店铺", Question: "怎么使用", Answer: "请查看店铺教程"},
		{Scope: "item", AccountID: "a", ItemID: "1", Title: "商品", Question: "怎么使用", Answer: "先打开安装说明"},
		{Scope: "item", AccountID: "b", ItemID: "1", Title: "其他店铺", Answer: "另一店铺私有资料"},
	}}
	// plan 是当前账号商品的匹配结果。
	plan := cfg.Resolve("a", "1", "怎么使用？")
	if plan.Answer != "先打开安装说明" || plan.Scope != "item" {
		t.Fatal("未使用商品专属 FAQ")
	}
	// other 是另一账号非匹配商品的全局回退结果。
	if other := cfg.Resolve("b", "2", "怎么使用"); other.Answer != "请阅读说明书" {
		t.Fatal("未正确回退全局")
	}
	// mixed 是包含附加高风险诉求而不允许命中 FAQ 的消息。
	if mixed := cfg.Resolve("a", "1", "怎么使用？我要退款"); mixed.Answer != "" || mixed.Reason == "" {
		t.Fatal("风险问题不应匹配 FAQ")
	}
	// other 验证另一店铺的事实与无关 FAQ 均未注入。
	if other := cfg.Resolve("a", "1", "使用说明"); other.Facts != "" {
		t.Fatal("不应跨店铺或把无关 FAQ 当作事实")
	}
}

// TestQualityAndTakeoverRules 验证本地规则拒绝秘密、错误承诺、空回复和超长回复，以及持久化暂停时间语义。
func TestQualityAndTakeoverRules(t *testing.T) {
	// reply 是不同高风险候选回复。
	for _, reply := range []string{"", "提取码：abcd", "请打开 https://pan.example/a", "保证退款", "您的手机号 13800138000"} {
		if CheckReply(reply, false) == "" {
			t.Fatal("危险回复未拒绝")
		}
	}
	if CheckReply("付款后请查看订单中的交付说明。", false) != "" {
		t.Fatal("正常说明被拒绝")
	}
	// now 是固定测试时刻。
	now := time.Unix(1000, 0)
	if !(Takeover{Until: -1}).Active(now) || (Takeover{Until: 999}).Active(now) || (Takeover{}).Active(now) {
		t.Fatal("暂停时间判断错误")
	}
	if TakeoverKey("a", "chat@goofish") != TakeoverKey("a", "chat") || TakeoverKey("a", "chat") == TakeoverKey("b", "chat") {
		t.Fatal("会话键隔离错误")
	}
}
