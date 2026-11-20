package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCollectorRadarSuccessContracts 校验真实鉴权路由的十一项雷达接口响应，应用层采用本地替身而非访问平台。
func TestCollectorRadarSuccessContracts(t *testing.T) {
	// srv、cleanup 保存隔离的测试服务及数据库关闭责任。
	srv, _, cleanup := newTestServer(t)
	defer cleanup()
	srv.applications.collector = fakeCollectorPort{}
	// handler 是与生产一致的 HTTP 路由树。
	handler := srv.Router()
	// session 是测试管理员认证 Cookie。
	session := loginHelper(t, handler)
	// cases 覆盖全部雷达成功操作，包含空列表、修改与状态响应。
	cases := []struct {
		// method 是契约中声明的 HTTP 方法。
		method string
		// path 是真实请求路径。
		path string
		// body 是测试输入，不含真实账号或凭证。
		body string
	}{
		{http.MethodGet, "/api/v1/collector/radar/targets", ""},
		{http.MethodPost, "/api/v1/collector/radar/targets", `{"targets":[{"target_type":"keyword","raw_value":"测试资料","label":"测试","publish_days":3}],"import_virtual_seed_pack":false}`},
		{http.MethodPatch, "/api/v1/collector/radar/targets/1", `{"enabled":false}`},
		{http.MethodDelete, "/api/v1/collector/radar/targets/1", ""},
		{http.MethodPost, "/api/v1/collector/radar/ai-keywords", `{"niche":"测试"}`},
		{http.MethodPost, "/api/v1/collector/radar/scan/start", `{"cookie_id":"acc1"}`},
		{http.MethodPost, "/api/v1/collector/radar/scan/stop", ""},
		{http.MethodGet, "/api/v1/collector/radar/scan/status", ""},
		{http.MethodPut, "/api/v1/collector/radar/schedule", `{"enabled":false,"cookie_id":"acc1","interval_hours":12}`},
		{http.MethodGet, "/api/v1/collector/radar/items", ""},
		{http.MethodDelete, "/api/v1/collector/radar/items", ""},
	}
	// tc 是当前操作的成功契约场景。
	for _, tc := range cases {
		// recorder 保存真实 HTTP 路由响应。
		recorder := libraryRequest(t, handler, session, tc.method, tc.path, "application/json", []byte(tc.body))
		// request 为 OpenAPI 路由匹配提供相同的方法和路径。
		request := httptest.NewRequest(tc.method, tc.path, nil)
		assertOpenAPISuccessResponse(t, request, recorder)
	}
}
