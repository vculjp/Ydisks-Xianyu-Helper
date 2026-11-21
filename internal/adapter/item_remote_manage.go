package adapter

import (
	"context"
	"errors"
	"fmt"
	"time"

	itemapp "xianyu-go/internal/application/items"
	"xianyu-go/internal/xianyu/mtop"
)

// remoteItemMTop 是单件商品平台编辑、下架的窄接口；不改变已有 MTOPClient 兼容契约。
type remoteItemMTop interface {
	// EditExistingItem 读取原详情并向平台提交一次最小修改或重新上架。
	EditExistingItem(context.Context, string, string, mtop.RemoteItemEdit) (string, error)
	// DownShelfItem 提交一次平台下架并验证平台明确成功。
	DownShelfItem(context.Context, string, string) (string, error)
	// ReshelfExistingItem 在平台编辑成功后还须核实商品出现在在售列表中。
	ReshelfExistingItem(context.Context, string, string) (string, error)
}

// Edit 在已验证归属的 Cookie 会话中修改平台商品；本地字段由上层应用服务写入。
func (p *ItemPublishPort) Edit(ctx context.Context, userID int64, cookieID, itemID string, changes itemapp.RemoteItemChanges) error {
	// request 是显式改动字段的协议类型，价格单位为分。
	request := mtop.RemoteItemEdit{Title: changes.Title, Description: changes.Description, PriceCents: changes.PriceCents}
	return p.remoteItemCall(ctx, userID, cookieID, itemID, "edit", request)
}

// DownShelf 在真实平台确认下架后才返回成功；不直接删除本地商品或发货规则。
func (p *ItemPublishPort) DownShelf(ctx context.Context, userID int64, cookieID, itemID string) error {
	return p.remoteItemCall(ctx, userID, cookieID, itemID, "downshelf", mtop.RemoteItemEdit{})
}

// Reshelf 通过保留全部平台编辑详情来尝试重新上架，遇平台类目限制会直接返回错误。
func (p *ItemPublishPort) Reshelf(ctx context.Context, userID int64, cookieID, itemID string) error {
	return p.remoteItemCall(ctx, userID, cookieID, itemID, "reshelf", mtop.RemoteItemEdit{})
}

// remoteItemCall 使用短期凭证快照执行用户明确操作；绝不在持有 Cookie 锁时请求平台或自动重放修改。
func (p *ItemPublishPort) remoteItemCall(ctx context.Context, userID int64, cookieID, itemID, action string, changes mtop.RemoteItemEdit) error {
	if p == nil || p.store == nil || p.store.Cookies == nil || userID <= 0 {
		return errors.New("商品平台管理依赖无效")
	}
	// client、ok 是构造阶段注入的 MTOP 客户端，仅运行平台支持的窄能力。
	client, ok := p.mtopClient().(remoteItemMTop)
	if !ok {
		return errors.New("当前客户端不支持平台商品编辑和上下架")
	}
	// unlock 序列化凭证快照读取；慢速平台请求发生前必须释放。
	unlock := p.store.LockAccountCredentials(cookieID)
	// detail、readErr 是归属当前用户的凭证快照及读取错误，不向 HTTP 响应或日志暴露。
	detail, readErr := p.store.Cookies.GetCookiePlatformRuntimeData(ctx, cookieID)
	if readErr != nil || detail.UserID != userID || !hasStoredCredential(detail) {
		unlock()
		return errors.New("商品所属账号凭证不可用或已变化")
	}
	// initialValue、initialMetadata 是平台操作前的凭证版本，用于完成后防止覆盖新登录。
	initialValue, initialMetadata := detail.Value, detail.MetadataJSON
	// requestCtx、cancel 将单件修改或下架限定在受控时间内，不增加后台轮询或并发请求。
	requestCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	// mtopCtx、session 是本次请求独享的 Cookie Jar 快照。
	mtopCtx, session := withCookieSnapshot(requestCtx, detail)
	unlock()

	// updated、callErr 是平台确认后的新 Cookie 与可能的网络/业务拒绝原因。
	var updated string
	// callErr 保存这次单件操作的平台返回错误，绝不在不确定时自动重试。
	var callErr error
	switch action {
	case "edit":
		updated, callErr = client.EditExistingItem(mtopCtx, initialValue, itemID, changes)
	case "reshelf":
		updated, callErr = client.ReshelfExistingItem(mtopCtx, initialValue, itemID)
	case "downshelf":
		updated, callErr = client.DownShelfItem(mtopCtx, initialValue, itemID)
	default:
		return errors.New("未知平台商品操作")
	}
	// runtimeCookie、persistErr 保存响应会话变化，同时复核账号凭证版本，避免覆盖并发重新登录。
	runtimeCookie, persistErr := p.persistCategorySession(ctx, userID, cookieID, initialValue, initialMetadata, session, updated)
	if runtimeCookie != "" && p.updateRunningCookie != nil {
		p.updateRunningCookie(ctx, cookieID, runtimeCookie)
	}
	if persistErr != nil {
		return fmt.Errorf("平台操作结果需人工核对，账号 Cookie 更新失败: %w", persistErr)
	}
	if callErr != nil {
		// 平台风控或 Session 失效时只报告错误，不自动二次提交编辑或上下架操作。
		p.recoverExpired(ctx, cookieID, callErr)
		return callErr
	}
	return nil
}

// 编译期保证共用的商品发布适配器也实现了单件平台管理用例。
var _ itemapp.RemoteItemPlatform = (*ItemPublishPort)(nil)
