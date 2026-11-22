package engine

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"xianyu-go/internal/db"
	"xianyu-go/internal/supportpolicy"
)

// TestVerifiedKnowledgeOverridesStaleMovieListingPrompt 验证商家核实的网盘商品事实优先于错误的旧票务描述。
func TestVerifiedKnowledgeOverridesStaleMovieListingPrompt(t *testing.T) {
	// oldListing 是尚未更改的历史商品文案，模拟把电影网盘资源写成代买电影票。
	oldListing := buildFullServicePrompt("", "特价电影票《幻视任务》", 8, "全国代订多地电影票，代买代购")
	// merchantFacts 是本地商家确认的全局商品类型与交付事实。
	merchantFacts := "电影类商品均是高清、中文字幕、百度网盘和夸克网盘双盘发货的电子资源，不是代买、代订电影票服务。"
	// prompt 是加入权威层级规则后的完整模型输入。
	prompt := appendVerifiedSupportKnowledge(oldListing, "电影类商品说明："+merchantFacts)
	if !strings.Contains(prompt, merchantFacts) || !strings.Contains(prompt, "已核实知识 > 可能过时或不准确的商品标题与描述") ||
		!strings.Contains(prompt, "不得称之为票务代订") || !strings.Contains(prompt, "全国代订多地电影票") {
		t.Fatal("没有在保留真实上架文本的同时明确提高商家核实知识的权重")
	}
	if strings.Index(prompt, "全国代订多地电影票") > strings.Index(prompt, merchantFacts) {
		t.Fatal("旧商品描述不得排在商家确认事实之后")
	}
	if appendVerifiedSupportKnowledge(oldListing, " ") != oldListing {
		t.Fatal("没有知识时不应改变原有模型输入")
	}
}

// TestCustomerSupportProductionAndSandbox 验证实际生成器共享知识、FAQ 和质量门禁，沙盒不写真实会话。
func TestCustomerSupportProductionAndSandbox(t *testing.T) {
	// replier、store、_ 是已配置全场景模式和本地假模型的隔离测试环境。
	replier, store, _ := setupGapAI(t, "full_service")
	// ctx 是仅使用测试 SQLite 与模拟模型的上下文。
	ctx := context.Background()
	// owner、err 是夹具的实际本地所有者。
	owner, err := store.Cookies.GetOwnerID(ctx, "cid")
	if err != nil {
		t.Fatal(err)
	}
	// cfg 是一条商品 FAQ 和一条其他店铺资料。
	cfg := supportpolicy.Config{Enabled: true, Entries: []supportpolicy.Entry{
		{Scope: "item", AccountID: "cid", ItemID: "item", Title: "教程", Question: "怎么使用", Answer: "请阅读安装说明。"},
		{Scope: "account", AccountID: "other", Title: "其他店铺资料", Answer: "其他店铺专属内容"},
	}}
	// raw、err 编码受控客服知识夹具。
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	// err 是本地配置保存异常。
	if err := store.UserSettings.SetForUser(ctx, owner, supportpolicy.ConfigKey, string(raw)); err != nil {
		t.Fatal(err)
	}
	// faq、err 是生产精确匹配结果，未调用真实模型。
	faq, err := replier.Reply(ctx, chatMsg("怎么使用？", "item", "chat"))
	if err != nil || faq == nil || faq.Source != "FAQ" || faq.Text != "请阅读安装说明。" {
		t.Fatal("实际 FAQ 回复不匹配")
	}
	// preview、err 是相同已保存配置的合成测试结果。
	preview, err := replier.PreviewSupport(ctx, "item", "怎么使用？")
	if err != nil || preview == nil || preview.Text != faq.Text || preview.Source != "FAQ" || preview.AutoPriceQuote != nil {
		t.Fatal("沙盒未复用 FAQ")
	}
	// blocked、err 是要求退款的风险消息，不能产生回复或报价。
	blocked, err := replier.PreviewSupport(ctx, "item", "我要退款")
	if err != nil || blocked == nil || !blocked.Skip || !blocked.NotifyManual || blocked.Text != "" || blocked.AutoPriceQuote != nil {
		t.Fatal("风险未拦截")
	}
	// unsafeModel 是返回私密链接的合成本地模型。
	unsafeModel := mockOpenAIServer(t, 0, "请打开 https://example.invalid/private")
	// err 是隔离测试模型地址写入错误。
	if err := store.Settings.Set(ctx, "ai_api_url", unsafeModel.URL); err != nil {
		t.Fatal(err)
	}
	// unsafe、err 验证真实模型调用的候选拒绝路径。
	unsafe, err := replier.PreviewSupport(ctx, "item", "可以介绍一下吗")
	if err != nil || unsafe == nil || !unsafe.Skip || unsafe.Text != "" || unsafe.ManualReason == "" {
		t.Fatal("危险模型输出未被拦截")
	}
	// count 统计测试中生成的真实对话历史，沙盒不得写入。
	var count int
	// err 是只读查询异常。
	if err := store.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM ai_conversations").Scan(&count); err != nil || count != 0 {
		t.Fatal("沙盒污染了真实对话")
	}
}

// TestCustomerSupportPersistentTakeover 使用真实 SQLite 和新的仓储实例验证跨运行时的接管记录及账号隔离。
func TestCustomerSupportPersistentTakeover(t *testing.T) {
	// store、cleanup 是真实临时 SQLite 与释放函数。
	store, cleanup := newAIStore(t)
	defer cleanup()
	// ctx 是本地数据库操作上下文。
	ctx := context.Background()
	// repo 是第一份客服状态仓储。
	repo := db.NewSupportRepository(store)
	// err 是风险接管的本地落库异常。
	if err := repo.MarkTakeover(ctx, "cid", "chat@goofish", "risk", -1); err != nil {
		t.Fatal(err)
	}
	// restarted 代表新的运行时使用同一个持久化数据库。
	restarted := db.NewSupportRepository(store)
	// state、err 是重新读取的原会话记录。
	state, err := restarted.ReadTakeover(ctx, "cid", "chat")
	if err != nil || !state.Active(time.Now()) || state.Reason != "risk" {
		t.Fatal("接管未持久化")
	}
	// other、err 验证另一会话未被暂停。
	other, err := restarted.ReadTakeover(ctx, "cid", "different")
	if err != nil || other.Active(time.Now()) {
		t.Fatal("接管污染其他会话")
	}
	// err 验证后续人工活动不能缩短无限期风险接管。
	if err := repo.MarkTakeover(ctx, "cid", "chat", "human", time.Now().Add(time.Minute).Unix()); err != nil {
		t.Fatal(err)
	}
	// state、err 读取未被缩短的接管。
	state, err = restarted.ReadTakeover(ctx, "cid", "chat")
	if err != nil || state.Until != -1 {
		t.Fatal("无限期接管被自动覆盖")
	}
}

// TestCustomerSupportGateStopsInFlightReply 验证生产回复协调器在模型生成期间发生接管时拒绝投递。
func TestCustomerSupportGateStopsInFlightReply(t *testing.T) {
	// fixture 提供真实本地数据库、模型替身和可观测的投递端口。
	fixture := newManualTakeoverFixture(t, 30, "all")
	// ctx 是合成的本地买家消息上下文。
	ctx := context.Background()
	// owner、err 是测试账号的非敏感所有者。
	owner, err := fixture.store.Cookies.GetOwnerID(ctx, "cid")
	if err != nil {
		t.Fatal(err)
	}
	// err 是受控客服模式的本地启用写入异常。
	if err := fixture.store.UserSettings.SetForUser(ctx, owner, supportpolicy.ConfigKey, `{"enabled":true,"entries":[]}`); err != nil {
		t.Fatal(err)
	}
	fixture.service.support = db.NewSupportRepository(fixture.store)
	fixture.ai.during = func() {
		// err 模拟模型生成期间商家手动接管。
		if err := fixture.service.support.MarkTakeover(ctx, "cid", "chat-1", "operator", -1); err != nil {
			t.Fatal(err)
		}
	}
	// message 是无真实买家数据的普通咨询。
	message := chatMsg("怎么使用", "item", "chat-1")
	// err 是实际回复协调器的投递结果。
	if err := fixture.service.Handle(ctx, message); err != nil {
		t.Fatal(err)
	}
	if fixture.ai.called != 1 || len(fixture.delivery.messages) != 0 {
		t.Fatal("人工接管后仍发送了正在生成的回复")
	}
	// err 是再次处理同会话时的结果；持久化状态应在生成之前拦截。
	if err := fixture.service.Handle(ctx, message); err != nil {
		t.Fatal(err)
	}
	if fixture.ai.called != 1 || len(fixture.delivery.messages) != 0 {
		t.Fatal("暂停会话仍发生生成或发送")
	}
}
