package engine

import (
	"context"
	"strings"
	"time"
	"xianyu-go/internal/db"
	"xianyu-go/internal/supportpolicy"
)

// manualTakeoverGate 是一次回复处理读取到的人工介入暂停状态。
type manualTakeoverGate struct {
	// paused 表示会话当前处于人工介入暂停窗口内。
	paused bool
	// scopeAll 表示暂停范围为全部自动回复；false 时只暂停 Agent 与 AI。
	scopeAll bool
	// window 是账号配置的暂停窗口时长；非正表示功能关闭。
	window time.Duration
	// managed 表示启用受控客服模式，外部 Agent 不参与此模式。
	managed bool
}

// skipAll 判断本次是否跳过全部自动回复。
func (g manualTakeoverGate) skipAll() bool { return g.paused && g.scopeAll }

// skipGenerative 判断本次是否跳过 Agent 与 AI 生成式回复；两种暂停范围都包含它们。
func (g manualTakeoverGate) skipGenerative() bool { return g.paused }

// loadManualTakeoverGate 读取旧人工窗口与持久化接管；受控状态不明时停止自动回复。
func (r *ReplyService) loadManualTakeoverGate(ctx context.Context, chatID string) manualTakeoverGate {
	if r.manualTakeover == nil || r.store == nil || r.store.Cookies == nil || strings.TrimSpace(chatID) == "" {
		return manualTakeoverGate{}
	}
	// managed 标记已经启用用户级客服安全策略。
	managed := false
	if r.support != nil {
		// bounded、cancel 为本地配置读操作限制预算。
		bounded, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		// cfg、err 是当前知识模式与本地查询错误。
		cfg, err := r.support.Load(bounded, r.cookieID)
		if err != nil {
			return manualTakeoverGate{paused: true, scopeAll: true, managed: true}
		}
		managed = cfg.Enabled
		// row、err 是独立会话的持久化接管记录；关闭知识模式不能隐式解除已有接管。
		row, err := r.support.ReadTakeover(bounded, r.cookieID, chatID)
		if err != nil {
			return manualTakeoverGate{paused: true, scopeAll: true, managed: managed}
		}
		if row.Active(time.Now()) {
			return manualTakeoverGate{paused: true, scopeAll: true, managed: managed}
		}
		if row.Reason == "resumed" {
			// at、ok 判断显式恢复后是否又发生了更新的人工作业。
			at, ok := r.manualTakeover.manualSince(chatID)
			if !ok || at.UnixMilli() <= row.UpdatedAt {
				return manualTakeoverGate{managed: managed}
			}
		}
		if managed {
			// at、ok 保留本地持久化失败时的安全暂停；显式恢复后不受旧内存标记影响。
			at, ok := r.manualTakeover.manualSince(chatID)
			if ok && at.UnixMilli() > row.UpdatedAt {
				return manualTakeoverGate{paused: true, scopeAll: true, managed: true}
			}
			return manualTakeoverGate{managed: true}
		}
	}
	// setting、err 是账号级暂停分钟数与范围，只读取非敏感列。
	setting, err := r.store.Cookies.GetManualTakeoverSetting(ctx, r.cookieID)
	if err != nil {
		r.logger.WarnContext(ctx, "读取人工介入暂停配置失败，本条消息不做人工介入暂停", "err", err)
		return manualTakeoverGate{managed: managed}
	}
	// window 是配置的暂停窗口时长。
	window := time.Duration(setting.Minutes) * time.Minute
	return manualTakeoverGate{paused: r.manualTakeover.isPaused(chatID, window), scopeAll: setting.Scope == db.ManualTakeoverScopeAll, window: window}
}

// persistSupportHandoff 将受控客服的人工作业或风险转人工持久化，写入失败仍保留现有本地人工标记。
func (r *ReplyService) persistSupportHandoff(ctx context.Context, chatID, reason string) {
	if r == nil || r.support == nil || strings.TrimSpace(chatID) == "" {
		return
	}
	// bounded、cancel 将本地数据库访问限制在短时间内，不启动后台任务。
	bounded, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	// cfg、err 获取用户级安全模式，不改变旧版关闭模式的暂停策略。
	cfg, err := r.support.Load(bounded, r.cookieID)
	if err != nil {
		r.logger.WarnContext(ctx, "客服接管配置读取失败")
		return
	}
	if !cfg.Enabled {
		return
	}
	// until 默认无限期，明确人工回复则沿用账号设置的分钟数，未设置时采用三十分钟。
	until := int64(-1)
	if reason == "human" {
		// setting、settingErr 只读取本地人工暂停配置。
		setting, settingErr := r.store.Cookies.GetManualTakeoverSetting(bounded, r.cookieID)
		// minutes 是本次人工回复的暂停时长。
		minutes := 30
		if settingErr == nil && setting.Minutes > 0 {
			minutes = setting.Minutes
		}
		until = time.Now().Add(time.Duration(minutes) * time.Minute).Unix()
	}
	// err 是持久化接管的异常；不记录原始消息或凭证。
	if err := r.support.MarkTakeover(bounded, r.cookieID, chatID, reason, until); err != nil {
		r.logger.WarnContext(ctx, "客服接管状态持久化失败")
	}
}

// requestManualReply 在命中“通知人工”关键词后让会话进入人工介入窗口，并在去重窗口内最多发送一次通知。
// 通知失败只记录日志，不影响本条消息的回复结果。
func (r *ReplyService) requestManualReply(ctx context.Context, m ChatMessage) {
	if strings.TrimSpace(m.ChatID) == "" {
		return
	}
	if r.manualTakeover != nil {
		r.manualTakeover.markManual(m.ChatID, r.manualTakeover.now())
		r.persistSupportHandoff(ctx, m.ChatID, "risk")
		if !r.manualTakeover.claimManualNotification(m.ChatID) {
			r.logger.DebugContext(ctx, "会话已在去重窗口内通知过人工客服，跳过重复通知")
			return
		}
	}
	// handler 是当前业务处理器；未装配或未实现通知端口时只记录日志。
	var handler Handler
	if r.manualRequests != nil {
		handler = r.manualRequests()
	}
	// notifier、supported 是可选的人工客服通知端口及其实现判断。
	notifier, supported := handler.(chatManualRequestHandler)
	if !supported {
		r.logger.WarnContext(ctx, "买家请求人工客服，但当前未装配通知端口")
		return
	}
	// err 保存通知发送失败原因；通知是旁路，不阻断回复。
	if err := notifier.RequestManualReply(ctx, ChatManualRequest{AccountID: r.cookieID, ChatID: m.ChatID, BuyerID: m.SenderUserID, BuyerName: m.SenderName, ItemID: m.ItemID, Text: m.Text}); err != nil {
		r.logger.WarnContext(ctx, "发送买家请求人工客服通知失败", "err", err)
		return
	}
	r.logger.InfoContext(ctx, "买家请求人工客服，已发送通知")
}

// allowResolvedReply 发送前复核人工接管和受控回复质量，拒绝的候选不进入投递。
func (r *ReplyService) allowResolvedReply(ctx context.Context, m ChatMessage, res *ReplyResult, gate manualTakeoverGate) bool {
	if !res.NotifyManual && r.support != nil {
		// fresh 是实际发送之前重新读取的状态，覆盖生成期间的人工接管和模式变更。
		fresh := r.loadManualTakeoverGate(ctx, m.ChatID)
		if fresh.skipAll() || ((res.Source == "AI" || res.Source == "FAQ") && fresh.skipGenerative()) {
			return false
		}
		if fresh.managed && (res.Source == "AI" || res.Source == "FAQ") {
			// reason 是候选的最终质量校验结果。
			reason := supportpolicy.RiskReason(m.Text)
			if reason == "" {
				reason = supportpolicy.CheckReply(res.Text, isBargainMessageText(m.Text))
			}
			if reason != "" {
				// notice 仅包含非敏感人工核对原因。
				notice := m
				notice.Text = reason
				r.requestManualReply(ctx, notice)
				return false
			}
		}
	}
	if (res.Source == "AI" || res.Source == "FAQ") && r.manualTakeover.isPaused(m.ChatID, gate.window) {
		r.logger.InfoContext(ctx, "AI 回复生成期间检测到人工介入，放弃发送", "reply_skipped", "manual_takeover")
		return false
	}
	return true
}
