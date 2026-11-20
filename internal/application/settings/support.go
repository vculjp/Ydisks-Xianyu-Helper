package settings

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"xianyu-go/internal/supportpolicy"
)

// SupportPreview 是只读客服沙盒的诊断结果，不返回候选危险正文、提示词、买家历史或密钥。
type SupportPreview struct {
	// Source 标记 FAQ、AI 或未匹配的处理源。
	Source string
	// Reply 是通过质量检查的候选回复，拒绝时为空。
	Reply string
	// Decision 是 pass、manual 或 unmatched。
	Decision string
	// Reason 是供商家诊断的非敏感分类说明。
	Reason string
}

// SetSupportTakeover 操作员显式暂停或恢复一个会话，不需要向浏览器暴露存储键计算规则。
func (s *Service) SetSupportTakeover(ctx context.Context, userID int64, accountID, chatID string, paused bool) error {
	accountID, chatID = strings.TrimSpace(accountID), supportpolicy.NormalizeChatID(chatID)
	// row 是待保存的固定来源接管操作。
	row := supportpolicy.Takeover{AccountID: accountID, ChatID: chatID, Reason: "resumed"}
	if paused {
		row.Until = -1
		row.Reason = "operator"
	}
	// raw、err 保存待校验的操作内容。
	raw, err := json.Marshal(row)
	if err != nil {
		return err
	}
	return s.SetUser(ctx, userID, supportpolicy.TakeoverKey(accountID, chatID), string(raw))
}

// supportPreviewPort 是只读沙盒用例的独立适配器接口。
type supportPreviewPort interface {
	// PreviewSupport 只生成建议，不调用平台，不修改真实会话或创建报价。
	PreviewSupport(context.Context, string, string, string) (SupportPreview, error)
}

// supportItemChecker 校验知识所绑定的本地商品属于指定账号。
type supportItemChecker interface {
	// CheckSupportItem 仅查询本地商品，不访问平台。
	CheckSupportItem(context.Context, string, string) error
}

// PreviewSupport 校验账号归属与合成输入后执行独立沙盒。
func (s *Service) PreviewSupport(ctx context.Context, userID int64, accountID, itemID, message string) (SupportPreview, error) {
	accountID, itemID, message = strings.TrimSpace(accountID), strings.TrimSpace(itemID), strings.TrimSpace(message)
	// err 是沙盒账号归属校验失败。
	if err := s.ensureOwned(ctx, userID, accountID); err != nil {
		return SupportPreview{}, err
	}
	if message == "" || utf8.RuneCountInString(message) > 1000 || len(itemID) > 160 {
		return SupportPreview{}, errors.New("沙盒输入无效")
	}
	// preview、ok 是独立预览端口及其装配情况。
	preview, ok := s.repository.(supportPreviewPort)
	if !ok {
		return SupportPreview{}, errors.New("客服沙盒未初始化")
	}
	return preview.PreviewSupport(ctx, accountID, itemID, message)
}
