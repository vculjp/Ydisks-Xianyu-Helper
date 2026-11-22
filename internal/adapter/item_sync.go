package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	itemapp "xianyu-go/internal/application/items"
	"xianyu-go/internal/db"
	"xianyu-go/internal/xianyu/cookierefresh"
	"xianyu-go/internal/xianyu/mtop"
)

// ItemSyncRepository 将商品同步应用 Port 适配到数据库、MTOP 和账号运行时。
type ItemSyncRepository struct {
	// store 提供账号凭证和商品持久化能力。
	store *db.Store
	// client 返回商品列表平台调用能力，允许运行时注入测试客户端。
	client func() mtop.Client
	// logger 记录不含凭证的同步阶段信息。
	logger *slog.Logger
	// updateRunningCookie 将平台返回的新 Cookie 同步到运行中的账号实例。
	updateRunningCookie func(context.Context, string, string)
	// recoverExpiredSession 仅在平台明确报告 Session 过期时触发账号恢复，Token 由 MTOP 客户端内部刷新。
	recoverExpiredSession func(context.Context, string, error)
}

// NewItemSyncRepository 构造商品同步基础设施适配器。
func NewItemSyncRepository(store *db.Store, client func() mtop.Client, logger *slog.Logger, updateRunningCookie func(context.Context, string, string), recoverExpiredSession func(context.Context, string, error)) *ItemSyncRepository {
	if client == nil {
		client = func() mtop.Client { return mtop.NewClient() }
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &ItemSyncRepository{store: store, client: client, logger: logger, updateRunningCookie: updateRunningCookie, recoverExpiredSession: recoverExpiredSession}
}

// OwnsAccount 按非敏感所有者字段判断用户是否拥有账号。
func (r *ItemSyncRepository) OwnsAccount(ctx context.Context, userID int64, cookieID string) (bool, error) {
	if r == nil || r.store == nil || r.store.Cookies == nil {
		return false, syncStageError(itemapp.SyncErrorPersistence, errors.New("商品同步存储未初始化"))
	}
	// ownerID、ownerErr 保存只读取账号归属的查询结果。
	ownerID, ownerErr := r.store.Cookies.GetOwnerID(ctx, cookieID)
	if errors.Is(ownerErr, db.ErrNotFound) {
		return false, nil
	}
	if ownerErr != nil {
		return false, syncStageError(itemapp.SyncErrorPersistence, ownerErr)
	}
	return ownerID == userID, nil
}

// SyncAll 读取平台商品全集、使用列表卡片的多规格标记并完成本地 reconcile。
func (r *ItemSyncRepository) SyncAll(ctx context.Context, query itemapp.SyncQuery) (itemapp.SyncAllResult, error) {
	if r.logger != nil {
		r.logger.Info("开始全量同步商品，多规格判断来源为列表 isSKU 字段", "account_id", query.CookieID, "page_size", query.PageSize, "max_pages", query.MaxPages)
	}
	// requestCtx、cancel 控制全量同步的最长执行时间。
	requestCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	// latest、cookieValue、requestContext、session、unlock 保存远端请求使用的凭证快照及锁。
	latest, cookieValue, requestContext, session, unlock, err := r.begin(requestCtx, query)
	if err != nil {
		return itemapp.SyncAllResult{}, err
	}
	// unlock 在创建完整 Cookie 会话后立即释放，避免慢速平台 I/O 占用账号锁。
	unlock()
	// result、callErr 保存平台全集结果和调用错误。
	result, callErr := r.mtopClient().FetchAllItems(requestContext, cookieValue, query.PageSize, query.MaxPages)
	// latest、session 和 callErr 通过重新加锁的提交阶段处理平台 Cookie 变化。
	latest, session, callErr, err = r.finishRemote(requestCtx, query, latest, session, callErr)
	if err != nil {
		return itemapp.SyncAllResult{}, err
	}
	if callErr != nil {
		r.recoverExpired(requestCtx, query.CookieID, callErr)
		return itemapp.SyncAllResult{}, syncStageError(itemapp.SyncErrorPlatform, callErr)
	}
	if result == nil {
		return itemapp.SyncAllResult{}, syncStageError(itemapp.SyncErrorPlatform, errors.New("商品列表接口未返回结果"))
	}
	// persistErr 保存列表请求完成后的 Cookie 会话提交错误；列表卡片已包含同步所需的多规格布尔标记。
	persistErr := r.persistAfterListResponse(requestCtx, query, latest, session, cookieValue, result.UpdatedCookies)
	if persistErr != nil {
		return itemapp.SyncAllResult{}, persistErr
	}
	// syncResult、syncErr 保存本地全集 reconcile 结果及错误。
	syncResult, syncErr := r.syncItems(requestCtx, query.CookieID, result.Items)
	if syncErr != nil {
		return itemapp.SyncAllResult{}, syncStageError(itemapp.SyncErrorPersistence, syncErr)
	}
	if r.logger != nil {
		r.logger.Info("全量商品同步完成", "account_id", query.CookieID, "total_count", len(result.Items), "saved_count", syncResult.Saved, "deleted_count", syncResult.Deleted, "multi_spec_source", "列表 isSKU 字段")
	}
	return itemapp.SyncAllResult{TotalCount: len(result.Items), TotalPages: result.TotalPages, SavedCount: syncResult.Saved, DeletedCount: syncResult.Deleted}, nil
}

// SyncPage 读取平台指定页、使用列表卡片的多规格标记并保存本页商品。
func (r *ItemSyncRepository) SyncPage(ctx context.Context, query itemapp.SyncQuery) (itemapp.SyncPageResult, error) {
	if r.logger != nil {
		r.logger.Info("开始同步商品列表页，多规格判断来源为列表 isSKU 字段", "account_id", query.CookieID, "page_number", query.PageNumber, "page_size", query.PageSize)
	}
	// requestCtx、cancel 控制分页同步的最长执行时间。
	requestCtx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	// latest、cookieValue、requestContext、session、unlock 保存远端请求使用的凭证快照及锁。
	latest, cookieValue, requestContext, session, unlock, err := r.begin(requestCtx, query)
	if err != nil {
		return itemapp.SyncPageResult{}, err
	}
	unlock()
	// result、callErr 保存平台分页结果和调用错误。
	result, callErr := r.mtopClient().FetchItemsPage(requestContext, cookieValue, query.PageNumber, query.PageSize)
	// latest、session 和 callErr 通过提交阶段处理平台 Cookie 变化。
	latest, session, callErr, err = r.finishRemote(requestCtx, query, latest, session, callErr)
	if err != nil {
		return itemapp.SyncPageResult{}, err
	}
	if callErr != nil {
		r.recoverExpired(requestCtx, query.CookieID, callErr)
		return itemapp.SyncPageResult{}, syncStageError(itemapp.SyncErrorPlatform, callErr)
	}
	if result == nil {
		return itemapp.SyncPageResult{}, syncStageError(itemapp.SyncErrorPlatform, errors.New("商品列表接口未返回结果"))
	}
	// persistErr 保存列表请求完成后的 Cookie 会话提交错误；列表卡片已包含同步所需的多规格布尔标记。
	persistErr := r.persistAfterListResponse(requestCtx, query, latest, session, cookieValue, result.UpdatedCookies)
	if persistErr != nil {
		return itemapp.SyncPageResult{}, persistErr
	}
	// saved 保存本页成功写入商品的数量。
	saved, saveErr := r.saveItems(requestCtx, query.CookieID, result.Items)
	if saveErr != nil {
		return itemapp.SyncPageResult{}, syncStageError(itemapp.SyncErrorPersistence, saveErr)
	}
	if r.logger != nil {
		r.logger.Info("商品列表页同步完成", "account_id", query.CookieID, "page_number", result.PageNumber, "current_count", len(result.Items), "saved_count", saved, "multi_spec_source", "列表 isSKU 字段")
	}
	return itemapp.SyncPageResult{PageNumber: result.PageNumber, PageSize: result.PageSize, CurrentCount: len(result.Items), SavedCount: saved}, nil
}

// begin 读取并校验账号平台视图，同时创建本次请求的 Cookie 会话。
func (r *ItemSyncRepository) begin(ctx context.Context, query itemapp.SyncQuery) (*db.CookiePlatformRuntimeData, string, context.Context, *mtop.CookieSession, func(), error) {
	if r == nil || r.store == nil || r.store.Cookies == nil || r.store.Items == nil {
		return nil, "", ctx, nil, func() {}, syncStageError(itemapp.SyncErrorPersistence, errors.New("商品同步存储未初始化"))
	}
	// unlock 保护账号凭证快照的读取和提交。
	unlock := r.store.LockAccountCredentials(query.CookieID)
	// latest、loadErr 保存平台凭证视图及读取错误。
	latest, loadErr := r.store.Cookies.GetCookiePlatformRuntimeData(ctx, query.CookieID)
	if errors.Is(loadErr, db.ErrNotFound) {
		unlock()
		return nil, "", ctx, nil, func() {}, itemapp.ErrSyncNotOwned
	}
	if loadErr != nil {
		unlock()
		return nil, "", ctx, nil, func() {}, syncStageError(itemapp.SyncErrorPersistence, loadErr)
	}
	if latest.UserID != query.UserID {
		unlock()
		return nil, "", ctx, nil, func() {}, itemapp.ErrSyncNotOwned
	}
	if !hasStoredCredential(latest) {
		unlock()
		return nil, "", ctx, nil, func() {}, syncStageError(itemapp.SyncErrorCredential, errors.New("账号凭证已变化，请重试"))
	}
	// requestContext、session 保存平台调用需要的 Cookie 会话上下文。
	requestContext, session := withCookieSnapshot(ctx, latest)
	return &latest, latest.Value, requestContext, session, unlock, nil
}

// finishRemote 在远端调用后重新读取账号并提交 Cookie 会话变化。
func (r *ItemSyncRepository) finishRemote(ctx context.Context, query itemapp.SyncQuery, detail *db.CookiePlatformRuntimeData, session *mtop.CookieSession, callErr error) (*db.CookiePlatformRuntimeData, *mtop.CookieSession, error, error) {
	// unlock 保护远端调用完成后的凭证复核和写回。
	unlock := r.store.LockAccountCredentials(query.CookieID)
	// notifyValue 保存提交成功后需要同步给运行时的最新 Cookie；通知必须在释放账号锁后执行。
	notifyValue := ""
	defer func() {
		unlock()
		if notifyValue != "" {
			r.notifyRunningCookie(ctx, query.CookieID, notifyValue)
		}
	}()
	// latest、loadErr 保存远端调用后的最新账号凭证视图。
	latest, loadErr := r.store.Cookies.GetCookiePlatformRuntimeData(ctx, query.CookieID)
	if loadErr != nil {
		return nil, session, callErr, syncStageError(itemapp.SyncErrorPersistence, loadErr)
	}
	if latest.UserID != query.UserID {
		return nil, session, callErr, syncStageError(itemapp.SyncErrorCredential, errors.New("账号凭证已变化，请重试"))
	}
	// changed 表示远端调用期间凭证是否被其他流程更新。
	changed := latest.Value != detail.Value || latest.MetadataJSON != detail.MetadataJSON
	if changed {
		return nil, session, callErr, syncStageError(itemapp.SyncErrorCredential, errors.New("账号凭证已变化，请重试"))
	}
	// value、valueChanged、handled、persistErr 保存 Cookie 会话提交结果。
	value, valueChanged, handled, persistErr := r.persistSession(ctx, latest, session)
	if persistErr != nil {
		return nil, session, callErr, syncStageError(itemapp.SyncErrorPersistence, persistErr)
	}
	if handled && valueChanged {
		// 同步第一阶段已经写入新 Cookie，记录待释放账号锁后发送的运行时通知。
		notifyValue = value
	}
	if handled {
		// refreshed、refreshErr 读取提交后的凭证视图，避免列表请求阶段已写入的 Cookie
		// 被误判为并发更新而跳过后续会话保存。
		refreshed, refreshErr := r.store.Cookies.GetCookiePlatformRuntimeData(ctx, query.CookieID)
		if refreshErr != nil {
			return nil, session, callErr, syncStageError(itemapp.SyncErrorPersistence, refreshErr)
		}
		latest = refreshed
	}
	return &latest, session, callErr, nil
}

// persistAfterListResponse 在商品列表请求完成后复核账号并写回请求期间的 Cookie 变化。
func (r *ItemSyncRepository) persistAfterListResponse(ctx context.Context, query itemapp.SyncQuery, detail *db.CookiePlatformRuntimeData, session *mtop.CookieSession, originalCookie, updatedCookie string) error {
	// unlock 保护列表请求完成后的凭证复核和写回。
	unlock := r.store.LockAccountCredentials(query.CookieID)
	// notifyValue 保存提交成功后需要同步给运行时的最新 Cookie；通知必须在释放账号锁后执行。
	notifyValue := ""
	defer func() {
		unlock()
		if notifyValue != "" {
			r.notifyRunningCookie(ctx, query.CookieID, notifyValue)
		}
	}()
	// latest、loadErr 保存列表请求完成后的最新账号凭证视图。
	latest, loadErr := r.store.Cookies.GetCookiePlatformRuntimeData(ctx, query.CookieID)
	if loadErr != nil {
		return syncStageError(itemapp.SyncErrorPersistence, loadErr)
	}
	if latest.UserID != query.UserID {
		return syncStageError(itemapp.SyncErrorCredential, errors.New("账号凭证已变化，请重试"))
	}
	// changed 表示平台请求期间是否已有其他流程写入凭证。
	changed := latest.Value != detail.Value || latest.MetadataJSON != detail.MetadataJSON
	if !changed {
		// value、valueChanged、handled、persistErr 保存 Cookie 会话提交结果。
		value, valueChanged, handled, persistErr := r.persistSession(ctx, latest, session)
		if persistErr != nil {
			return syncStageError(itemapp.SyncErrorPersistence, persistErr)
		}
		if handled && valueChanged {
			notifyValue = value
		} else if !handled && updatedCookie != "" && updatedCookie != originalCookie {
			// saveErr 保存平台返回的新 Cookie 写回错误。
			if saveErr := r.store.Cookies.UpdateValueOwned(ctx, query.CookieID, updatedCookie, query.UserID); saveErr != nil {
				return syncStageError(itemapp.SyncErrorPersistence, saveErr)
			}
			notifyValue = updatedCookie
		}
	}
	return nil
}

// persistSession 保存完整 Cookie Jar 或平面 Cookie 的会话变化。
func (r *ItemSyncRepository) persistSession(ctx context.Context, detail db.CookiePlatformRuntimeData, session *mtop.CookieSession) (string, bool, bool, error) {
	if session == nil {
		return "", false, false, nil
	}
	// value、snapshot、changed 保存平台会话当前状态。
	value, snapshot, changed := session.State()
	if !changed {
		return detail.Value, false, snapshot != nil, nil
	}
	// metadata 保存移除旧快照后待写入的新 metadata。
	metadata := cookierefresh.MetadataWithoutSnapshot(detail.MetadataJSON)
	if snapshot != nil {
		metadata = cookierefresh.MetadataWithSnapshot(detail.MetadataJSON, snapshot)
	}
	// err 保存 Cookie 会话持久化错误。
	err := r.store.Cookies.UpdateRenewalCookie(ctx, detail.ID, value, metadata, time.Now().Unix())
	return value, value != detail.Value, true, err
}

// saveItems 在数据库事务内保存分页同步返回的商品基础信息并返回成功数。
func (r *ItemSyncRepository) saveItems(ctx context.Context, cookieID string, items []mtop.ItemListItem) (int, error) {
	// rows 保存从平台商品模型转换出的分页持久化记录。
	rows := make([]db.ItemInfoRow, 0, len(items))
	// cachedMetrics 是我们本地已经读取过的统计与货架状态，分页同步同样不能把它们清空。
	cachedMetrics := r.loadCachedItemMetrics(ctx, cookieID)
	// item 表示当前待转换的平台商品。
	for _, item := range items {
		// price 保存优先使用格式化价格的商品价格文本。
		price := item.PriceText
		if price == "" {
			price = item.Price
		}
		rows = append(rows, db.ItemInfoRow{CookieID: cookieID, ItemID: item.ID, ItemTitle: item.Title, ItemCategory: item.CategoryID, ItemPrice: price, ItemDetail: ensureOnShelfState(preserveCachedItemMetrics(item.ItemDetail, cachedMetrics[item.ID])), IsMultiSpec: item.IsMultiSpec})
	}
	return r.store.Items.SavePageFromRemote(ctx, cookieID, rows)
}

// syncItems 将平台商品模型转换为数据库行并执行全集 reconcile。
func (r *ItemSyncRepository) syncItems(ctx context.Context, cookieID string, items []mtop.ItemListItem) (db.ItemSyncResult, error) {
	// rows 保存待写入数据库的商品行。
	rows := make([]db.ItemInfoRow, 0, len(items))
	// cachedMetrics 保存本地已有商品最近一次读取的统计键，避免普通列表同步把它们清空。
	cachedMetrics := r.loadCachedItemMetrics(ctx, cookieID)
	// item 表示当前待转换的平台商品。
	for _, item := range items {
		// price 保存优先使用格式化价格的商品价格文本。
		price := item.PriceText
		if price == "" {
			price = item.Price
		}
		// detailJSON 默认采用本次列表快照；仅在统计键缺失时补回最近一次读取值，并标记来自“在售”分组。
		detailJSON := ensureOnShelfState(preserveCachedItemMetrics(item.ItemDetail, cachedMetrics[item.ID]))
		rows = append(rows, db.ItemInfoRow{CookieID: cookieID, ItemID: item.ID, ItemTitle: item.Title, ItemCategory: item.CategoryID, ItemPrice: price, ItemDetail: detailJSON, IsMultiSpec: item.IsMultiSpec})
	}
	return r.store.Items.SyncFromRemote(ctx, cookieID, rows)
}

// loadCachedItemMetrics 一次读取账号现有商品中的统计键和平台确认的货架状态；读取失败返回空表，不阻断列表同步。
func (r *ItemSyncRepository) loadCachedItemMetrics(ctx context.Context, cookieID string) map[string]map[string]json.RawMessage {
	// out 以商品 ID 为键保存可补回的统计字段。
	out := map[string]map[string]json.RawMessage{}
	// existing、existingErr 是本地商品行及读取错误；失败时仍允许正常同步。
	existing, existingErr := r.store.Items.AllForCookie(ctx, cookieID)
	if existingErr != nil {
		return out
	}
	for _, row := range existing {
		// fields 是本地商品扩展 JSON；损坏记录直接跳过，不推断统计。
		var fields map[string]json.RawMessage
		if json.Unmarshal([]byte(row.ItemDetail), &fields) != nil || fields == nil {
			continue
		}
		// kept 只保留统计键和货架状态，避免把旧商品文案合并回新快照。
		kept := map[string]json.RawMessage{}
		for _, key := range []string{"exposure_count", "browse_count", "want_count", "shelf_state"} {
			if value, exists := fields[key]; exists {
				kept[key] = value
			}
		}
		if len(kept) > 0 {
			out[row.ItemID] = kept
		}
	}
	return out
}

// preserveCachedItemMetrics 只把本次快照未提供的统计键和货架状态补回 detail，不覆盖平台新返回的统计或商品文案。
func preserveCachedItemMetrics(detailJSON string, cached map[string]json.RawMessage) string {
	if len(cached) == 0 {
		return detailJSON
	}
	// current 是本次列表快照的扩展字段；损坏或非对象时保持原值，不尝试修复。
	var current map[string]json.RawMessage
	if json.Unmarshal([]byte(detailJSON), &current) != nil || current == nil {
		return detailJSON
	}
	// changed 标记是否真的补入了旧统计，避免无意义地重新编码。
	changed := false
	for _, key := range []string{"exposure_count", "browse_count", "want_count", "shelf_state"} {
		if _, exists := current[key]; exists {
			continue
		}
		if value, exists := cached[key]; exists {
			current[key] = value
			changed = true
		}
	}
	if !changed {
		return detailJSON
	}
	// encoded 是保留本次其它字段的扩展 JSON；编码失败时退回原快照。
	encoded, encodeErr := json.Marshal(current)
	if encodeErr != nil {
		return detailJSON
	}
	return string(encoded)
}

// ensureOnShelfState 把列表快照缺失的货架状态默认标记为“在售”。商品列表接口固定请求“在售”分组，
// 因此本轮同步返回的商品在平台上处于出售中；只有本地已经缓存的下架回执（shelf_state="off"）会保留。
func ensureOnShelfState(detailJSON string) string {
	// current 是本次列表快照的扩展字段；损坏或非对象时保持原值，不尝试修复。
	var current map[string]json.RawMessage
	if json.Unmarshal([]byte(detailJSON), &current) != nil || current == nil {
		return detailJSON
	}
	if _, exists := current["shelf_state"]; exists {
		return detailJSON
	}
	current["shelf_state"] = json.RawMessage(`"on"`)
	// encoded 是补回在售标记后的扩展 JSON；编码失败时退回原快照，不阻断同步。
	encoded, encodeErr := json.Marshal(current)
	if encodeErr != nil {
		return detailJSON
	}
	return string(encoded)
}

// withCookieSnapshot 创建带完整 Cookie Jar 或平面 Cookie 的平台上下文。
func withCookieSnapshot(ctx context.Context, detail db.CookiePlatformRuntimeData) (context.Context, *mtop.CookieSession) {
	// snapshot、ok 保存 metadata 中的完整 Cookie Jar 快照及解析状态。
	snapshot, ok := cookierefresh.SnapshotFromMetadataOK(detail.MetadataJSON)
	if !ok {
		return mtop.WithFlatCookieSession(ctx, detail.Value)
	}
	return mtop.WithCookieSnapshot(ctx, snapshot)
}

// hasStoredCredential 判断账号平台视图是否包含可用 Cookie 凭证。
func hasStoredCredential(detail db.CookiePlatformRuntimeData) bool {
	if strings.TrimSpace(detail.Value) != "" {
		return true
	}
	// complete 表示 metadata 是否包含完整 Cookie Jar。
	_, complete := cookierefresh.SnapshotFromMetadataOK(detail.MetadataJSON)
	return complete
}

// syncStageError 将底层错误包装为不泄露基础设施类型的应用错误。
func syncStageError(kind itemapp.SyncErrorKind, err error) error {
	return &itemapp.SyncError{Kind: kind, Err: err}
}

// notifyRunningCookie 将平台返回的 Cookie 更新到运行中的账号实例。
func (r *ItemSyncRepository) notifyRunningCookie(ctx context.Context, cookieID, value string) {
	if r.updateRunningCookie != nil && value != "" {
		r.updateRunningCookie(ctx, cookieID, value)
	}
}

// recoverExpired 在平台会话过期时通知账号恢复协调器。
func (r *ItemSyncRepository) recoverExpired(ctx context.Context, cookieID string, err error) {
	if r.recoverExpiredSession != nil && err != nil {
		r.recoverExpiredSession(ctx, cookieID, err)
	}
}

// mtopClient 返回当前商品同步使用的平台客户端，并在测试构造缺失时提供默认实现。
func (r *ItemSyncRepository) mtopClient() mtop.Client {
	if r != nil && r.client != nil {
		// client 表示当前回调返回的平台客户端。
		if client := r.client(); client != nil {
			return client
		}
	}
	return mtop.NewClient()
}
