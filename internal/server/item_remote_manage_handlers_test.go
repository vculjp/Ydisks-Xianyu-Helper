package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	itemapp "xianyu-go/internal/application/items"
	"xianyu-go/internal/xianyu/mtop"
)

// remoteItemManagePortStub 是只记录操作并返回预设结果的 HTTP 应用 Port，测试不访问闲鱼。
type remoteItemManagePortStub struct {
	// actions 保存通过认证与路径校验后的用户请求。
	actions []itemapp.RemoteItemInput
	// err 是本轮需要模拟的平台/本地保存错误。
	err error
}

// Execute 记录本次用户确认的操作，不会向外部平台发请求。
func (port *remoteItemManagePortStub) Execute(_ context.Context, input itemapp.RemoteItemInput) error {
	port.actions = append(port.actions, input)
	return port.err
}

// TestItemRemoteManageAPIRequiresAuthAndConfirmsActions 验证远端编辑、上下架的 HTTP 路由及错误回执。
func TestItemRemoteManageAPIRequiresAuthAndConfirmsActions(t *testing.T) {
	// srv、cleanup 是隔离的测试 Server 和清理回调，所有数据都在测试 SQLite 中。
	srv, _, cleanup := newTestServer(t)
	defer cleanup()
	// port 是完全隔离外部平台请求的测试应用 Port。
	port := &remoteItemManagePortStub{}
	srv.applications.itemRemoteManage = port
	// handler 是真实认证中间件和 Chi 路由。
	handler := srv.Router()
	// cookie 是测试登录会话，不是真实闲鱼账号凭证。
	cookie := loginHelper(t, handler)
	// editPayload 是可选字段修改请求，必须保持原始中文标题。
	editPayload := []byte(`{"item_title":"虚拟资料新版标题","item_price":"2.90"}`)
	// cases 是三种单件远端操作路径及期望货架状态。
	cases := []struct {
		// path 是版本化的单项操作 URL。
		path string
		// body 是编辑操作的业务输入，上下架无需正文。
		body []byte
		// action 是业务服务应看到的操作类型。
		action itemapp.RemoteItemAction
	}{
		{"/api/v1/items/acc1/it1/remote-edit", editPayload, itemapp.RemoteItemEditAction},
		{"/api/v1/items/acc1/it1/downshelf", nil, itemapp.RemoteItemDownShelfAction},
		{"/api/v1/items/acc1/it1/reshelf", nil, itemapp.RemoteItemReshelfAction},
		{"/api/v1/items/acc1/it1/delete", nil, itemapp.RemoteItemDeleteAction},
	}
	// entry 是当前待执行的单件平台操作。
	for _, entry := range cases {
		// request 是不含真实账号 Cookie 的测试 HTTP 请求。
		request := httptest.NewRequest(http.MethodPost, entry.path, bytes.NewReader(entry.body))
		if len(entry.body) != 0 {
			request.Header.Set("Content-Type", "application/json")
		}
		request.AddCookie(cookie)
		// recorder 是本次请求的 HTTP 响应。
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK || len(port.actions) == 0 || port.actions[len(port.actions)-1].Action != entry.action {
			t.Fatalf("远端商品路由失败 path=%s status=%d body=%s", entry.path, recorder.Code, recorder.Body.String())
		}
		// 成功响应必须严格符合 OpenAPI 契约，不允许返回真实平台详情或 Cookie。
		assertOpenAPIRecordedSuccessResponse(t, request, recorder)
	}
	// failedRequest 是模拟平台明确拒绝的下架请求。
	port.err = errors.New("平台拒绝下架")
	// failedRequest 是执行平台拒绝场景的受认证单件请求。
	failedRequest := httptest.NewRequest(http.MethodPost, "/api/v1/items/acc1/it1/downshelf", nil)
	failedRequest.AddCookie(cookie)
	// failedResponse 是对外收口的业务错误，不应输出内部错误明文。
	failedResponse := httptest.NewRecorder()
	handler.ServeHTTP(failedResponse, failedRequest)
	if failedResponse.Code != http.StatusBadGateway || bytes.Contains(failedResponse.Body.Bytes(), []byte("平台拒绝下架")) {
		t.Fatalf("平台失败应收口为不泄露内部错误的 502: status=%d body=%s", failedResponse.Code, failedResponse.Body.String())
	}
	// unauthRequest 是缺少服务登录凭据的受保护平台操作。
	unauthRequest := httptest.NewRequest(http.MethodPost, "/api/v1/items/acc1/it1/downshelf", nil)
	// unauthResponse 是认证中间件阻止未登录操作的结果。
	unauthResponse := httptest.NewRecorder()
	handler.ServeHTTP(unauthResponse, unauthRequest)
	if unauthResponse.Code != http.StatusUnauthorized {
		t.Fatalf("未登录用户不得修改真实平台商品: %d", unauthResponse.Code)
	}
}

// TestItemBargainRouteRequiresEnabledBody 验证小刀开关路由能携带明确的布尔目标，且空/非法正文被拒绝。
func TestItemBargainRouteRequiresEnabledBody(t *testing.T) {
	// srv、cleanup 是隔离的测试 Server 和清理回调。
	srv, _, cleanup := newTestServer(t)
	defer cleanup()
	// port 是只记录操作并返回成功的应用 Port。
	port := &remoteItemManagePortStub{}
	srv.applications.itemRemoteManage = port
	// handler 是真实认证中间件和 Chi 路由。
	handler := srv.Router()
	// cookie 是测试登录会话。
	cookie := loginHelper(t, handler)
	// request 是开启小刀的受认证请求。
	request := httptest.NewRequest(http.MethodPost, "/api/v1/items/acc1/it1/bargain", bytes.NewReader([]byte(`{"enabled":true}`)))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(cookie)
	// recorder 是成功切换小刀的响应。
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || len(port.actions) != 1 || port.actions[0].Action != itemapp.RemoteItemBargainAction || port.actions[0].Bargain == nil || !*port.actions[0].Bargain {
		t.Fatalf("小刀开启应路由为 bargain 且 Bargain=true: status=%d actions=%+v body=%s", recorder.Code, port.actions, recorder.Body.String())
	}
	assertOpenAPIRecordedSuccessResponse(t, request, recorder)
	// 空正文与非法正文都必须返回 400，且不得触碰平台端口。
	for _, badBody := range [][]byte{nil, []byte(`{}`), []byte(`{"enabled":"not-a-bool"}`)} {
		badRequest := httptest.NewRequest(http.MethodPost, "/api/v1/items/acc1/it1/bargain", bytes.NewReader(badBody))
		if len(badBody) != 0 {
			badRequest.Header.Set("Content-Type", "application/json")
		}
		badRequest.AddCookie(cookie)
		badRecorder := httptest.NewRecorder()
		handler.ServeHTTP(badRecorder, badRequest)
		if badRecorder.Code != http.StatusBadRequest {
			t.Fatalf("小刀开关空/非法正文应返回 400: status=%d body=%s", badRecorder.Code, badRecorder.Body.String())
		}
	}
	if len(port.actions) != 1 {
		t.Fatalf("空/非法正文不得触发平台调用: actions=%d", len(port.actions))
	}
}

// TestItemRemoteManagePlatformErrorMapping 验证平台明确返回的“不支持网页编辑/无忧卖”失败被翻译成可执行提示。
func TestItemRemoteManagePlatformErrorMapping(t *testing.T) {
	// srv、cleanup 是隔离的测试 Server 和清理回调。
	srv, _, cleanup := newTestServer(t)
	defer cleanup()
	// port 是返回预设平台错误的测试应用 Port。
	port := &remoteItemManagePortStub{}
	srv.applications.itemRemoteManage = port
	// handler 是真实认证中间件和 Chi 路由。
	handler := srv.Router()
	// cookie 是测试登录会话。
	cookie := loginHelper(t, handler)
	// cases 是平台错误标记与期望错误码的映射。
	cases := []struct {
		// path 是触发平台操作的受保护路由。
		path string
		// ret 是平台返回的错误标记。
		ret []string
		// wantCode 是对外收口的机器可读错误码。
		wantCode string
	}{
		{"/api/v1/items/acc1/it1/reshelf", []string{"FAIL_BIZ_PC_NOT_SUPPORT_PUBLISH_OR_EDIT::该商品暂不支持网页发布，请到闲鱼APP发布"}, "pc_publish_unsupported"},
		{"/api/v1/items/acc1/it1/downshelf", []string{"FAIL_BIZ_BAD_REQUEST::该商品受无忧卖保护||DOWN_SHELF_FAIL"}, "wuyoumai_shelf_managed_in_app"},
	}
	// entry 是当前待验证的平台错误映射。
	for _, entry := range cases {
		port.err = &mtop.MTopResponseError{Ret: entry.ret}
		// request 是模拟平台明确失败的受认证请求。
		request := httptest.NewRequest(http.MethodPost, entry.path, nil)
		request.AddCookie(cookie)
		// recorder 是本次错误回执。
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("平台限制应返回 403: path=%s status=%d body=%s", entry.path, recorder.Code, recorder.Body.String())
		}
		// response 是统一错误 DTO，用于断言稳定错误码。
		var response struct {
			Code string `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.wantCode {
			t.Fatalf("平台限制应映射为 %s: path=%s code=%s err=%v body=%s", entry.wantCode, entry.path, response.Code, err, recorder.Body.String())
		}
	}
}
