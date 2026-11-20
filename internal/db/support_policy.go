package db

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"xianyu-go/internal/supportpolicy"
)

// SupportRepository 是基于已有用户设置表的客服策略仓储，无需新增数据库表或接触账号凭证。
type SupportRepository struct {
	// store 保存本地账号归属和用户设置入口。
	store *Store
}

// NewSupportRepository 构造仅限当前本地数据库的客服存储。
func NewSupportRepository(store *Store) *SupportRepository { return &SupportRepository{store: store} }

// owner 校验账号存在并取得用户隔离范围。
func (r *SupportRepository) owner(ctx context.Context, accountID string) (int64, error) {
	if r == nil || r.store == nil || r.store.Cookies == nil || r.store.UserSettings == nil {
		return 0, errors.New("客服存储未初始化")
	}
	return r.store.Cookies.GetOwnerID(ctx, accountID)
}

// Load 读取指定账号所有者的知识与安全配置。
func (r *SupportRepository) Load(ctx context.Context, accountID string) (supportpolicy.Config, error) {
	// ownerID、err 是非敏感账号所有者及查询错误。
	ownerID, err := r.owner(ctx, accountID)
	if err != nil {
		return supportpolicy.Config{}, err
	}
	// raw、err 是用户隔离的客服配置与读取错误。
	raw, err := r.store.UserSettings.GetForUser(ctx, ownerID, supportpolicy.ConfigKey)
	if err != nil {
		return supportpolicy.Config{}, err
	}
	return supportpolicy.Decode(raw)
}

// ReadTakeover 读取当前账号会话的持久化接管状态，未知状态返回错误。
func (r *SupportRepository) ReadTakeover(ctx context.Context, accountID, chatID string) (supportpolicy.Takeover, error) {
	// ownerID、err 是当前账号归属结果。
	ownerID, err := r.owner(ctx, accountID)
	if err != nil {
		return supportpolicy.Takeover{}, err
	}
	// key 是独立会话的用户设置键。
	key := supportpolicy.TakeoverKey(accountID, chatID)
	// raw、err 保存持久化状态与读取错误。
	raw, err := r.store.UserSettings.GetForUser(ctx, ownerID, key)
	if err != nil || raw == "" {
		return supportpolicy.Takeover{}, err
	}
	return supportpolicy.DecodeTakeover(key, raw)
}

// MarkTakeover 自动记录人工介入或风险转人工；已在无限期接管中时不缩短接管窗口。
func (r *SupportRepository) MarkTakeover(ctx context.Context, accountID, chatID, reason string, until int64) error {
	// ownerID、err 是账号的实际所有者及错误。
	ownerID, err := r.owner(ctx, accountID)
	if err != nil {
		return err
	}
	chatID = supportpolicy.NormalizeChatID(chatID)
	if chatID == "" || len(chatID) > 160 {
		return errors.New("接管会话标识无效")
	}
	// key 是隔离后的记录键。
	key := supportpolicy.TakeoverKey(accountID, chatID)
	r.store.UserSettings.supportMu.Lock()
	defer r.store.UserSettings.supportMu.Unlock()
	// raw、err 是最近一条状态，不允许自动事件缩短已有效的人工接管。
	raw, err := r.store.UserSettings.GetForUser(ctx, ownerID, key)
	if err != nil {
		return err
	}
	if strings.TrimSpace(raw) != "" {
		// prev、decodeErr 是此前的接管记录及校验错误。
		prev, decodeErr := supportpolicy.DecodeTakeover(key, raw)
		if decodeErr != nil {
			return decodeErr
		}
		if prev.Until == -1 || (until != -1 && prev.Until >= until) {
			return nil
		}
	}
	// row 是本轮新增的接管状态，不保存消息正文。
	row := supportpolicy.Takeover{AccountID: accountID, ChatID: chatID, Reason: reason, Until: until, UpdatedAt: time.Now().UnixMilli()}
	// encoded、err 是持久化文本及编码错误。
	encoded, err := json.Marshal(row)
	if err != nil {
		return err
	}
	return r.store.UserSettings.SetForUser(ctx, ownerID, key, string(encoded))
}

// SetSupportTakeover 将商家明确的暂停或恢复动作和自动接管记录在同一进程内串行化。
func (s *UserSettings) SetSupportTakeover(ctx context.Context, userID int64, key, value string) error {
	s.supportMu.Lock()
	defer s.supportMu.Unlock()
	return s.SetForUser(ctx, userID, key, value)
}
