package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	itemapp "xianyu-go/internal/application/items"
)

// TestItemMetricsHTTPContract 验证真实列表和详情 handler 从本地缓存返回可选统计，保留真实零值；t 管理隔离数据库与路由。
func TestItemMetricsHTTPContract(t *testing.T) {
	// server、store、cleanup 提供真实 HTTP 服务和临时 SQLite，测试只读取本地商品，不调用平台。
	server, store, cleanup := newTestServer(t)
	defer cleanup()
	// details 是预置的精确统计、未知、损坏和部分无效缓存，键为虚构商品标识。
	details := map[string]string{
		"known":   `{"exposure_count":125,"browse_count":0,"want_count":7}`,
		"unknown": `{}`,
		"broken":  `not-json`,
		"invalid": `{"exposure_count":-1,"browse_count":1.5,"want_count":0}`,
		"legacy":  `{"item_label_data":{"labelData":{"r3":{"tagList":[{"data":{"content":"31人想要"}}]}}}}`,
		"zero":    `{"item_label_data":{"labelData":{"r3":{"tagList":[{"data":{"content":"0人想要"}}]}}}}`,
		"rounded": `{"item_label_data":{"content":"1.2万人想要"}}`,
	}
	// itemID、detail 遍历测试缓存；仅作为参数写入临时数据库。
	for itemID, detail := range details {
		if /* insertErr 是仅向临时 SQLite 写入测试商品的错误。 */ _, insertErr := store.DB.ExecContext(context.Background(), `INSERT INTO item_info (cookie_id,item_id,item_detail) VALUES (?,?,?)`, "acc1", itemID, detail); insertErr != nil {
			t.Fatal(insertErr)
		}
	}
	// handler 是完整路由树；session 是隔离服务创建的本地登录会话。
	handler := server.Router()
	// session 不包含真实平台凭证，也不会输出到断言。
	session := loginHelper(t, handler)
	// path 同时覆盖版本化契约、兼容列表、账号列表及单件详情，避免只修复一条返回路径。
	for _, path := range []string{
		"/api/v1/items?cookie_id=acc1", "/items?cookie_id=acc1", "/api/v1/items/cookie/acc1",
		"/api/v1/items/acc1/known", "/api/v1/items/acc1/unknown", "/api/v1/items/acc1/broken", "/api/v1/items/acc1/invalid",
		"/api/v1/items/acc1/legacy", "/api/v1/items/acc1/zero", "/api/v1/items/acc1/rounded",
	} {
		// request、recorder 分别是本地商品读取请求和捕获 HTTP 响应的记录器。
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.AddCookie(session)
		// recorder 只捕获本地 handler 输出的非敏感商品字段。
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s 状态码=%d", path, recorder.Code)
		}
		if strings.HasPrefix(path, "/api/v1/") {
			assertOpenAPISuccessResponse(t, request, recorder)
		}
		// rows 统一承载列表或单件详情的真实 JSON，断言不依赖内部 DTO 字段。
		var rows []map[string]any
		if strings.Contains(path, "/acc1/") {
			// row 是单件商品响应中的字段集合。
			var row map[string]any
			if /* decodeErr 是本地商品详情响应的 JSON 错误。 */ decodeErr := json.Unmarshal(recorder.Body.Bytes(), &row); decodeErr != nil {
				t.Fatal(decodeErr)
			}
			rows = append(rows, row)
		} else if /* decodeErr 是本地商品列表响应的 JSON 错误。 */ decodeErr := json.Unmarshal(recorder.Body.Bytes(), &rows); decodeErr != nil {
			t.Fatal(decodeErr)
		}
		// row 遍历接口返回的商品，按商品标识断言统计值和字段存在性。
		for _, row := range rows {
			// expected 只包含缓存中明确有效的统计，未知字段应直接省略。
			expected := map[string]any{}
			switch row["item_id"] {
			case "known":
				expected = map[string]any{"exposure_count": float64(125), "browse_count": float64(0), "want_count": float64(7)}
			case "invalid":
				expected = map[string]any{"want_count": float64(0)}
			case "legacy":
				expected = map[string]any{"want_count": float64(31)}
			case "zero":
				expected = map[string]any{"want_count": float64(0)}
			}
			// key 是当前核对的 API 统计字段。
			for _, key := range []string{"exposure_count", "browse_count", "want_count"} {
				// actual、present 保存字段实际值和存在性；wanted、known 保存独立期望。
				actual, present := row[key]
				// wanted、known 区分零值和未返回统计。
				wanted, known := expected[key]
				if present != known || actual != wanted {
					t.Errorf("%s 商品 %v 的 %s=%v（存在=%v），期望 %v（存在=%v）", path, row["item_id"], key, actual, present, wanted, known)
				}
			}
		}
	}
}

// TestExplicitItemMetricsRefreshHTTPContract 验证单件刷新必须鉴权、校验归属并只派发一个商品动作；t 不连接真实平台。
func TestExplicitItemMetricsRefreshHTTPContract(t *testing.T) {
	// server、store、cleanup 是临时数据库及真实 HTTP 路由，应用端口仅记录调用。
	server, store, cleanup := newTestServer(t)
	defer cleanup()
	if /* insertErr 是临时商品夹具写入错误。 */ _, insertErr := store.DB.ExecContext(context.Background(), `INSERT INTO item_info(cookie_id,item_id,item_detail) VALUES (?,?,?)`, "acc1", "metrics", `{"browse_count":0,"want_count":7}`); insertErr != nil {
		t.Fatal(insertErr)
	}
	// port 截获唯一的单件刷新应用调用，测试不会执行外部请求。
	port := &remoteItemManagePortStub{}
	server.applications.itemRemoteManage = port
	// handler、session 是完整路由和本地认证会话。
	handler := server.Router()
	// session 只用于本地登录，禁止输出其内容。
	session := loginHelper(t, handler)
	// denied 是未登录用户试图刷新统计的请求。
	denied := httptest.NewRequest(http.MethodPost, "/api/v1/items/acc1/metrics/metrics/refresh", nil)
	// deniedResponse 用于验证认证在应用调用之前阻止请求。
	deniedResponse := httptest.NewRecorder()
	handler.ServeHTTP(deniedResponse, denied)
	if deniedResponse.Code != http.StatusUnauthorized || len(port.actions) != 0 {
		t.Fatal("未登录的指标刷新必须零平台调用")
	}
	// request 是用户明确点击一件商品时的版本化 POST。
	request := httptest.NewRequest(http.MethodPost, "/api/v1/items/acc1/metrics/metrics/refresh", nil)
	request.AddCookie(session)
	// recorder 捕获刷新后商品 DTO。
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || len(port.actions) != 1 || port.actions[0].ItemID != "metrics" || port.actions[0].Action != itemapp.RemoteItemRefreshMetricsAction {
		t.Fatalf("单件刷新没有严格派发一个商品动作: status=%d calls=%d", recorder.Code, len(port.actions))
	}
	assertOpenAPIRecordedSuccessResponse(t, request, recorder)
	// riskRequest 验证平台风控错误会被翻译为明确提示，且仍只派发一次当前商品动作。
	port.err = errors.New("FAIL_SYS_USER_VALIDATE；RGV587_ERROR::SM")
	riskRequest := httptest.NewRequest(http.MethodPost, "/api/v1/items/acc1/metrics/metrics/refresh", nil)
	riskRequest.AddCookie(session)
	riskRecorder := httptest.NewRecorder()
	handler.ServeHTTP(riskRecorder, riskRequest)
	if riskRecorder.Code != http.StatusBadGateway || !strings.Contains(riskRecorder.Body.String(), "RGV587") || len(port.actions) != 2 {
		t.Fatalf("风控刷新回执不符合预期: status=%d body=%s calls=%d", riskRecorder.Code, riskRecorder.Body.String(), len(port.actions))
	}
}

// TestPlatformRiskVerificationError 验证刷新失败只在明确风控/验证文本时返回可操作提示。
func TestPlatformRiskVerificationError(t *testing.T) {
	for _, testCase := range []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "ordinary", err: errors.New("network timeout"), want: false},
		{name: "rgv587", err: errors.New("FAIL_SYS_USER_VALIDATE；RGV587_ERROR::SM"), want: true},
		{name: "chinese", err: errors.New("平台要求安全验证"), want: true},
	} {
		if got := platformRiskVerificationError(testCase.err); got != testCase.want {
			t.Errorf("%s: got %v want %v", testCase.name, got, testCase.want)
		}
	}
}
