package server

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	itemapp "xianyu-go/internal/application/items"
	"xianyu-go/internal/auth"
	"xianyu-go/internal/xianyu/mtop"
)

// itemRemoteEditRequest 是修改闲鱼平台商品的可选字段 DTO；不接收本地规则或原始商品 JSON。
type itemRemoteEditRequest struct {
	// ItemTitle 是可选的新商品标题。
	ItemTitle *string `json:"item_title"`
	// ItemDescription 是可选的新商品描述。
	ItemDescription *string `json:"item_description"`
	// ItemPrice 是可选的人民币元售价。
	ItemPrice *string `json:"item_price"`
}

// itemRemoteActionResponse 是平台确认成功且本地同步完成后的用户可见回执。
type itemRemoteActionResponse struct {
	// Success 为 true 仅表示平台和本地均完成。
	Success bool `json:"success"`
	// Message 告知本次平台操作已确认。
	Message string `json:"message"`
	// ShelfState 是明确的最新状态，编辑操作为空串。
	ShelfState string `json:"shelf_state"`
}

// itemBargainRequest 是开启或关闭商品“2 人小刀”的请求体。
type itemBargainRequest struct {
	// Enabled 为 true 表示开启，false 表示关闭。
	Enabled *bool `json:"enabled"`
}

// editItemOnPlatform 将用户明确修改的标题、描述或价格提交到闲鱼，成功后才更新本地缓存。
func (s *Server) editItemOnPlatform(w http.ResponseWriter, r *http.Request) {
	// request 是经过 JSON 解码的用户修改字段，不包含平台凭证。
	var request itemRemoteEditRequest
	// err 是请求体 JSON 格式或字段非法时的错误。
	if err := decodeJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "编辑商品请求格式错误")
		return
	}
	s.runRemoteItemAction(w, r, itemapp.RemoteItemInput{
		Action: itemapp.RemoteItemEditAction, Title: request.ItemTitle,
		Description: request.ItemDescription, Price: request.ItemPrice,
	})
}

// downShelfItemOnPlatform 只响应用户明确点击的“下架”，不删除本地商品及自动发货规则。
func (s *Server) downShelfItemOnPlatform(w http.ResponseWriter, r *http.Request) {
	s.runRemoteItemAction(w, r, itemapp.RemoteItemInput{Action: itemapp.RemoteItemDownShelfAction})
}

// reshelfItemOnPlatform 使用平台最新完整详情尝试重新上架，平台虚拟类目不支持时安全拒绝。
func (s *Server) reshelfItemOnPlatform(w http.ResponseWriter, r *http.Request) {
	s.runRemoteItemAction(w, r, itemapp.RemoteItemInput{Action: itemapp.RemoteItemReshelfAction})
}

// setItemBargainOnPlatform 将用户确认的小刀开关提交到闲鱼，平台不支持网页编辑时返回明确指引。
func (s *Server) setItemBargainOnPlatform(w http.ResponseWriter, r *http.Request) {
	var request itemBargainRequest
	if err := decodeJSON(r, &request); err != nil || request.Enabled == nil {
		writeErr(w, http.StatusBadRequest, "小刀开关请求格式错误")
		return
	}
	s.runRemoteItemAction(w, r, itemapp.RemoteItemInput{Action: itemapp.RemoteItemBargainAction, Bargain: request.Enabled})
}

// deleteItemOnPlatform 响应用户明确点击的“删除”，平台确认后才逻辑删除本地商品及规则。
func (s *Server) deleteItemOnPlatform(w http.ResponseWriter, r *http.Request) {
	s.runRemoteItemAction(w, r, itemapp.RemoteItemInput{Action: itemapp.RemoteItemDeleteAction})
}

// runRemoteItemAction 根据已认证会话及账号归属执行业务用例；平台拒绝或结果未知时不自动重试。
func (s *Server) runRemoteItemAction(w http.ResponseWriter, r *http.Request, input itemapp.RemoteItemInput) {
	// cookieID、itemID 是路径中的账号和商品归属标识。
	cookieID, itemID := strings.TrimSpace(chi.URLParam(r, "cookie_id")), strings.TrimSpace(chi.URLParam(r, "item_id"))
	if !s.requireCookieOwnership(w, r, cookieID) {
		return
	}
	if itemID == "" {
		writeErr(w, http.StatusBadRequest, "商品 ID 不能为空")
		return
	}
	// session 是经认证中间件验证的当前用户身份。
	session := auth.SessionFromContext(r.Context())
	input.UserID, input.CookieID, input.ItemID = session.UserID, cookieID, itemID
	// actionErr 是平台和本地依次执行的返回结果；不能仅凭 HTTP 请求成功就推断平台操作成功。
	actionErr := s.applicationServiceSet().itemRemoteManage.Execute(r.Context(), input)
	if actionErr != nil {
		// localErr 表示平台操作完成但本地记录未保存，用户不能直接再次点击操作。
		var localErr *itemapp.RemoteItemLocalSaveError
		// platformErr 保存平台明确返回的失败分类，用于把“不支持网页编辑/无忧卖限制”翻译成可执行提示。
		var platformErr *mtop.MTopResponseError
		switch {
		case errors.Is(actionErr, itemapp.ErrCatalogNotFound):
			writeErrCode(w, http.StatusNotFound, "item_not_found", "商品不在本地列表中，请先同步并核对", "")
		case errors.As(actionErr, &localErr):
			writeErrCode(w, http.StatusInternalServerError, "remote_changed_local_save_failed", localErr.Error(), "")
		case errors.As(actionErr, &platformErr) && strings.Contains(strings.ToUpper(strings.Join(platformErr.Ret, "；")), "NOT_SUPPORT_PUBLISH_OR_EDIT"):
			writeErrCode(w, http.StatusForbidden, "pc_publish_unsupported", "该商品暂不支持网页端编辑，请到闲鱼 APP 操作；成功后返回本系统同步商品列表。重复网页提交无法解决。", "")
		case errors.As(actionErr, &platformErr) && strings.Contains(strings.ToUpper(strings.Join(platformErr.Ret, "；")), "DOWN_SHELF_FAIL"):
			writeErrCode(w, http.StatusForbidden, "wuyoumai_shelf_managed_in_app", "该商品受「无忧卖」保护，请在闲鱼 APP 的「无忧卖-售卖中」修改价格和库存或上下架；网页端无法直接操作。", "")
		case strings.Contains(actionErr.Error(), "不能为空"), strings.Contains(actionErr.Error(), "价格"), strings.Contains(actionErr.Error(), "至少修改"), strings.Contains(actionErr.Error(), "无效"), strings.Contains(actionErr.Error(), "已下架"):
			writeErrCode(w, http.StatusBadRequest, "invalid_item_edit", actionErr.Error(), "")
		default:
			// 不向响应泄露 Cookie、请求体、平台原始响应；明确提示人工检查平台真实状态。
			writeErrCode(w, http.StatusBadGateway, "remote_item_operation_failed", "闲鱼未确认操作成功，可能因虚拟类目限制、账号验证或平台异常；请到闲鱼确认状态后再决定是否重试", "")
		}
		return
	}
	// shelfState、message 是已成功执行操作的回执，不携带任何原始平台数据。
	shelfState, message := "", "商品修改已同步到闲鱼并保存到本地"
	switch input.Action {
	case itemapp.RemoteItemDownShelfAction:
		shelfState, message = "off", "商品已在闲鱼下架，保留本地资料和自动发货规则"
	case itemapp.RemoteItemReshelfAction:
		shelfState, message = "on", "闲鱼已确认重新上架，保留商品原有资料和规则"
	case itemapp.RemoteItemDeleteAction:
		shelfState, message = "", "商品已从闲鱼删除，并同步清理本地记录和商品级规则"
	case itemapp.RemoteItemBargainAction:
		shelfState, message = "", "小刀开关已同步到闲鱼并保存到本地"
	}
	writeJSON(w, http.StatusOK, itemRemoteActionResponse{Success: true, Message: message, ShelfState: shelfState})
}
