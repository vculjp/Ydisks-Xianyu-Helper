// Package mtop 实现闲鱼全站商品搜索、单品详情采集与同行店铺在售商品采集协议。
package mtop

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"xianyu-go/internal/xianyu/protocol"
)

// MarketSearchRequest 描述全站关键词搜索采集的过滤与分页条件。
type MarketSearchRequest struct {
	// Keyword 是用户在搜索框提交的关键词，去空白后不能为空。
	Keyword string
	// PageNumber 是从 1 开始的分页页号。
	PageNumber int
	// RowsPerPage 是单页返回条数预算，取值范围 1–30，默认 30。
	RowsPerPage int
	// SortField 是平台排序字段：空串表示综合，create 表示最新发布，price 表示按价格。
	SortField string
	// SortValue 是平台排序方向：asc、desc 或空串。
	SortValue string
	// MinPrice 是可选最低价格文本（元），与 MaxPrice 共同组成价格区间过滤。
	MinPrice string
	// MaxPrice 是可选最高价格文本（元），留空表示不限制上限。
	MaxPrice string
	// PublishDays 是发布天数过滤（如 1、3、7、14），0 表示不限发布时间。
	PublishDays int
}

// MarketCollectedItem 是全站搜索或同行店铺采集归一化后的商品摘要快照。
type MarketCollectedItem struct {
	// ItemID 是闲鱼商品唯一数字标识。
	ItemID string
	// Title 是去除高亮 HTML 标签后的商品标题。
	Title string
	// Description 是商品详情文案；列表接口未提供时为空，需通过详情接口补齐。
	Description string
	// Price 是当前展示售价文本（元，不含货币符号）。
	Price string
	// OriginalPrice 是商品划线原价文本（元，无原价时为空）。
	OriginalPrice string
	// PicURL 是主图 HTTPS 地址。
	PicURL string
	// ImageURLs 是已采集到的全部商品图片 HTTPS 地址列表，首项为主图。
	ImageURLs []string
	// Area 是商品展示地区文本。
	Area string
	// SellerID 是卖家闲鱼数字用户标识。
	SellerID string
	// SellerNick 是卖家展示昵称。
	SellerNick string
	// WantCount 是解析出的“想要”人数，缺失时为 0。
	WantCount int
	// BrowseCount 是商品浏览次数，仅详情接口提供时非 0。
	BrowseCount int
	// CategoryID 是平台类目数字标识文本。
	CategoryID string
	// IsFreeShipping 表示商品是否标记包邮。
	IsFreeShipping bool
	// IsMultiSpec 表示商品是否包含多规格 SKU。
	IsMultiSpec bool
	// HasFullDetail 表示当前记录是否已包含详情接口完整文案与多图。
	HasFullDetail bool
	// PublishTimeUnix 是从卡片埋点或详情字段提取出的商品发布 Unix 秒时间戳（平台未返回时为 0）。
	PublishTimeUnix int64
	// WebURL 是可直接打开的闲鱼网页商品地址。
	WebURL string
}

// MarketSearchResult 是全站搜索或店铺商品分页查询的单页结果。
type MarketSearchResult struct {
	// Items 是当前页识别出的有效商品列表。
	Items []MarketCollectedItem
	// PageNumber 是当前页码（从 1 开始）。
	PageNumber int
	// HasMore 表示是否仍可能存在下一页结果。
	HasMore bool
	// TotalCount 是平台返回的估算总数，未返回时等于当前条数。
	TotalCount int
	// UpdatedCookies 是合并平台 Set-Cookie 后的最新凭证字符串，仅供适配器落库。
	UpdatedCookies string
}

// SearchMarketItems 调用闲鱼 PC 搜索接口获取单页全站商品，全程经过账号级节流器与最多 4 次 Token 续期。
func (c *ClientImpl) SearchMarketItems(ctx context.Context, cookiesStr string, req MarketSearchRequest) (*MarketSearchResult, error) {
	// keyword 保存清理首尾空白后的搜索关键词。
	keyword := strings.TrimSpace(req.Keyword)
	if keyword == "" {
		return nil, fmt.Errorf("搜索关键词不能为空")
	}
	if req.PageNumber < 1 {
		req.PageNumber = 1
	}
	if req.RowsPerPage < 1 || req.RowsPerPage > 30 {
		req.RowsPerPage = 30
	}
	req.Keyword = keyword
	return runWithTokenRecovery(ctx, c, cookiesStr, "全站商品搜索接口", func(callCookies string) (*MarketSearchResult, []string, string, error) {
		return c.searchMarketItemsOnce(ctx, callCookies, req)
	})
}

// FetchMarketItemDetail 调用闲鱼 PC 详情接口获取单个商品的完整文案、全部主图与卖家信息。
func (c *ClientImpl) FetchMarketItemDetail(ctx context.Context, cookiesStr, itemID string) (*MarketCollectedItem, string, error) {
	// normalizedID 是清理空白后的商品标识。
	normalizedID := strings.TrimSpace(itemID)
	if normalizedID == "" {
		return nil, cookiesStr, fmt.Errorf("商品 ID 不能为空")
	}
	// wrapped 保存带最新 Cookie 的详情包装结构；err 保存调用或鉴权失败原因。
	wrapped, err := runWithTokenRecovery(ctx, c, cookiesStr, "商品详情采集接口", func(callCookies string) (*detailWithCookies, []string, string, error) {
		return c.fetchMarketItemDetailOnce(ctx, callCookies, normalizedID)
	})
	if err != nil {
		return nil, cookiesStr, err
	}
	return wrapped.Item, wrapped.UpdatedCookies, nil
}

// FetchSellerShopPage 调用闲鱼个人主页商品列表接口获取指定卖家单页在售商品；缺少 cardList 按空列表处理。
func (c *ClientImpl) FetchSellerShopPage(ctx context.Context, cookiesStr, sellerUserID string, pageNumber, pageSize int) (*MarketSearchResult, error) {
	// normalizedSeller 是清理空白后的目标卖家数字 ID。
	normalizedSeller := strings.TrimSpace(sellerUserID)
	if normalizedSeller == "" {
		return nil, fmt.Errorf("目标卖家 ID 不能为空")
	}
	if pageNumber < 1 {
		pageNumber = 1
	}
	if pageSize < 1 || pageSize > 30 {
		pageSize = 20
	}
	return runWithTokenRecovery(ctx, c, cookiesStr, "店铺商品采集接口", func(callCookies string) (*MarketSearchResult, []string, string, error) {
		return c.fetchSellerShopPageOnce(ctx, callCookies, normalizedSeller, pageNumber, pageSize)
	})
}

// detailWithCookies 在内部 Token 恢复泛型包装中同时携带单品详情和更新后的 Cookie。
type detailWithCookies struct {
	// Item 是解析完成的单品详情快照。
	Item *MarketCollectedItem
	// UpdatedCookies 是本次响应合并后的最新 Cookie。
	UpdatedCookies string
}

// runWithTokenRecovery 为只读采集 MTOP 接口提供与既有商品列表一致的最多 4 轮 _m_h5_tk 刷新重试。
// 遇到风控验证、登录过期或网络取消时立即中止，绝不继续重试。
func runWithTokenRecovery[T any](
	ctx context.Context,
	client *ClientImpl,
	cookiesStr string,
	apiLabel string,
	callOnce func(currentCookies string) (*T, []string, string, error),
) (*T, error) {
	// currentCookies 保存当前轮次用于签名和发送的 Cookie 字符串。
	currentCookies := cookiesStr
	// session 是请求上下文中挂载的可选共享 Cookie 会话。
	if session := cookieSessionFromContext(ctx); session != nil {
		currentCookies, _, _ = session.State()
	}
	// lastRet 保存最后一次平台返回的 ret 数组，用于重试耗尽后生成准确诊断。
	var lastRet []string
	// attempt 是从 0 到 3 的有限重试计数。
	for attempt := 0; attempt < 4; attempt++ {
		// res、ret、updatedCookies、callErr 保存单次 MTOP 调用的业务结果、返回码、新 Cookie 和错误。
		res, ret, updatedCookies, callErr := callOnce(currentCookies)
		lastRet = ret
		if callErr == nil && res != nil {
			return res, nil
		}
		// failure 是归一后的单次失败错误，用于判断是否仅属于可恢复的签名 Token 过期。
		failure := callErr
		if failure == nil {
			failure = client.mtopResponseFailure(apiLabel, http.StatusOK, ret, "")
		}
		if !IsMTopTokenExpiredErr(failure) {
			return nil, failure
		}
		if attempt == 3 {
			break
		}
		if updatedCookies != "" {
			// tokenChanged 判断响应头是否已经直接下发了新的 _m_h5_tk 令牌。
			tokenChanged := mtopTokenCookieChanged(currentCookies, updatedCookies)
			currentCookies = updatedCookies
			if tokenChanged {
				// sleepErr 表示重试等待期间调用方是否取消了请求。
				if sleepErr := sleepCtx(ctx, MTopRetryGap); sleepErr != nil {
					return nil, sleepErr
				}
				continue
			}
		}
		// sleepErr 表示主动刷新令牌前的节流等待是否被取消。
		if sleepErr := sleepCtx(ctx, MTopRetryGap); sleepErr != nil {
			return nil, sleepErr
		}
		// refreshed、refreshErr 保存调用官方令牌接口恢复出的新 Cookie 及错误。
		refreshed, refreshErr := client.RefreshTokenContext(ctx, currentCookies)
		if refreshErr != nil {
			return nil, fmt.Errorf("刷新 %s token 失败: %w", apiLabel, refreshErr)
		}
		currentCookies = refreshed.UpdatedCookies
	}
	return nil, fmt.Errorf("%s token 重试失败: %w", apiLabel, client.mtopResponseFailure(apiLabel, http.StatusOK, lastRet, "重试次数已耗尽"))
}

// searchMarketItemsOnce 发送单次闲鱼 PC 全站搜索 MTOP 请求并解析结果列表。
func (c *ClientImpl) searchMarketItemsOnce(ctx context.Context, cookiesStr string, req MarketSearchRequest) (*MarketSearchResult, []string, string, error) {
	// endpoint 是生产官方搜索地址或单测注入的本地服务地址。
	endpoint := strings.TrimSpace(c.MarketSearchURL)
	if endpoint == "" {
		endpoint = MarketSearchAPI
	}
	// payload 是闲鱼 PC 搜索网关要求的业务 JSON 参数。
	payload := buildMarketSearchPayload(req)
	// decoded、ret、updatedCookies、err 保存通用签名表单 POST 的解码结果。
	decoded, ret, updatedCookies, err := c.doSignedMTopPost(ctx, cookiesStr, endpoint, "mtop.taobao.idlemtopsearch.pc.search", "https://www.goofish.com/search", "全站商品搜索接口", payload)
	if err != nil || decoded == nil {
		return nil, ret, updatedCookies, err
	}
	// items、hasMore、totalCount、parseErr 分别是商品摘要、分页状态、总数以及协议结构异常。
	items, hasMore, totalCount, parseErr := parseMarketSearchData(decoded, req.RowsPerPage)
	if parseErr != nil {
		return nil, ret, updatedCookies, parseErr
	}
	return &MarketSearchResult{
		Items:          items,
		PageNumber:     req.PageNumber,
		HasMore:        hasMore,
		TotalCount:     totalCount,
		UpdatedCookies: updatedCookies,
	}, ret, updatedCookies, nil
}

// fetchMarketItemDetailOnce 发送单次闲鱼 PC 商品详情 MTOP 请求并解析完整图文与规格标记。
func (c *ClientImpl) fetchMarketItemDetailOnce(ctx context.Context, cookiesStr, itemID string) (*detailWithCookies, []string, string, error) {
	// endpoint 是生产官方详情地址或单测注入的本地服务地址。
	endpoint := strings.TrimSpace(c.ItemDetailURL)
	if endpoint == "" {
		endpoint = ItemDetailAPI
	}
	// payload 是详情接口所需的最小商品标识载荷。
	payload := map[string]any{"itemId": itemID}
	// referer 模拟从商品详情页发起的正常同站请求头。
	referer := "https://www.goofish.com/item?id=" + url.QueryEscape(itemID)
	// decoded、ret、updatedCookies、err 保存通用签名表单 POST 的解码结果。
	decoded, ret, updatedCookies, err := c.doSignedMTopPost(ctx, cookiesStr, endpoint, "mtop.taobao.idle.pc.detail", referer, "商品详情采集接口", payload)
	if err != nil || decoded == nil {
		return nil, ret, updatedCookies, err
	}
	// detail、parseErr 保存从 itemDO 和 sellerDO 归一出的完整商品快照及结构错误。
	detail, parseErr := parseMarketItemDetailData(decoded, itemID)
	if parseErr != nil {
		return nil, ret, updatedCookies, parseErr
	}
	return &detailWithCookies{Item: detail, UpdatedCookies: updatedCookies}, ret, updatedCookies, nil
}

// fetchSellerShopPageOnce 发送单次同行卖家主页商品列表请求；遵循仓库协议约定，缺少 cardList 按空页返回。
func (c *ClientImpl) fetchSellerShopPageOnce(ctx context.Context, cookiesStr, sellerUserID string, pageNumber, pageSize int) (*MarketSearchResult, []string, string, error) {
	// endpoint 是生产官方个人主页商品列表地址或单测注入地址。
	endpoint := strings.TrimSpace(c.SellerItemListURL)
	if endpoint == "" {
		endpoint = ItemListAPI
	}
	// payload 请求目标卖家在售商品，不绑定当前登录者私有分组 ID。
	payload := map[string]any{
		"needGroupInfo": true,
		"pageNumber":    pageNumber,
		"pageSize":      pageSize,
		"userId":        sellerUserID,
	}
	// referer 对应闲鱼网页版个人空间地址。
	referer := "https://www.goofish.com/personal?userId=" + url.QueryEscape(sellerUserID)
	// decoded、ret、updatedCookies、err 保存通用签名表单 POST 的解码结果。
	decoded, ret, updatedCookies, err := c.doSignedMTopPost(ctx, cookiesStr, endpoint, "mtop.idle.web.xyh.item.list", referer, "店铺商品采集接口", payload)
	if err != nil || decoded == nil {
		return nil, ret, updatedCookies, err
	}
	// items、hasMore、totalCount、parseErr 解析主页卡片并兼容成功省略 cardList 的空商品页。
	items, hasMore, totalCount, parseErr := parseSellerShopData(decoded, sellerUserID, pageNumber, pageSize)
	if parseErr != nil {
		return nil, ret, updatedCookies, parseErr
	}
	return &MarketSearchResult{
		Items:          items,
		PageNumber:     pageNumber,
		HasMore:        hasMore,
		TotalCount:     totalCount,
		UpdatedCookies: updatedCookies,
	}, ret, updatedCookies, nil
}

// doSignedMTopPost 组装标准 H5 MTOP MD5 签名并发起经节流器保护的表单 POST 请求。
// 当平台返回非 SUCCESS ret 时返回 (nil, ret, updatedCookies, nil)，由外层统一决定是否刷新 Token 或报错。
func (c *ClientImpl) doSignedMTopPost(
	ctx context.Context,
	cookiesStr string,
	endpoint string,
	apiName string,
	referer string,
	apiLabel string,
	payload map[string]any,
) (map[string]any, []string, string, error) {
	// signingCookies 与 requestCookies 分别是用于提取 _m_h5_tk 签名的凭证和请求头携带的完整 Cookie。
	signingCookies, requestCookies := mtopRequestCookies(ctx, cookiesStr, referer, endpoint)
	// rawPayload、marshalErr 保存紧凑 JSON 编码后的 data 字段内容。
	rawPayload, marshalErr := json.Marshal(payload)
	if marshalErr != nil {
		return nil, nil, cookiesStr, marshalErr
	}
	// dataVal 是参与签名与表单提交的 JSON 字符串。
	dataVal := string(rawPayload)
	// timestamp 是 13 位毫秒级时间戳文本。
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	// sign 是按 token&t&appKey&data 计算的 32 位小写十六进制 MD5 签名。
	sign := protocol.GenerateSign(timestamp, protocol.SignToken(signingCookies), dataVal)
	// query 构造 MTOP 网关标准查询参数。
	query := url.Values{}
	query.Set("jsv", "2.7.2")
	query.Set("appKey", protocol.SignAppKey)
	query.Set("t", timestamp)
	query.Set("sign", sign)
	query.Set("v", "1.0")
	query.Set("type", "originaljson")
	query.Set("accountSite", "xianyu")
	query.Set("dataType", "json")
	query.Set("timeout", "20000")
	query.Set("api", apiName)
	query.Set("sessionOption", "AutoLoginOnly")

	// req、reqErr 保存绑定上下文取消信号的 POST 请求及构造错误。
	req, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"?"+query.Encode(), strings.NewReader("data="+url.QueryEscape(dataVal)))
	if reqErr != nil {
		return nil, nil, cookiesStr, reqErr
	}
	setCommonHeaders(req, requestCookies)
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	// resp、doErr 通过带统一日志与账号级节流器的客户端发送请求。
	resp, doErr := c.httpClient().Do(req)
	if doErr != nil {
		return nil, nil, cookiesStr, fmt.Errorf("%s请求失败: %w", apiLabel, doErr)
	}
	defer resp.Body.Close()
	// updated 是合并响应 Set-Cookie 后的最新凭证。
	updated := absorbMTopResponseCookies(ctx, cookiesStr, resp)
	// raw、readErr 保存受最大字节数限制的响应体及读取错误。
	raw, readErr := readMTopBody(resp)
	if readErr != nil {
		return nil, nil, updated, c.mtopResponseFailureWithCause(apiLabel, resp.StatusCode, nil, "读取响应失败", readErr)
	}
	// envelope 解码 MTOP 顶层 ret 与 data 对象。
	var envelope struct {
		// Ret 是平台返回状态码与说明数组，例如 SUCCESS::调用成功。
		Ret []string `json:"ret"`
		// Data 是平台业务响应字典。
		Data map[string]any `json:"data"`
	}
	// unmarshalErr 表示响应不是合法的 MTOP JSON 对象（例如被网关拦截返回 HTML）。
	if unmarshalErr := decodeMarketJSON(raw, &envelope); unmarshalErr != nil {
		return nil, nil, updated, c.mtopResponseFailureWithCause(apiLabel, resp.StatusCode, nil, "JSON 解析失败", unmarshalErr)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, envelope.Ret, updated, c.mtopResponseFailure(apiLabel, resp.StatusCode, envelope.Ret, "HTTP 状态异常")
	}
	if !hasMTopSuccess(envelope.Ret) {
		return nil, envelope.Ret, updated, nil
	}
	if envelope.Data == nil {
		envelope.Data = map[string]any{}
	}
	return envelope.Data, envelope.Ret, updated, nil
}
