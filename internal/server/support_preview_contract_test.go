package server

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"xianyu-go/internal/supportpolicy"
)

// TestCustomerSupportHTTPContracts 验证真实登录路由中的配置、FAQ 沙盒和显式人工接管，不使用真实平台或模型。
func TestCustomerSupportHTTPContracts(t *testing.T) {
	// srv、_、cleanup 是隔离的真实 HTTP 服务、数据库和释放函数。
	srv, _, cleanup := newTestServer(t)
	defer cleanup()
	// handler 是用于记录 OpenAPI 成功响应覆盖的真实鉴权路由。
	handler := contractRecordingHandler(t, srv.Router())
	// session 是测试管理员的本地登录会话。
	session := loginHelper(t, handler)
	// ai 是已配置全场景但未启用真实回复的账号策略；沙盒仍可使用。
	ai := libraryRequest(t, handler, session, http.MethodPut, "/api/v1/settings/ai-reply/acc1", "application/json", []byte(`{"ai_enabled":false,"auto_adjust_price_enabled":false,"max_discount_percent":10,"max_discount_amount":100,"max_bargain_rounds":3,"custom_prompts":"","ai_mode":"full_service"}`))
	if ai.Code != 200 {
		t.Fatalf("AI 配置状态错误: %d", ai.Code)
	}
	// cfg 是不启用线上受控客服的知识草稿，便于在发布前试运行 FAQ。
	cfg := `{"enabled":false,"entries":[{"scope":"global","account_id":"","item_id":"","title":"教程","question":"怎么使用","answer":"请阅读安装说明。"}]}`
	// body、err 保存规范的用户设置请求。
	body, err := json.Marshal(map[string]string{"value": cfg})
	if err != nil {
		t.Fatal(err)
	}
	// saved 是知识库持久化接口的真实响应。
	saved := libraryRequest(t, handler, session, http.MethodPut, "/api/v1/settings/user/customer_support_v1", "application/json", body)
	if saved.Code != 200 {
		t.Fatalf("知识库保存失败: %d", saved.Code)
	}
	// preview 是真实沙盒路由命中的本地 FAQ 响应。
	preview := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/settings/support-preview", "application/json", []byte(`{"account_id":"acc1","item_id":"","message":"怎么使用？"}`))
	// result 是经过质量检查的沙盒响应 DTO。
	var result supportPreviewResponse
	// err 保存沙盒响应解析与状态断言。
	if err := json.Unmarshal(preview.Body.Bytes(), &result); err != nil || preview.Code != 200 || result.Decision != "pass" || result.Source != "FAQ" || result.Reply != "请阅读安装说明。" {
		t.Fatalf("FAQ 沙盒失败: %d", preview.Code)
	}
	// paused 是明确人工接管的持久化响应。
	paused := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/settings/support-takeover", "application/json", []byte(`{"account_id":"acc1","chat_id":"fixture-chat","paused":true}`))
	if paused.Code != 200 {
		t.Fatalf("接管失败: %d", paused.Code)
	}
	// resumed 是明确人工恢复的响应。
	resumed := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/settings/support-takeover", "application/json", []byte(`{"account_id":"acc1","chat_id":"fixture-chat","paused":false}`))
	if resumed.Code != 200 {
		t.Fatalf("恢复失败: %d", resumed.Code)
	}
	// forbidden 是未知账号请求，不允许绕过归属校验。
	forbidden := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/settings/support-preview", "application/json", []byte(`{"account_id":"missing-account","item_id":"","message":"怎么使用"}`))
	if forbidden.Code != http.StatusForbidden && forbidden.Code != http.StatusNotFound {
		t.Fatalf("未知账号未拒绝: %d", forbidden.Code)
	}
}

// TestCustomerSupportRejectsUnsafeAndForeignRequests 验证登录用户的知识、沙盒及接管入口拒绝越权和非法配置且不修改已有数据。
func TestCustomerSupportRejectsUnsafeAndForeignRequests(t *testing.T) {
	// srv、store、cleanup 是与实际路由一致的隔离测试服务。
	srv, store, cleanup := newTestServer(t)
	defer cleanup()
	// ctx 仅访问临时 SQLite 数据库。
	ctx := context.Background()
	// owner、err 查询夹具账号的实际所有者。
	owner, err := store.Cookies.GetOwnerID(ctx, "acc1")
	if err != nil {
		t.Fatal(err)
	}
	// created、err 创建另一个不拥有 acc1 的真实本地用户。
	created, err := store.Users.Create(ctx, "support-member", "support-member@example.invalid", "fixturepw")
	if err != nil || !created {
		t.Fatal("测试用户创建失败", err)
	}
	// handler 是真实鉴权路由。
	handler := srv.Router()
	// admin 是账号所有者的登录测试会话。
	admin := loginHelper(t, handler)
	// member 是不拥有该账号的独立测试会话。
	member := loginAsHelper(t, handler, "support-member", "fixturepw")
	// initial 是经过确认的合法配置，用于断言非法保存不覆盖原值。
	initial := `{"enabled":false,"entries":[]}`
	// err 验证合法配置已在本地持久化。
	if err := store.UserSettings.SetForUser(ctx, owner, supportpolicy.ConfigKey, initial); err != nil {
		t.Fatal(err)
	}
	// invalidConfigs 覆盖典型敏感凭证、非法归属、重复 FAQ 和损坏配置。
	invalidConfigs := []string{
		`{"enabled":true,"entries":[{"scope":"global","title":"测试","answer":"https://example.invalid/private"}]}`,
		`{"enabled":true,"entries":[{"scope":"global","title":"测试","answer":"卡密：fixture"}]}`,
		`{"enabled":true,"entries":[{"scope":"item","account_id":"acc1","item_id":"missing-item","title":"测试","answer":"内容"}]}`,
		`{"enabled":true,"entries":[{"scope":"global","title":"测试1","question":"怎么使用","answer":"内容1"},{"scope":"global","title":"测试2","question":"怎么使用？","answer":"内容2"}]}`,
		"null",
	}
	// raw 是本轮待拒绝的配置。
	for _, raw := range invalidConfigs {
		// body、err 是用户设置接口实际请求体。
		body, err := json.Marshal(map[string]string{"value": raw})
		if err != nil {
			t.Fatal(err)
		}
		// response 是非法配置保存响应，业务校验错误必须返回 400。
		response := libraryRequest(t, handler, admin, http.MethodPut, "/api/v1/settings/user/customer_support_v1", "application/json", body)
		if response.Code != http.StatusBadRequest {
			t.Fatal("非法配置没有返回参数错误", response.Code)
		}
	}
	// saved、err 读取合法配置，确认非法请求没有覆盖。
	saved, err := store.UserSettings.GetForUser(ctx, owner, supportpolicy.ConfigKey)
	if err != nil || saved != initial {
		t.Fatal("非法请求修改已有配置", err)
	}
	// foreignPreview 是另一个登录用户读取不属于自己的店铺。
	foreignPreview := libraryRequest(t, handler, member, http.MethodPost, "/api/v1/settings/support-preview", "application/json", []byte(`{"account_id":"acc1","item_id":"","message":"怎么使用"}`))
	if foreignPreview.Code != http.StatusForbidden && foreignPreview.Code != http.StatusNotFound {
		t.Fatal("跨用户沙盒访问未拒绝", foreignPreview.Code)
	}
	// foreignTakeover 是另一个登录用户试图接管本账号。
	foreignTakeover := libraryRequest(t, handler, member, http.MethodPost, "/api/v1/settings/support-takeover", "application/json", []byte(`{"account_id":"acc1","chat_id":"fixture-chat","paused":true}`))
	if foreignTakeover.Code != http.StatusForbidden && foreignTakeover.Code != http.StatusNotFound {
		t.Fatal("跨用户接管未拒绝", foreignTakeover.Code)
	}
	// foreignConfig 是另一个用户将知识绑定到不属于其的店铺时提交的请求。
	foreignConfig, err := json.Marshal(map[string]string{"value": `{"enabled":true,"entries":[{"scope":"account","account_id":"acc1","title":"测试","answer":"内容"}]}`})
	if err != nil {
		t.Fatal(err)
	}
	// foreignSave 必须明确拒绝越权配置，而不是写入或返回内部错误。
	foreignSave := libraryRequest(t, handler, member, http.MethodPut, "/api/v1/settings/user/customer_support_v1", "application/json", foreignConfig)
	if foreignSave.Code != http.StatusForbidden && foreignSave.Code != http.StatusNotFound {
		t.Fatal("跨用户知识归属未拒绝", foreignSave.Code)
	}
	// malformedTakeover 缺少明确暂停动作，不得默认恢复或暂停会话。
	malformedTakeover := libraryRequest(t, handler, admin, http.MethodPost, "/api/v1/settings/support-takeover", "application/json", []byte(`{"account_id":"acc1","chat_id":"fixture-chat","paused":null}`))
	if malformedTakeover.Code != http.StatusBadRequest {
		t.Fatal("无效接管操作未拒绝", malformedTakeover.Code)
	}
	// takeover、err 确认被拒绝的请求没有写入本人的会话状态。
	takeover, err := store.UserSettings.GetForUser(ctx, owner, supportpolicy.TakeoverKey("acc1", "fixture-chat"))
	if err != nil || takeover != "" {
		t.Fatal("非法接管污染持久化状态", err)
	}
}
