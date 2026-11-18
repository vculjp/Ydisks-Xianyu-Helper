package server

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	collectorapp "xianyu-go/internal/application/collector"
)

// fakeCollectorPort 为 HTTP 层契约测试提供确定性的全站商品采集应用替身。
type fakeCollectorPort struct{}

// SearchKeyword 返回单条符合契约的搜索商品快照。
func (fakeCollectorPort) SearchKeyword(_ context.Context, _ int64, query collectorapp.SearchQuery) (collectorapp.SearchResult, error) {
	return collectorapp.SearchResult{
		Items: []collectorapp.CollectedItem{
			{
				ItemID:         "1099053019895",
				Title:          query.Keyword + "精选学习资料",
				Description:    "全套高清整理资料",
				Price:          "9.90",
				OriginalPrice:  "19.90",
				PicURL:         "https://img.alicdn.com/1.jpg",
				ImageURLs:      []string{"https://img.alicdn.com/1.jpg"},
				Area:           "杭州",
				SellerID:       "2177750131",
				SellerNick:     "土豆ai",
				WantCount:      88,
				BrowseCount:    660,
				CategoryID:     "50023914",
				IsFreeShipping: true,
				IsMultiSpec:    false,
				HasFullDetail:  false,
				WebURL:         "https://www.goofish.com/item?id=1099053019895",
			},
		},
		PageNumber: 1,
		HasMore:    false,
		TotalCount: 1,
	}, nil
}

// CollectItemDetails 返回单品完整详情契约数据。
func (fakeCollectorPort) CollectItemDetails(_ context.Context, _ int64, _ collectorapp.DetailCollectInput) (collectorapp.DetailCollectResult, error) {
	return collectorapp.DetailCollectResult{
		Items: []collectorapp.CollectedItem{
			{
				ItemID:        "1099053019895",
				Title:         "办公表格公式速查手册",
				Description:   "拍下自动发网盘链接",
				Price:         "9.90",
				PicURL:        "https://img.alicdn.com/1.jpg",
				ImageURLs:     []string{"https://img.alicdn.com/1.jpg", "https://img.alicdn.com/2.jpg"},
				SellerID:      "2177750131",
				SellerNick:    "土豆ai",
				WantCount:     12,
				BrowseCount:   120,
				HasFullDetail: true,
				WebURL:        "https://www.goofish.com/item?id=1099053019895",
			},
		},
		Errors: []collectorapp.DetailItemError{},
	}, nil
}

// CollectSellerItems 返回同行店铺商品列表契约数据。
func (fakeCollectorPort) CollectSellerItems(_ context.Context, _ int64, _ collectorapp.SellerCollectInput) (collectorapp.SearchResult, error) {
	return collectorapp.SearchResult{
		Items:      []collectorapp.CollectedItem{},
		PageNumber: 1,
		HasMore:    false,
		TotalCount: 0,
	}, nil
}

// RewriteItem 返回 AI 防重改写契约结果。
func (fakeCollectorPort) RewriteItem(_ context.Context, _ int64, input collectorapp.RewriteInput) (collectorapp.RewriteResult, error) {
	return collectorapp.RewriteResult{
		Title:       "全新整理：" + input.Title,
		Description: input.Description + "\n支持自动秒发",
	}, nil
}

// SaveToTemplates 返回批量转存模板成功结果。
func (fakeCollectorPort) SaveToTemplates(_ context.Context, _ int64, input collectorapp.SaveTemplatesInput) (collectorapp.SaveTemplatesResult, error) {
	return collectorapp.SaveTemplatesResult{
		Total:     len(input.Items),
		Succeeded: len(input.Items),
		Results: []collectorapp.SavedTemplateOutcome{
			{
				ItemID:     "1099053019895",
				Title:      "办公表格公式速查手册",
				Success:    true,
				TemplateID: 1,
				ImageCount: 1,
			},
		},
	}, nil
}

// OpenManualVerify 返回测试用验证窗口目标 URL。
func (fakeCollectorPort) OpenManualVerify(_ context.Context, _ int64, _ collectorapp.OpenManualVerifyInput) (string, error) {
	return "https://www.goofish.com/search?q=%E7%94%B5%E5%AD%90%E8%B5%84%E6%96%99", nil
}

// CompleteManualVerify 返回同步后的 Cookie 条目统计。
func (fakeCollectorPort) CompleteManualVerify(_ context.Context, _ int64, cookieID string) (collectorapp.ManualVerifyCompleteResult, error) {
	return collectorapp.ManualVerifyCompleteResult{CookieID: cookieID, SyncedCount: 18}, nil
}

// CancelManualVerify 模拟正常关闭验证窗口。
func (fakeCollectorPort) CancelManualVerify(_ context.Context, _ int64, _ string) error {
	return nil
}

// TestCollectorHandlersOpenAPIContract 覆盖商品采集全部 5 个 `/api/v1/collector/*` 操作的认证、200 成功契约与 400 参数错误校验。
func TestCollectorHandlersOpenAPIContract(t *testing.T) {
	// srv、_、cleanup 创建测试 Server。
	srv, _, cleanup := newTestServer(t)
	defer cleanup()
	srv.applications.collector = fakeCollectorPort{}
	// handler 是完整路由树；session 是已认证会话 Cookie。
	handler := srv.Router()
	// session 登录管理员测试会话。
	session := loginHelper(t, handler)

	// searchPayload 测试全站关键词搜索成功响应与 OpenAPI schema 对齐。
	searchPayload, _ := json.Marshal(map[string]any{"cookie_id": "acc1", "keyword": "电子资料", "sort_mode": "want_desc"})
	// searchRec 捕获搜索响应并登记 OpenAPI 覆盖。
	searchRec := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/collector/search", "application/json", searchPayload)
	if searchRec.Code != http.StatusOK {
		t.Fatalf("search status=%d body=%s", searchRec.Code, searchRec.Body.String())
	}

	// detailPayload 测试单品链接详情采集成功契约。
	detailPayload, _ := json.Marshal(map[string]any{"cookie_id": "acc1", "inputs": []string{"https://www.goofish.com/item?id=1099053019895"}})
	// detailRec 捕获详情采集响应。
	detailRec := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/collector/item-detail", "application/json", detailPayload)
	if detailRec.Code != http.StatusOK {
		t.Fatalf("detail status=%d body=%s", detailRec.Code, detailRec.Body.String())
	}

	// sellerPayload 测试对标同行店铺采集成功契约。
	sellerPayload, _ := json.Marshal(map[string]any{"cookie_id": "acc1", "seller_input": "2177750131", "max_pages": 1})
	// sellerRec 捕获店铺采集响应。
	sellerRec := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/collector/seller-items", "application/json", sellerPayload)
	if sellerRec.Code != http.StatusOK {
		t.Fatalf("seller status=%d body=%s", sellerRec.Code, sellerRec.Body.String())
	}

	// rewritePayload 测试 AI 改写成功契约。
	rewritePayload, _ := json.Marshal(map[string]any{"title": "原标题", "description": "原文案"})
	// rewriteRec 捕获 AI 改写响应。
	rewriteRec := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/collector/ai-rewrite", "application/json", rewritePayload)
	if rewriteRec.Code != http.StatusOK {
		t.Fatalf("rewrite status=%d body=%s", rewriteRec.Code, rewriteRec.Body.String())
	}

	// savePayload 测试一键转存商品模板成功契约。
	savePayload, _ := json.Marshal(map[string]any{
		"cookie_id":               "acc1",
		"fetch_detail_if_missing": true,
		"price_mode":              "keep",
		"postage_mode":            "none",
		"items": []map[string]any{
			{
				"item_id":         "1099053019895",
				"title":           "办公表格公式速查手册",
				"description":     "详情文案",
				"price":           "9.90",
				"image_urls":      []string{"https://img.alicdn.com/1.jpg"},
				"has_full_detail": true,
			},
		},
	})
	// saveRec 捕获批量转存响应。
	saveRec := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/collector/save-templates", "application/json", savePayload)
	if saveRec.Code != http.StatusOK {
		t.Fatalf("save status=%d body=%s", saveRec.Code, saveRec.Body.String())
	}

	// openVerifyPayload 测试弹出可见闲鱼验证窗口契约。
	openVerifyPayload, _ := json.Marshal(map[string]any{"cookie_id": "acc1", "scene": "search", "keyword": "电子资料"})
	// openVerifyRec 捕获打开验证窗口响应并登记 OpenAPI 覆盖。
	openVerifyRec := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/collector/manual-verify/open", "application/json", openVerifyPayload)
	if openVerifyRec.Code != http.StatusOK {
		t.Fatalf("manual-verify/open status=%d body=%s", openVerifyRec.Code, openVerifyRec.Body.String())
	}

	// completeVerifyPayload 测试确认手动滑完并同步 Cookie Jar 快照契约。
	completeVerifyPayload, _ := json.Marshal(map[string]any{"cookie_id": "acc1"})
	// completeVerifyRec 捕获完成验证同步响应。
	completeVerifyRec := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/collector/manual-verify/complete", "application/json", completeVerifyPayload)
	if completeVerifyRec.Code != http.StatusOK {
		t.Fatalf("manual-verify/complete status=%d body=%s", completeVerifyRec.Code, completeVerifyRec.Body.String())
	}

	// cancelVerifyRec 捕获关闭验证窗口响应。
	cancelVerifyRec := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/collector/manual-verify/cancel", "application/json", completeVerifyPayload)
	if cancelVerifyRec.Code != http.StatusOK {
		t.Fatalf("manual-verify/cancel status=%d body=%s", cancelVerifyRec.Code, cancelVerifyRec.Body.String())
	}

	// badRec 验证畸形 JSON 请求返回统一 400 错误。
	badRec := libraryRequest(t, handler, session, http.MethodPost, "/api/v1/collector/search", "application/json", []byte("{invalid"))
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on invalid json, got %d", badRec.Code)
	}
}
