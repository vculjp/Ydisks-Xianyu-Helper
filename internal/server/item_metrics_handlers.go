package server

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	itemapp "xianyu-go/internal/application/items"
	"xianyu-go/internal/auth"
)

// refreshItemMetrics 只处理用户对一件商品的显式 POST，列表 GET 与列表同步均不调用；失败不自动重放，不返回平台详情或凭证。
func (server *Server) refreshItemMetrics(writer http.ResponseWriter, request *http.Request) {
	// cookieID、itemID 是本次唯一目标账号和商品，接口不接收批量 ID。
	cookieID, itemID := strings.TrimSpace(chi.URLParam(request, "cookie_id")), strings.TrimSpace(chi.URLParam(request, "item_id"))
	if !server.requireCookieOwnership(writer, request, cookieID) {
		return
	}
	// catalog 是本地商品用例，先验证存在再允许任何平台读取。
	catalog := server.itemCatalogApplication()
	if /* readErr 是本地商品不存在或读取失败的原因，不向用户回显内部信息。 */ _, readErr := catalog.Get(request.Context(), cookieID, itemID); readErr != nil {
		writeErrCode(writer, http.StatusNotFound, "item_not_found", "商品不在本地列表中，请先核对", "")
		return
	}
	// session 是 HTTP 认证上下文，平台账号凭证不会进入 handler。
	session := auth.SessionFromContext(request.Context())
	// refreshErr 是读取本件商品并保存统计的结果，任何错误都不触发下一个商品或其它平台 API。
	refreshErr := server.applicationServiceSet().itemRemoteManage.Execute(request.Context(), itemapp.RemoteItemInput{
		UserID: session.UserID, CookieID: cookieID, ItemID: itemID, Action: itemapp.RemoteItemRefreshMetricsAction,
	})
	if refreshErr != nil {
		// saveErr 区分平台已读但本地统计保存失败，不输出内部错误或原始平台响应。
		var saveErr *itemapp.RemoteItemLocalSaveError
		if errors.As(refreshErr, &saveErr) {
			writeErrCode(writer, http.StatusInternalServerError, "item_metrics_save_failed", "已读取商品指标，但本地保存失败，请稍后手动重试", "")
		} else if platformRiskVerificationError(refreshErr) {
			writeErrCode(writer, http.StatusBadGateway, "item_metrics_risk_verification", "闲鱼触发安全验证（RGV587），请先在闲鱼处理验证后再刷新，不要连续重试", "")
		} else {
			writeErrCode(writer, http.StatusBadGateway, "item_metrics_refresh_failed", "商品指标读取失败，请核对账号验证状态后手动重试", "")
		}
		return
	}
	// item、readErr 是保存后重新查询的商品 UI 数据源，前端可用它替换当前行。
	item, readErr := catalog.Get(request.Context(), cookieID, itemID)
	if readErr != nil {
		writeErrCode(writer, http.StatusInternalServerError, "item_metrics_read_failed", "指标已读取，但本地商品暂时不可用", "")
		return
	}
	writeJSON(writer, http.StatusOK, itemToMap(item))
}

// platformRiskVerificationError 只识别平台验证/风控文本，用于把刷新失败翻译成可操作提示，不输出原始响应。
func platformRiskVerificationError(err error) bool {
	if err == nil {
		return false
	}
	// message 只做脱敏后的关键词匹配，不写入日志或响应。
	message := strings.ToUpper(err.Error())
	return strings.Contains(message, "RGV587") ||
		strings.Contains(message, "USER_VALIDATE") ||
		strings.Contains(message, "安全验证") ||
		strings.Contains(message, "风控验证")
}
