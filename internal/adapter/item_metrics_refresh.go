package adapter

import (
	"context"
	"errors"
	"time"

	itemapp "xianyu-go/internal/application/items"
	"xianyu-go/internal/xianyu/mtop"
)

// metricDetailMTop 复用已经实现的单商品详情 API，不声明或猜测任何曝光、账号批量指标接口。
type metricDetailMTop interface {
	// FetchMarketItemDetail 读取当前 itemID 的详情，ctx 控制取消，明文凭证只在适配器和客户端间短期使用。
	FetchMarketItemDetail(ctx context.Context, cookiesStr, itemID string) (*mtop.MarketCollectedItem, string, error)
}

// FetchMetrics 为当前用户显式读取一件商品的浏览和想要，不自动恢复会话、不扇出、不重放；ctx 取消和既有 MTOP 节流保持生效。
func (port *ItemPublishPort) FetchMetrics(ctx context.Context, userID int64, cookieID, itemID string) (itemapp.Metrics, error) {
	if port == nil || port.store == nil || port.store.Cookies == nil {
		return itemapp.Metrics{}, errors.New("商品指标读取依赖无效")
	}
	// client、supported 是实际注入的已有详情客户端，生产构造仍通过 mtop.NewClient。
	client, supported := port.mtopClient().(metricDetailMTop)
	if !supported {
		return itemapp.Metrics{}, errors.New("当前客户端不支持单件商品详情")
	}
	// unlock 只保护凭证读取，慢速平台请求之前必须释放。
	unlock := port.store.LockAccountCredentials(cookieID)
	// credential、readErr 是归属当前用户的临时明文凭证快照，不可序列化、日志输出或返回给前端。
	credential, readErr := port.store.Cookies.GetCookiePlatformRuntimeData(ctx, cookieID)
	if readErr != nil || credential.UserID != userID || !hasStoredCredential(credential) {
		unlock()
		return itemapp.Metrics{}, errors.New("商品所属账号凭证不可用或已变化")
	}
	// callCtx、cancel 为单件用户查询设置最长 90 秒期限，取消责任由本方法承担。
	callCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	// requestCtx、session 保存此次请求独享的 Cookie Jar，不能扩散到响应或日志。
	requestCtx, session := withCookieSnapshot(callCtx, credential)
	unlock()
	// detail、updatedCookie、fetchErr 是一次单件详情用例返回的结果；Token 处理仍使用客户端既有有界策略。
	detail, updatedCookie, fetchErr := client.FetchMarketItemDetail(requestCtx, credential.Value, itemID)
	// runtimeCookie、persistErr 提交响应会话前复核凭证版本，避免覆盖用户并发重新登录。
	runtimeCookie, persistErr := port.persistCategorySession(ctx, userID, cookieID, credential.Value, credential.MetadataJSON, session, updatedCookie)
	if runtimeCookie != "" && port.updateRunningCookie != nil {
		port.updateRunningCookie(ctx, cookieID, runtimeCookie)
	}
	if persistErr != nil {
		return itemapp.Metrics{}, errors.New("商品指标读取后的账号状态保存失败")
	}
	if fetchErr != nil {
		return itemapp.Metrics{}, fetchErr
	}
	if detail == nil || detail.ItemID != itemID {
		return itemapp.Metrics{}, errors.New("商品详情身份不一致")
	}
	// metrics 只保留已有详情 API 明确提供的统计；没有任何曝光字段证据，故不构造曝光值。
	metrics := itemapp.Metrics{}
	if detail.BrowseCountKnown && detail.BrowseCount >= 0 && int64(detail.BrowseCount) <= 9007199254740991 {
		// browse 是当前商品明确提供的精确浏览次数，真实 0 保持为指针值。
		browse := int64(detail.BrowseCount)
		metrics.BrowseCount = &browse
	}
	if detail.WantCount >= 0 && int64(detail.WantCount) <= 9007199254740991 {
		// want 是当前商品明确提供的想要人数；客户端以 -1 标识未知。
		want := int64(detail.WantCount)
		metrics.WantCount = &want
	}
	return metrics, nil
}
