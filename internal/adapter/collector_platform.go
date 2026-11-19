package adapter

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	collectorapp "xianyu-go/internal/application/collector"
	"xianyu-go/internal/db"
	"xianyu-go/internal/xianyu/cookierefresh"
	"xianyu-go/internal/xianyu/mtop"
)

// collectorMTopClient 是商品采集适配器所需的最小平台客户端契约，由 *mtop.ClientImpl 实现。
type collectorMTopClient interface {
	// SearchMarketItems 执行单页全站关键词搜索。
	SearchMarketItems(ctx context.Context, cookiesStr string, req mtop.MarketSearchRequest) (*mtop.MarketSearchResult, error)
	// FetchMarketItemDetail 拉取单件商品完整详情。
	FetchMarketItemDetail(ctx context.Context, cookiesStr, itemID string) (*mtop.MarketCollectedItem, string, error)
	// FetchSellerShopPage 拉取指定卖家单页在售商品列表。
	FetchSellerShopPage(ctx context.Context, cookiesStr, sellerUserID string, pageNumber, pageSize int) (*mtop.MarketSearchResult, error)
}

// CollectorPlatformPort 将商品采集应用端口适配到数据库凭证管理与闲鱼 MTOP 协议层。
type CollectorPlatformPort struct {
	// store 提供非敏感账号归属检查与受互斥锁保护的 Cookie 会话提交。
	store *db.Store
	// client 提供遵循账号级节流器的 MTOP 客户端实例。
	client func() collectorMTopClient
	// logger 输出不含 Cookie 明文的采集操作摘要。
	logger *slog.Logger
	// updateRunningCookie 在平台返回新 Cookie 后通知运行中的账号实例同步。
	updateRunningCookie func(context.Context, string, string)
	// recoverExpiredSession 在明确判定登录失效时唤醒账号恢复链路。
	recoverExpiredSession func(context.Context, string, error)
}

// NewCollectorPlatformPort 构造商品采集平台适配器。
func NewCollectorPlatformPort(
	store *db.Store,
	client func() MTOPClient,
	logger *slog.Logger,
	updateRunningCookie func(context.Context, string, string),
	recoverExpiredSession func(context.Context, string, error),
) *CollectorPlatformPort {
	if logger == nil {
		logger = slog.Default()
	}
	// resolveClient 优先将组合根注入的共享客户端断言为采集接口，测试替身不支持时安全回退为标准客户端。
	resolveClient := func() collectorMTopClient {
		if client != nil {
			// candidate、ok 断言共享客户端是否已实现采集方法。
			if candidate, ok := client().(collectorMTopClient); ok && candidate != nil {
				return candidate
			}
		}
		return mtop.NewClient()
	}
	return &CollectorPlatformPort{
		store:                 store,
		client:                resolveClient,
		logger:                logger,
		updateRunningCookie:   updateRunningCookie,
		recoverExpiredSession: recoverExpiredSession,
	}
}

// OwnsAccount 仅读取账号 owner 列校验归属，不解密任何 Cookie 或令牌。
func (p *CollectorPlatformPort) OwnsAccount(ctx context.Context, userID int64, cookieID string) (bool, error) {
	if p == nil || p.store == nil || p.store.Cookies == nil {
		return false, errors.New("采集存储未初始化")
	}
	// ownerID、err 查询账号所属用户主键。
	ownerID, err := p.store.Cookies.GetOwnerID(ctx, strings.TrimSpace(cookieID))
	if errors.Is(err, db.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return ownerID == userID, nil
}

// SearchMarket 使用指定账号执行单页全站关键词搜索并回写任何更新后的 Cookie。
func (p *CollectorPlatformPort) SearchMarket(ctx context.Context, cookieID string, params collectorapp.PlatformSearchParams) ([]collectorapp.CollectedItem, bool, int, error) {
	// requestCtx、cancel 限制单页搜索总时长。
	requestCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	// snapshot、cookieVal、callCtx、session、beginErr 准备非持锁的平台调用会话。
	snapshot, cookieVal, callCtx, session, beginErr := p.beginSession(requestCtx, cookieID, params.Background)
	if beginErr != nil {
		return nil, false, 0, beginErr
	}
	// res、callErr 发起经节流器保护的搜索请求。
	res, callErr := p.client().SearchMarketItems(callCtx, cookieVal, mtop.MarketSearchRequest{
		Keyword:     params.Keyword,
		PageNumber:  params.PageNumber,
		RowsPerPage: params.RowsPerPage,
		SortField:   params.SortField,
		SortValue:   params.SortValue,
		MinPrice:    params.MinPrice,
		MaxPrice:    params.MaxPrice,
		PublishDays: params.PublishDays,
	})
	// updatedCookie 提取平台返回的新 Cookie（成功时）。
	updatedCookie := ""
	if res != nil {
		updatedCookie = res.UpdatedCookies
	}
	// commitErr 提交本次搜索期间可能刷新的令牌。
	if commitErr := p.commitSession(requestCtx, cookieID, snapshot, session, cookieVal, updatedCookie); commitErr != nil && callErr == nil {
		return nil, false, 0, commitErr
	}
	if callErr != nil {
		p.maybeRecoverSession(requestCtx, cookieID, callErr)
		return nil, false, 0, formatCollectorPlatformError(callErr)
	}
	return toAppCollectedItems(res.Items), res.HasMore, res.TotalCount, nil
}

// FetchItemDetail 拉取单件商品详情（包含完整文案与最多 9 张主图）；background 为 true 时使用 ≥5 秒后台慢速节流。
func (p *CollectorPlatformPort) FetchItemDetail(ctx context.Context, cookieID, itemID string, background bool) (collectorapp.CollectedItem, error) {
	// requestCtx、cancel 限制单品详情请求时长（含排队节流预算）。
	requestCtx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()

	// snapshot、cookieVal、callCtx、session、beginErr 准备 Cookie 会话。
	snapshot, cookieVal, callCtx, session, beginErr := p.beginSession(requestCtx, cookieID, background)
	if beginErr != nil {
		return collectorapp.CollectedItem{}, beginErr
	}
	// detail、updatedCookie、callErr 请求商品详情接口。
	detail, updatedCookie, callErr := p.client().FetchMarketItemDetail(callCtx, cookieVal, itemID)
	// commitErr 提交详情请求期间刷新的令牌。
	if commitErr := p.commitSession(requestCtx, cookieID, snapshot, session, cookieVal, updatedCookie); commitErr != nil && callErr == nil {
		return collectorapp.CollectedItem{}, commitErr
	}
	if callErr != nil {
		p.maybeRecoverSession(requestCtx, cookieID, callErr)
		return collectorapp.CollectedItem{}, formatCollectorPlatformError(callErr)
	}
	return toAppCollectedItem(*detail), nil
}

// FetchSellerPage 拉取目标同行卖家单页在售商品列表；background 为 true 时使用 ≥5 秒后台慢速节流。
func (p *CollectorPlatformPort) FetchSellerPage(ctx context.Context, cookieID, sellerID string, pageNumber, pageSize int, background bool) ([]collectorapp.CollectedItem, bool, int, error) {
	// requestCtx、cancel 限制单页店铺采集总时长。
	requestCtx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()

	// snapshot、cookieVal、callCtx、session、beginErr 准备 Cookie 会话。
	snapshot, cookieVal, callCtx, session, beginErr := p.beginSession(requestCtx, cookieID, background)
	if beginErr != nil {
		return nil, false, 0, beginErr
	}
	// res、callErr 请求个人主页商品列表接口。
	res, callErr := p.client().FetchSellerShopPage(callCtx, cookieVal, sellerID, pageNumber, pageSize)
	// updatedCookie 提取可能刷新的凭证。
	updatedCookie := ""
	if res != nil {
		updatedCookie = res.UpdatedCookies
	}
	// commitErr 提交店铺分页请求期间刷新的令牌。
	if commitErr := p.commitSession(requestCtx, cookieID, snapshot, session, cookieVal, updatedCookie); commitErr != nil && callErr == nil {
		return nil, false, 0, commitErr
	}
	if callErr != nil {
		p.maybeRecoverSession(requestCtx, cookieID, callErr)
		return nil, false, 0, formatCollectorPlatformError(callErr)
	}
	return toAppCollectedItems(res.Items), res.HasMore, res.TotalCount, nil
}

// IsAbortError 识别闲鱼风控滑块（RGV587）、登录会话失效或令牌刷新耗尽等必须立即熔断的错误。
func (p *CollectorPlatformPort) IsAbortError(err error) bool {
	if err == nil {
		return false
	}
	return IsBatchAbortError(err) || mtop.IsRiskVerificationErr(err) || mtop.IsSessionExpiredErr(err)
}

// beginSession 短暂加锁读取账号凭证快照并立即释放锁，避免在慢速网络请求期间占用账号凭证锁。
func (p *CollectorPlatformPort) beginSession(ctx context.Context, cookieID string, background bool) (*db.CookiePlatformRuntimeData, string, context.Context, *mtop.CookieSession, error) {
	if p == nil || p.store == nil || p.store.Cookies == nil {
		return nil, "", ctx, nil, errors.New("采集存储未初始化")
	}
	// unlock 保护凭证快照读取，读取完成后立即释放。
	unlock := p.store.LockAccountCredentials(cookieID)
	// latest、loadErr 读取当前账号的平台运行时凭证数据。
	latest, loadErr := p.store.Cookies.GetCookiePlatformRuntimeData(ctx, cookieID)
	unlock()
	if errors.Is(loadErr, db.ErrNotFound) {
		return nil, "", ctx, nil, collectorapp.ErrAccountNotOwned
	}
	if loadErr != nil {
		return nil, "", ctx, nil, fmt.Errorf("读取采集账号凭证失败: %w", loadErr)
	}
	if !hasStoredCredential(latest) {
		return nil, "", ctx, nil, &collectorapp.ValidationError{Message: "所选闲鱼账号尚未登录或 Cookie 已清空，请先在账号管理扫码登录"}
	}
	// callCtx、session 注入 Cookie Jar 快照以供 MTOP 客户端自动吸收 Set-Cookie。
	callCtx, session := withCookieSnapshot(ctx, latest)
	if background {
		callCtx = mtop.WithBackgroundPacing(callCtx)
	}
	return &latest, latest.Value, callCtx, session, nil
}

// commitSession 在网络请求结束后短暂重新加锁，将请求期间刷新过的 _m_h5_tk 令牌安全写回数据库与运行时。
func (p *CollectorPlatformPort) commitSession(ctx context.Context, cookieID string, before *db.CookiePlatformRuntimeData, session *mtop.CookieSession, originalCookie, updatedCookie string) error {
	if before == nil || p == nil || p.store == nil || p.store.Cookies == nil {
		return nil
	}
	// unlock 保护写回阶段的并发一致性。
	unlock := p.store.LockAccountCredentials(cookieID)
	// notifyVal 记录释放锁后需要通知运行时的最新 Cookie。
	notifyVal := ""
	defer func() {
		unlock()
		if notifyVal != "" && p.updateRunningCookie != nil {
			p.updateRunningCookie(ctx, cookieID, notifyVal)
		}
	}()

	// latest、loadErr 重新读取当前数据库中的凭证状态，若已被其他流程修改则放弃覆盖。
	latest, loadErr := p.store.Cookies.GetCookiePlatformRuntimeData(ctx, cookieID)
	if loadErr != nil {
		return nil
	}
	if latest.Value != before.Value || latest.MetadataJSON != before.MetadataJSON {
		return nil
	}
	if session != nil {
		// val、snap、changed 读取本次 Cookie 会话的变更结果。
		val, snap, changed := session.State()
		if changed {
			// metadata 更新快照元数据。
			metadata := cookierefresh.MetadataWithoutSnapshot(latest.MetadataJSON)
			if snap != nil {
				metadata = cookierefresh.MetadataWithSnapshot(latest.MetadataJSON, snap)
			}
			// err 写回刷新后的 Cookie 与快照元数据。
			if err := p.store.Cookies.UpdateRenewalCookie(ctx, latest.ID, val, metadata, time.Now().Unix()); err != nil {
				return fmt.Errorf("保存刷新后的采集账号 Cookie 失败: %w", err)
			}
			if val != latest.Value {
				notifyVal = val
			}
			return nil
		}
		if snap != nil {
			return nil
		}
	}
	if updatedCookie != "" && updatedCookie != originalCookie {
		// err 写回更新后的扁平 Cookie 值。
		if err := p.store.Cookies.UpdateValueOwned(ctx, cookieID, updatedCookie, latest.UserID); err != nil {
			return fmt.Errorf("写回采集账号 Cookie 失败: %w", err)
		}
		notifyVal = updatedCookie
	}
	return nil
}

// maybeRecoverSession 当平台明确报告会话过期时触发既有恢复回调。
func (p *CollectorPlatformPort) maybeRecoverSession(ctx context.Context, cookieID string, callErr error) {
	if p != nil && p.recoverExpiredSession != nil && mtop.IsSessionExpiredErr(callErr) {
		p.recoverExpiredSession(ctx, cookieID, callErr)
	}
}

// formatCollectorPlatformError 为风控与会话过期错误补充清晰的用户操作建议，同时保留底层错误链以便 errors.Is 判定。
func formatCollectorPlatformError(err error) error {
	if mtop.IsRiskVerificationErr(err) {
		return fmt.Errorf("闲鱼触发滑块安全验证（RGV587），已自动熔断保护账号。请直接点击右侧「① 一键弹出闲鱼窗口过滑块（免 F12）」，滑过后再点一键同步即可恢复: %w", err)
	}
	if mtop.IsSessionExpiredErr(err) {
		return fmt.Errorf("所选闲鱼账号登录状态已失效，请在账号管理重新扫码或更新 Cookie: %w", err)
	}
	return err
}

// toAppCollectedItems 批量将 MTOP 采集商品转换为应用层模型。
func toAppCollectedItems(items []mtop.MarketCollectedItem) []collectorapp.CollectedItem {
	// out 保存转换后的切片。
	out := make([]collectorapp.CollectedItem, 0, len(items))
	// item 是单条 MTOP 商品快照。
	for _, item := range items {
		out = append(out, toAppCollectedItem(item))
	}
	return out
}

// toAppCollectedItem 将单条 MTOP 采集商品映射为应用层模型。
func toAppCollectedItem(item mtop.MarketCollectedItem) collectorapp.CollectedItem {
	return collectorapp.CollectedItem{
		ItemID:          item.ItemID,
		Title:           item.Title,
		Description:     item.Description,
		Price:           item.Price,
		OriginalPrice:   item.OriginalPrice,
		PicURL:          item.PicURL,
		ImageURLs:       append([]string(nil), item.ImageURLs...),
		Area:            item.Area,
		SellerID:        item.SellerID,
		SellerNick:      item.SellerNick,
		WantCount:       item.WantCount,
		BrowseCount:     item.BrowseCount,
		CategoryID:      item.CategoryID,
		IsFreeShipping:  item.IsFreeShipping,
		IsMultiSpec:     item.IsMultiSpec,
		HasFullDetail:   item.HasFullDetail,
		PublishTimeUnix: item.PublishTimeUnix,
		WebURL:          item.WebURL,
	}
}

// 编译期验证适配器满足商品采集平台端口。
var _ collectorapp.PlatformPort = (*CollectorPlatformPort)(nil)
