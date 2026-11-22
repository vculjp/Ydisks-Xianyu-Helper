package server

import (
	"encoding/json"
	"errors"
	"net/http"

	collectorapp "xianyu-go/internal/application/collector"
)

// writeCollectorError 将商品采集应用错误映射为统一 HTTP 错误信封与语义状态码。
func writeCollectorError(w http.ResponseWriter, r *http.Request, err error, fallback string) {
	// validation 提取客户端可直接修正的参数校验错误。
	var validation *collectorapp.ValidationError
	switch {
	case errors.As(err, &validation):
		writeErrRequest(w, r, http.StatusBadRequest, validation.Message)
	case errors.Is(err, collectorapp.ErrAccountNotOwned):
		writeErrRequest(w, r, http.StatusForbidden, collectorapp.ErrAccountNotOwned.Error())
	case errors.Is(err, collectorapp.ErrAIUnavailable):
		writeErrRequest(w, r, http.StatusBadRequest, collectorapp.ErrAIUnavailable.Error())
	default:
		// 远端平台返回的风控提示或网络失败以脱敏错误文本返回 502，便于前端明确展示原因。
		if err != nil && err.Error() != "" {
			writeErrRequest(w, r, http.StatusBadGateway, err.Error())
			return
		}
		writeErrRequest(w, r, http.StatusInternalServerError, fallback)
	}
}

// decodeCollectorJSON 解码受大小限制的采集请求 JSON 正文。
func decodeCollectorJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	// dec 解码请求体 JSON。
	dec := json.NewDecoder(r.Body)
	// err 检查请求体 JSON 解码是否成功。
	if err := dec.Decode(dst); err != nil {
		writeErrRequest(w, r, http.StatusBadRequest, "请求参数 JSON 格式无效")
		return false
	}
	return true
}

// searchMarketItems 处理 `POST /api/v1/collector/search` 全站关键词搜索采集请求。
func (s *Server) searchMarketItems(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解析搜索过滤请求体。
	var req collectorSearchRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// res、err 调用采集应用服务执行单页关键词搜索。
	res, err := s.collectorApplication().SearchKeyword(r.Context(), userID, collectorapp.SearchQuery{
		CookieID:     req.CookieID,
		Keyword:      req.Keyword,
		PageNumber:   req.PageNumber,
		RowsPerPage:  req.RowsPerPage,
		SortMode:     req.SortMode,
		MinPrice:     req.MinPrice,
		MaxPrice:     req.MaxPrice,
		PublishDays:  req.PublishDays,
		MinWantCount: req.MinWantCount,
	})
	if err != nil {
		writeCollectorError(w, r, err, "全站商品搜索采集失败")
		return
	}
	writeJSON(w, http.StatusOK, newCollectorSearchResponse(res))
}

// collectMarketItemDetails 处理 `POST /api/v1/collector/item-detail` 单品或多链接精准详情采集请求。
func (s *Server) collectMarketItemDetails(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解析链接或商品 ID 数组请求体。
	var req collectorDetailRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// res、err 调用采集应用服务按序抓取完整详情。
	res, err := s.collectorApplication().CollectItemDetails(r.Context(), userID, collectorapp.DetailCollectInput{
		CookieID:  req.CookieID,
		RawInputs: req.Inputs,
	})
	if err != nil {
		writeCollectorError(w, r, err, "商品详情采集失败")
		return
	}
	// items、errs 转换为非 nil 传输切片。
	items := make([]collectedItemDTO, 0, len(res.Items))
	// item 遍历采集成功的商品详情。
	for _, item := range res.Items {
		items = append(items, newCollectedItemDTO(item))
	}
	// errs 汇总单品错误明细。
	errs := make([]collectorDetailErrorDTO, 0, len(res.Errors))
	// itemErr 遍历单品失败项。
	for _, itemErr := range res.Errors {
		errs = append(errs, collectorDetailErrorDTO{ItemID: itemErr.ItemID, Message: itemErr.Message})
	}
	writeJSON(w, http.StatusOK, collectorDetailResponse{
		Items:         items,
		Errors:        errs,
		AbortedByRisk: res.AbortedByRisk,
	})
}

// collectSellerShopItems 处理 `POST /api/v1/collector/seller-items` 对标同行店铺商品采集请求。
func (s *Server) collectSellerShopItems(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解析同行店铺输入与翻页上限。
	var req collectorSellerRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// res、err 调用采集应用服务抓取对标店铺在售列表。
	res, err := s.collectorApplication().CollectSellerItems(r.Context(), userID, collectorapp.SellerCollectInput{
		CookieID:    req.CookieID,
		SellerInput: req.SellerInput,
		MaxPages:    req.MaxPages,
	})
	if err != nil {
		writeCollectorError(w, r, err, "同行店铺商品采集失败")
		return
	}
	writeJSON(w, http.StatusOK, newCollectorSearchResponse(res))
}

// rewriteCollectedItemWithAI 处理 `POST /api/v1/collector/ai-rewrite` 标题与详情 AI 防重改写请求。
func (s *Server) rewriteCollectedItemWithAI(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解析待改写标题、文案与附加要求。
	var req collectorAIRewriteRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// res、err 调用系统 AI 改写服务。
	res, err := s.collectorApplication().RewriteItem(r.Context(), userID, collectorapp.RewriteInput{
		Title:             req.Title,
		Description:       req.Description,
		CustomInstruction: req.CustomInstruction,
	})
	if err != nil {
		writeCollectorError(w, r, err, "AI 标题与文案改写失败")
		return
	}
	writeJSON(w, http.StatusOK, collectorAIRewriteResponse{
		Title:       res.Title,
		Description: res.Description,
	})
}

// saveCollectedItemsToTemplates 处理 `POST /api/v1/collector/save-templates` 批量下图并生成本地商品模板请求。
func (s *Server) saveCollectedItemsToTemplates(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解析批量转存请求体。
	var req collectorSaveTemplatesRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// appItems 转换输入商品列表。
	appItems := make([]collectorapp.SaveTemplateItem, 0, len(req.Items))
	// rawItem 遍历前端选中的待转存条目。
	for _, rawItem := range req.Items {
		appItems = append(appItems, collectorapp.SaveTemplateItem{
			ItemID:        rawItem.ItemID,
			Name:          rawItem.Name,
			Title:         rawItem.Title,
			Description:   rawItem.Description,
			Price:         rawItem.Price,
			OriginalPrice: rawItem.OriginalPrice,
			ImageURLs:     rawItem.ImageURLs,
			HasFullDetail: rawItem.HasFullDetail,
			Source:        rawItem.Source,
		})
	}
	// res、err 执行批量转存本地商品模板库。
	res, err := s.collectorApplication().SaveToTemplates(r.Context(), userID, collectorapp.SaveTemplatesInput{
		CookieID:             req.CookieID,
		FetchDetailIfMissing: req.FetchDetailIfMissing,
		EnableAIRewrite:      req.EnableAIRewrite,
		CustomInstruction:    req.CustomInstruction,
		PriceMode:            req.PriceMode,
		PriceValue:           req.PriceValue,
		Quantity:             req.Quantity,
		PostageMode:          req.PostageMode,
		DeliveryTemplateID:   req.DeliveryTemplateID,
		CustomVariables:      req.CustomVariables,
		Items:                appItems,
	})
	if err != nil {
		writeCollectorError(w, r, err, "批量转存本地商品模板失败")
		return
	}
	// outcomes 转换逐条结果明细。
	outcomes := make([]collectorSavedTemplateOutcomeDTO, 0, len(res.Results))
	// itemRes 遍历单条转存结果。
	for _, itemRes := range res.Results {
		outcomes = append(outcomes, collectorSavedTemplateOutcomeDTO{
			ItemID:     itemRes.ItemID,
			Title:      itemRes.Title,
			Success:    itemRes.Success,
			TemplateID: itemRes.TemplateID,
			ImageCount: itemRes.ImageCount,
			Error:      itemRes.Error,
		})
	}
	writeJSON(w, http.StatusOK, collectorSaveTemplatesResponse{
		Total:         res.Total,
		Succeeded:     res.Succeeded,
		Failed:        res.Failed,
		AbortedByRisk: res.AbortedByRisk,
		Results:       outcomes,
	})
}

// openCollectorManualVerify 处理 `POST /api/v1/collector/manual-verify/open` 弹出可见闲鱼窗口供用户手动过滑块请求。
func (s *Server) openCollectorManualVerify(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解析目标账号与触发场景。
	var req collectorManualVerifyOpenRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// targetURL、err 弹出注入登录态的闲鱼官方页面窗口。
	targetURL, err := s.collectorApplication().OpenManualVerify(r.Context(), userID, collectorapp.OpenManualVerifyInput{
		CookieID: req.CookieID,
		Scene:    req.Scene,
		Keyword:  req.Keyword,
		TargetID: req.TargetID,
	})
	if err != nil {
		writeCollectorError(w, r, err, "弹出可视化验证窗口失败")
		return
	}
	writeJSON(w, http.StatusOK, collectorManualVerifyOpenResponse{TargetURL: targetURL})
}

// completeCollectorManualVerify 处理 `POST /api/v1/collector/manual-verify/complete` 一键同步验证后完整 Cookie Jar 请求。
func (s *Server) completeCollectorManualVerify(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解析目标账号标识。
	var req collectorManualVerifyCookieRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// res、err 提取完整 Cookie 快照写回数据库并关闭窗口。
	res, err := s.collectorApplication().CompleteManualVerify(r.Context(), userID, req.CookieID)
	if err != nil {
		writeCollectorError(w, r, err, "同步验证窗口 Cookie 失败")
		return
	}
	writeJSON(w, http.StatusOK, collectorManualVerifyCompleteResponse{
		CookieID:    res.CookieID,
		SyncedCount: res.SyncedCount,
	})
}

// cancelCollectorManualVerify 处理 `POST /api/v1/collector/manual-verify/cancel` 关闭验证窗口请求。
func (s *Server) cancelCollectorManualVerify(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解析目标账号标识。
	var req collectorManualVerifyCookieRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// err 执行取消并关闭打开中的验证窗口。
	if err := s.collectorApplication().CancelManualVerify(r.Context(), userID, req.CookieID); err != nil {
		writeCollectorError(w, r, err, "关闭验证窗口失败")
		return
	}
	writeJSON(w, http.StatusOK, collectorManualVerifyCancelResponse{Canceled: true})
}
