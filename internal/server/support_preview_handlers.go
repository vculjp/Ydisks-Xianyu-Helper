package server

import (
	"net/http"
)

// supportPreviewRequest 是合成客服问题，不接收会话 ID 或买家信息。
type supportPreviewRequest struct {
	// AccountID 是当前用户拥有的店铺。
	AccountID string `json:"account_id"`
	// ItemID 是可选的该店铺商品。
	ItemID string `json:"item_id"`
	// Message 是商家在沙盒手动输入的测试问题。
	Message string `json:"message"`
}

// supportPreviewResponse 仅返回经过检查的建议与处理决策。
type supportPreviewResponse struct {
	// Source 是 FAQ 或 AI，未匹配时为空。
	Source string `json:"source"`
	// Reply 是通过质量门禁的候选回复。
	Reply string `json:"reply"`
	// Decision 是 pass、manual 或 unmatched。
	Decision string `json:"decision"`
	// Reason 是不含秘密的诊断分类。
	Reason string `json:"reason"`
}

// supportTakeoverRequest 是操作员手动管理会话时提交的独立动作。
type supportTakeoverRequest struct {
	// AccountID 是拥有该会话的店铺。
	AccountID string `json:"account_id"`
	// ChatID 是本地聊天会话标识。
	ChatID string `json:"chat_id"`
	// Paused 为 true 时等待人工恢复，为 false 时解除接管。
	Paused *bool `json:"paused"`
}

// setCustomerSupportTakeover 仅修改本人账号的本地接管状态，不发送平台请求。
func (s *Server) setCustomerSupportTakeover(w http.ResponseWriter, r *http.Request) {
	// sess 是当前认证的本地用户。
	sess := authSess(r)
	if sess == nil {
		writeErr(w, http.StatusUnauthorized, "未授权访问")
		return
	}
	// request 是用户显式提交的会话操作。
	var request supportTakeoverRequest
	// err 是人工接管输入解析异常。
	if err := decodeJSON(r, &request); err != nil || request.Paused == nil {
		writeErr(w, http.StatusBadRequest, "接管操作无效")
		return
	}
	// err 是暂停或恢复状态的本地写入异常。
	if err := s.settingsApplication().SetSupportTakeover(r.Context(), sess.UserID, request.AccountID, request.ChatID, *request.Paused); err != nil {
		if writeSettingsAccountError(w, err) {
			return
		}
		writeErr(w, http.StatusBadRequest, "会话接管操作未保存")
		return
	}
	writeJSON(w, http.StatusOK, operationResponse{Success: true})
}

// previewCustomerSupport 承载已登录商家的只读客服模拟测试。
func (s *Server) previewCustomerSupport(w http.ResponseWriter, r *http.Request) {
	// sess 是认证中间件确定的本地用户。
	sess := authSess(r)
	if sess == nil {
		writeErr(w, http.StatusUnauthorized, "未授权访问")
		return
	}
	// request 是不含真实会话的合成问题。
	var request supportPreviewRequest
	// err 是合成问题的请求解析异常。
	if err := decodeJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, "测试输入格式无效")
		return
	}
	// result、err 是只读模拟结果与应用层验证错误。
	result, err := s.settingsApplication().PreviewSupport(r.Context(), sess.UserID, request.AccountID, request.ItemID, request.Message)
	if err != nil {
		if writeSettingsAccountError(w, err) {
			return
		}
		writeErr(w, http.StatusBadRequest, "沙盒输入或商品归属无效")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, supportPreviewResponse{Source: result.Source, Reply: result.Reply, Decision: result.Decision, Reason: result.Reason})
}
