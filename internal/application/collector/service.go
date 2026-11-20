package collector

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Dependencies 汇总构造商品采集应用服务所需的全部外部端口。
type Dependencies struct {
	// Platform 提供账号归属复核与闲鱼 MTOP 采集能力。
	Platform PlatformPort
	// Rewriter 提供可选的大模型标题与详情防重改写能力。
	Rewriter AIRewriterPort
	// KeywordGenerator 提供可选的大模型当季爆品热词生成能力。
	KeywordGenerator AIKeywordGeneratorPort
	// ImageDownloader 按系统出站安全策略下载远程商品图片。
	ImageDownloader RemoteImageDownloader
	// ImageUploader 将下载好的图片写入本地资源库图片库并去重。
	ImageUploader LibraryImageUploader
	// TemplateCreator 在本地资源库创建商品模板。
	TemplateCreator LibraryTemplateCreator
	// ManualVerifier 提供可选的一键弹出桌面验证窗口并自动提取 Cookie 能力。
	ManualVerifier ManualVerifyPort
	// RadarRepository 提供可选的黑马爆品监控池与热度快照持久化能力。
	RadarRepository RadarRepositoryPort
	// RadarStepDelay 允许测试覆盖相邻监控目标之间的防风控慢速休眠时长；生产留 nil 默认 8~14 秒随机抖动。
	RadarStepDelay func() time.Duration
}

// Service 编排全站关键词采集、单品精准采集、同行店铺采集、黑马爆品雷达、AI 改写与转存模板库用例。
type Service struct {
	// saveMu 防止同一进程的转存请求重叠，争用直接拒绝，不自动重试。
	saveMu sync.Mutex
	// platform 是闲鱼平台采集端口。
	platform PlatformPort
	// rewriter 是系统大模型改写端口。
	rewriter AIRewriterPort
	// keywordGenerator 是可选的当季爆品热词推荐端口。
	keywordGenerator AIKeywordGeneratorPort
	// imageDownloader 是公网图片下载端口。
	imageDownloader RemoteImageDownloader
	// imageUploader 是本地图片库上传端口。
	imageUploader LibraryImageUploader
	// templateCreator 是本地商品模板创建端口。
	templateCreator LibraryTemplateCreator
	// manualVerifier 是可选的可视化手动验证窗口端口。
	manualVerifier ManualVerifyPort
	// radarRepo 是爆品雷达数据库端口。
	radarRepo RadarRepositoryPort
	// radar 是慢速巡检与低频定时调度协调器。
	radar *radarCoordinator
}

// NewService 校验依赖并构造商品采集应用服务。
func NewService(deps Dependencies) (*Service, error) {
	if deps.Platform == nil || deps.ImageDownloader == nil || deps.ImageUploader == nil || deps.TemplateCreator == nil {
		return nil, errors.New("商品采集应用服务依赖不完整")
	}
	return &Service{
		platform:         deps.Platform,
		rewriter:         deps.Rewriter,
		keywordGenerator: deps.KeywordGenerator,
		imageDownloader:  deps.ImageDownloader,
		imageUploader:    deps.ImageUploader,
		templateCreator:  deps.TemplateCreator,
		manualVerifier:   deps.ManualVerifier,
		radarRepo:        deps.RadarRepository,
		radar:            newRadarCoordinator(deps.RadarStepDelay),
	}, nil
}

// SearchKeyword 使用用户指定的采集账号执行单页全站关键词搜索，并支持按想要人数二次排序与过滤。
func (s *Service) SearchKeyword(ctx context.Context, userID int64, query SearchQuery) (SearchResult, error) {
	if userID <= 0 {
		return SearchResult{}, invalid("用户会话无效")
	}
	// cookieID、keyword 是清理空白后的必填采集账号与搜索词。
	cookieID := strings.TrimSpace(query.CookieID)
	// keyword 保存搜索关键词。
	keyword := strings.TrimSpace(query.Keyword)
	if cookieID == "" {
		return SearchResult{}, invalid("请先选择用于执行采集的闲鱼账号")
	}
	if keyword == "" || utf8.RuneCountInString(keyword) > 80 {
		return SearchResult{}, invalid("请输入 1–80 个字符的搜索关键词")
	}
	// err 校验采集账号归属权限。
	if err := s.requireOwnedAccount(ctx, userID, cookieID); err != nil {
		return SearchResult{}, err
	}
	// pageNumber、rowsPerPage 规范分页参数边界。
	pageNumber := query.PageNumber
	if pageNumber < 1 {
		pageNumber = 1
	}
	// rowsPerPage 控制单页条数上限不超过 30。
	rowsPerPage := query.RowsPerPage
	if rowsPerPage < 1 || rowsPerPage > 30 {
		rowsPerPage = 30
	}
	// sortField、sortValue、wantSortDesc 将前端排序模式映射为平台排序参数或本页想要数降序。
	sortField, sortValue, wantSortDesc, sortErr := mapSearchSortMode(query.SortMode)
	if sortErr != nil {
		return SearchResult{}, sortErr
	}
	if query.PublishDays < 0 || query.PublishDays > 365 {
		return SearchResult{}, invalid("发布天数过滤范围无效")
	}
	// err 校验最低价与最高价区间合法性。
	if err := validateOptionalPriceRange(query.MinPrice, query.MaxPrice); err != nil {
		return SearchResult{}, err
	}

	// items、hasMore、totalCount、callErr 执行单次受节流保护的平台搜索请求。
	items, hasMore, totalCount, callErr := s.platform.SearchMarket(ctx, cookieID, PlatformSearchParams{
		Keyword:     keyword,
		PageNumber:  pageNumber,
		RowsPerPage: rowsPerPage,
		SortField:   sortField,
		SortValue:   sortValue,
		MinPrice:    strings.TrimSpace(query.MinPrice),
		MaxPrice:    strings.TrimSpace(query.MaxPrice),
		PublishDays: query.PublishDays,
	})
	if callErr != nil {
		return SearchResult{}, callErr
	}

	// filtered 按最低“想要”人数阈值过滤低热度商品。
	filtered := make([]CollectedItem, 0, len(items))
	// item 是当前搜索结果条目。
	for _, item := range items {
		if query.MinWantCount > 0 && item.WantCount < query.MinWantCount {
			continue
		}
		filtered = append(filtered, item)
	}
	if wantSortDesc {
		sort.SliceStable(filtered, func(i, j int) bool {
			return filtered[i].WantCount > filtered[j].WantCount
		})
	}
	return SearchResult{
		Items:      filtered,
		PageNumber: pageNumber,
		HasMore:    hasMore,
		TotalCount: totalCount,
	}, nil
}

// CollectItemDetails 按商品链接或 ID 列表顺序拉取完整商品详情；多于 1 件时启用后台节流，遇风控立即熔断。
func (s *Service) CollectItemDetails(ctx context.Context, userID int64, input DetailCollectInput) (DetailCollectResult, error) {
	if userID <= 0 {
		return DetailCollectResult{}, invalid("用户会话无效")
	}
	// cookieID 是用户选定的采集账号。
	cookieID := strings.TrimSpace(input.CookieID)
	if cookieID == "" {
		return DetailCollectResult{}, invalid("请先选择用于执行采集的闲鱼账号")
	}
	// itemIDs、parseErr 提取并校验最多 10 个去重商品 ID。
	itemIDs, parseErr := ExtractItemIDs(input.RawInputs)
	if parseErr != nil {
		return DetailCollectResult{}, parseErr
	}
	// err 校验精准详情采集账号归属权限。
	if err := s.requireOwnedAccount(ctx, userID, cookieID); err != nil {
		return DetailCollectResult{}, err
	}

	// useBackground 多于 1 个商品时强制启用 ≥5 秒后台节流保护账号。
	useBackground := len(itemIDs) > 1
	// out 汇总成功详情、单品错误与风控熔断状态。
	out := DetailCollectResult{
		Items:  make([]CollectedItem, 0, len(itemIDs)),
		Errors: make([]DetailItemError, 0),
	}
	// batchCtx、cancel 限制同步批次预算，确保可在 HTTP 写超时前返回已完成条目。
	batchCtx, cancel := context.WithTimeout(ctx, 100*time.Second)
	defer cancel()
	// itemID 是当前顺序抓取的目标商品 ID。
	for _, itemID := range itemIDs {
		if batchCtx.Err() != nil || out.AbortedByRisk {
			out.Errors = append(out.Errors, DetailItemError{ItemID: itemID, Message: "批次已停止，本商品尚未请求"})
			continue
		}
		// detail、err 请求单个商品完整详情。
		detail, err := s.platform.FetchItemDetail(batchCtx, cookieID, itemID, useBackground)
		if err != nil {
			out.Errors = append(out.Errors, DetailItemError{ItemID: itemID, Message: err.Error()})
			if s.platform.IsAbortError(err) {
				out.AbortedByRisk = true
			}
			continue
		}
		if detail.ItemID != itemID {
			out.Errors = append(out.Errors, DetailItemError{ItemID: itemID, Message: "返回的商品标识与请求不一致，已拒绝使用"})
			continue
		}
		out.Items = append(out.Items, detail)
	}
	return out, nil
}

// CollectSellerItems 按同行主页链接或卖家 ID 顺序抓取最多 5 页在售商品，遇风控立即停止后续页。
func (s *Service) CollectSellerItems(ctx context.Context, userID int64, input SellerCollectInput) (SearchResult, error) {
	if userID <= 0 {
		return SearchResult{}, invalid("用户会话无效")
	}
	// cookieID 是用户选定的采集账号。
	cookieID := strings.TrimSpace(input.CookieID)
	if cookieID == "" {
		return SearchResult{}, invalid("请先选择用于执行采集的闲鱼账号")
	}
	// sellerID、parseErr 从链接或文本中解析纯数字卖家 ID。
	sellerID, parseErr := ExtractSellerID(input.SellerInput)
	if parseErr != nil {
		return SearchResult{}, parseErr
	}
	// err 校验店铺采集账号归属权限。
	if err := s.requireOwnedAccount(ctx, userID, cookieID); err != nil {
		return SearchResult{}, err
	}

	// maxPages 控制单次最多拉取页数在 1–5 页之间。
	maxPages := input.MaxPages
	if maxPages < 1 {
		maxPages = 1
	}
	if maxPages > MaxSellerShopPages {
		maxPages = MaxSellerShopPages
	}
	// useBackground 多页连续拉取时启用 ≥5 秒后台慢速节流。
	useBackground := maxPages > 1
	// seen 跨页对商品 ID 去重。
	seen := make(map[string]struct{})
	// allItems 汇总已抓取到的全部同行在售商品。
	var allItems []CollectedItem
	// lastHasMore、reportedTotal、lastPage 保存最后一页的分页状态。
	var lastHasMore bool
	// reportedTotal 记录平台返回的总商品条数。
	var reportedTotal int
	// lastPage 记录最后成功完成的页码。
	lastPage := 1
	// batchCtx、cancel 为多页采集保留响应写入时间，时间到达后交付已完成的页。
	batchCtx, cancel := context.WithTimeout(ctx, 100*time.Second)
	defer cancel()

	// page 从第 1 页顺序翻页至 maxPages。
	for page := 1; page <= maxPages; page++ {
		if batchCtx.Err() != nil {
			if page == 1 {
				return SearchResult{}, batchCtx.Err()
			}
			return SearchResult{Items: allItems, PageNumber: lastPage, HasMore: true, TotalCount: maxInt(reportedTotal, len(allItems)), Warning: "采集批次时间预算已耗尽，已保留成功分页"}, nil
		}
		// pageItems、hasMore、total、err 请求当前页店铺在售列表。
		pageItems, hasMore, total, err := s.platform.FetchSellerPage(batchCtx, cookieID, sellerID, page, 20, useBackground)
		if err != nil {
			if page == 1 {
				return SearchResult{}, err
			}
			// 第 2 页起遇到风控或异常时保留前面已抓到的商品并明确告知已安全中止。
			return SearchResult{
				Items:         allItems,
				PageNumber:    lastPage,
				HasMore:       true,
				TotalCount:    maxInt(reportedTotal, len(allItems)),
				AbortedByRisk: s.platform.IsAbortError(err),
				Warning:       fmt.Sprintf("已在第 %d 页安全停止继续翻页：%s", page, err.Error()),
			}, nil
		}
		lastPage = page
		lastHasMore = hasMore
		if total > reportedTotal {
			reportedTotal = total
		}
		// beforeCount 记录本页前累计有效商品数，用于识别平台重复返回的分页。
		beforeCount := len(allItems)
		// item 遍历本页商品并去重追加。
		for _, item := range pageItems {
			// exists 判断商品 ID 是否已在前序分页出现。
			if _, exists := seen[item.ItemID]; exists {
				continue
			}
			seen[item.ItemID] = struct{}{}
			allItems = append(allItems, item)
		}
		if hasMore && len(allItems) == beforeCount {
			return SearchResult{
				Items: allItems, PageNumber: lastPage, HasMore: false,
				TotalCount: maxInt(reportedTotal, len(allItems)),
				Warning:    fmt.Sprintf("第 %d 页未出现新商品，已停止继续翻页", page),
			}, nil
		}
		if !hasMore || len(pageItems) == 0 {
			break
		}
	}
	return SearchResult{
		Items:      allItems,
		PageNumber: lastPage,
		HasMore:    lastHasMore,
		TotalCount: maxInt(reportedTotal, len(allItems)),
	}, nil
}

// RewriteItem 调用系统已配置的 OpenAI 兼容模型对采集到的商品标题与描述做防同质化改写。
func (s *Service) RewriteItem(ctx context.Context, userID int64, input RewriteInput) (RewriteResult, error) {
	if userID <= 0 {
		return RewriteResult{}, invalid("用户会话无效")
	}
	if s.rewriter == nil {
		return RewriteResult{}, ErrAIUnavailable
	}
	// title、description 是清理首尾空白后的原始标题与描述。
	title := strings.TrimSpace(input.Title)
	// description 保存原描述，为空时退化使用标题作为上下文。
	description := strings.TrimSpace(input.Description)
	if title == "" && description == "" {
		return RewriteResult{}, invalid("商品标题与描述不能同时为空")
	}
	if title == "" {
		title = truncateRunes(description, 30)
	}
	if description == "" {
		description = title
	}
	// rewritten、err 调用底层大模型改写器。
	rewritten, err := s.rewriter.Rewrite(ctx, userID, RewriteInput{
		Title:             title,
		Description:       description,
		CustomInstruction: strings.TrimSpace(input.CustomInstruction),
	})
	if err != nil {
		return RewriteResult{}, err
	}
	rewritten.Title = truncateRunes(strings.TrimSpace(rewritten.Title), 30)
	rewritten.Description = strings.TrimSpace(rewritten.Description)
	if rewritten.Title == "" {
		rewritten.Title = truncateRunes(title, 30)
	}
	if rewritten.Description == "" {
		rewritten.Description = description
	}
	return rewritten, nil
}

// requireOwnedAccount 确认当前用户拥有目标采集账号。
func (s *Service) requireOwnedAccount(ctx context.Context, userID int64, cookieID string) error {
	// owned、err 调用非敏感归属检查。
	owned, err := s.platform.OwnsAccount(ctx, userID, cookieID)
	if err != nil {
		return err
	}
	if !owned {
		return ErrAccountNotOwned
	}
	return nil
}

// mapSearchSortMode 将前端可读的排序枚举转换为闲鱼搜索字段与本页想要数重排标记。
func mapSearchSortMode(mode string) (sortField, sortValue string, wantDesc bool, err error) {
	switch strings.TrimSpace(mode) {
	case "", "default":
		return "", "", false, nil
	case "newest":
		return "create", "desc", false, nil
	case "price_asc":
		return "price", "asc", false, nil
	case "price_desc":
		return "price", "desc", false, nil
	case "want_desc":
		return "", "", true, nil
	default:
		return "", "", false, invalid("不支持的排序方式")
	}
}

// validateOptionalPriceRange 校验可选最低价与最高价文本格式及大小关系。
func validateOptionalPriceRange(minPrice, maxPrice string) error {
	// hasMin、hasMax 判断用户是否填写了价格上下限。
	hasMin := strings.TrimSpace(minPrice) != ""
	// hasMax 判断最高价是否非空。
	hasMax := strings.TrimSpace(maxPrice) != ""
	// minCents、maxCents 保存转换后的分值以比较大小。
	var minCents, maxCents int64
	// err 保存金额解析错误。
	var err error
	if hasMin {
		minCents, err = ParsePriceCents(minPrice, false)
		if err != nil {
			return invalid("最低价格格式无效")
		}
	}
	if hasMax {
		maxCents, err = ParsePriceCents(maxPrice, false)
		if err != nil {
			return invalid("最高价格格式无效")
		}
	}
	if hasMin && hasMax && minCents > maxCents {
		return invalid("最低价格不能大于最高价格")
	}
	return nil
}

// maxInt 返回两个整数中的较大值。
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
