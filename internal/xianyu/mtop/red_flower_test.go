package mtop

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestRequestRedFlowerContext 验证求花接口版本、订单参数及平台明确成功与拒绝的响应语义，且不接触真实闲鱼。
func TestRequestRedFlowerContext(t *testing.T) {
	// shouldReject 控制本地 MTOP 替身返回确定业务失败，检验失败不会被错误标为成功。
	shouldReject := false
	// requests 记录模拟平台的 HTTP 请求数量，防止业务拒绝时隐式重放。
	requests := 0
	// server 是只在本地监听的替身 MTOP 服务。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodPost || r.URL.Query().Get("api") != "mtop.taobao.idlemessage.red.flower" || r.URL.Query().Get("v") != "1.0" {
			t.Errorf("求花请求必须使用正确方法及 1.0 版本: %s %s", r.Method, r.URL.String())
		}
		if err := r.ParseForm(); err != nil {
			t.Errorf("解析求花请求失败: %v", err)
			return
		}
		// data 只包含被授权订单号与固定渠道，不传买家 Cookie 以外的额外信息。
		var data map[string]string
		if err := json.Unmarshal([]byte(r.Form.Get("data")), &data); err != nil {
			t.Errorf("解析求花载荷失败: %v", err)
			return
		}
		if data["orderId"] != "flower-order" || data["channel"] != "list" || len(data) != 2 {
			t.Errorf("求花参数不符合订单接口要求: %+v", data)
		}
		w.Header().Set("Content-Type", "application/json")
		if shouldReject {
			_, _ = w.Write([]byte(`{"ret":["FAIL_BIZ_BAD_REQUEST::订单状态不允许求花"],"data":{}}`))
			return
		}
		_, _ = w.Write([]byte(`{"ret":["SUCCESS::调用成功"],"data":{}}`))
	}))
	defer server.Close()
	// client 通过自定义端点走项目真正的签名与 Cookie 请求栈。
	client := &ClientImpl{HTTPClient: server.Client(), RedFlowerURL: server.URL}
	// cookies 只用模拟会话的签名令牌，不存在真实账号凭证。
	cookies := "unb=123; _m_h5_tk=fake-token_1"
	// ok、returns、updated、err 检验正常成功的求花调用。
	ok, returns, updated, err := client.RequestRedFlowerContext(context.Background(), cookies, "flower-order")
	if err != nil || !ok || len(returns) == 0 || updated == "" {
		t.Fatalf("原生求花成功响应解析错误: ok=%v ret=%v cookie=%v err=%v", ok, returns, updated != "", err)
	}
	// 业务拒绝后必须返回失败，不允许把发送 HTTP 200 当作求花成功。
	shouldReject = true
	ok, _, _, err = client.RequestRedFlowerContext(context.Background(), cookies, "flower-order")
	if ok || err == nil || requests != 2 {
		t.Fatalf("平台明确拒绝求花不得误报成功或自动重发: ok=%v err=%v calls=%d", ok, err, requests)
	}
	// 空订单不发送任何外部请求。
	if _, _, _, err = client.RequestRedFlowerContext(context.Background(), cookies, ""); err == nil || requests != 2 {
		t.Fatalf("空订单应在发起平台请求前拒绝: err=%v calls=%d", err, requests)
	}
}
