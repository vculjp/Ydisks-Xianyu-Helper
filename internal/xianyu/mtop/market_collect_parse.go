package mtop

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// htmlTagPattern 匹配搜索高亮标题中可能夹杂的简单 HTML 标签（如 <font>、<em>）。
var htmlTagPattern = regexp.MustCompile(`<[^>]+>`)

// wantCountNumberPattern 从“128人想要”“想要 56”等标签文本中提取首个正整数。
var wantCountNumberPattern = regexp.MustCompile(`(\d+)\s*人想要`)

// itemIDFromURLPattern 从 targetUrl（如 fleamarket://item?id=123 或 https://.../item?id=123）提取商品 ID。
var itemIDFromURLPattern = regexp.MustCompile(`[?&]id=(\d+)`)

// aliCDNThumbSuffixPattern 匹配阿里 CDN 缩略图后缀（如 .jpg_300x300q90.jpg_.webp），剥离后可直接获得高清原图。
var aliCDNThumbSuffixPattern = regexp.MustCompile(`(\.(?:jpg|jpeg|png))_\d+x\d+[^/?#]*$`)

// buildMarketSearchPayload 将搜索条件编码为闲鱼 PC 搜索接口接收的 JSON 载荷。
func buildMarketSearchPayload(req MarketSearchRequest) map[string]any {
	// filters 收集非空的平台筛选项片段（价格区间与发布时间）。
	var filters []string
	// minPrice、maxPrice 是清理空白后的价格上下限文本。
	minPrice, maxPrice := strings.TrimSpace(req.MinPrice), strings.TrimSpace(req.MaxPrice)
	if minPrice != "" || maxPrice != "" {
		if minPrice == "" {
			minPrice = "0"
		}
		filters = append(filters, "priceRange:"+minPrice+","+maxPrice)
	}
	if req.PublishDays > 0 {
		filters = append(filters, "publishDays:"+strconv.Itoa(req.PublishDays))
	}
	// propValue 保存平台搜索过滤字典；有筛选条件时写入 searchFilter 键值。
	propValue := map[string]any{}
	if len(filters) > 0 {
		propValue["searchFilter"] = strings.Join(filters, ";") + ";"
	}
	// sortField、sortValue 是平台排序字段与排序方向。
	sortField := strings.TrimSpace(req.SortField)
	// sortValue 保存排序方向（asc/desc）。
	sortValue := strings.TrimSpace(req.SortValue)
	return map[string]any{
		"pageNumber":        req.PageNumber,
		"keyword":           req.Keyword,
		"fromFilter":        len(filters) > 0 || sortField != "",
		"rowsPerPage":       req.RowsPerPage,
		"sortValue":         sortValue,
		"sortField":         sortField,
		"customDistance":    "",
		"gps":               "",
		"propValueStr":      propValue,
		"customGps":         "",
		"searchReqFromPage": "pcSearch",
		"extraFilterValue":  "{}",
		"userPositionJson":  "{}",
	}
}

// parseMarketSearchData 从全站搜索响应 data 中提取商品列表、是否有下一页及估算总量。
func parseMarketSearchData(data map[string]any, rowsPerPage int) ([]MarketCollectedItem, bool, int, error) {
	// rawList、ok 校验平台搜索列表的真实结构，避免协议异常被当成没有商品。
	rawList, ok := data["resultList"].([]any)
	if !ok {
		return nil, false, 0, fmt.Errorf("搜索结果缺少有效 resultList 数组")
	}
	// seen 防止同一页内偶发推荐混排产生重复商品 ID。
	seen := make(map[string]struct{}, len(rawList))
	// items 保存本页解析成功的有效商品摘要。
	items := make([]MarketCollectedItem, 0, len(rawList))
	// entry 是 resultList 中的单条原始元素。
	for _, entry := range rawList {
		// parsed、ok 保存单张搜索卡片解析出的商品快照及是否有效。
		parsed, ok := parseMarketSearchCard(entry)
		if !ok {
			continue
		}
		// exists 判断当前商品 ID 是否已在本页出现。
		if _, exists := seen[parsed.ItemID]; exists {
			continue
		}
		seen[parsed.ItemID] = struct{}{}
		items = append(items, parsed)
	}
	// hasMore 判断平台是否声明仍有后续分页。
	hasMore := extractMarketHasMore(data, len(rawList), rowsPerPage)
	// totalCount 提取平台可选返回的总条数，缺省退化为当前已得条数。
	totalCount := itemListReportedTotal(data)
	if totalCount < len(items) {
		totalCount = len(items)
	}
	if len(rawList) > 0 && len(items) == 0 {
		return nil, false, 0, fmt.Errorf("搜索返回非空列表但无法解析有效商品")
	}
	return items, hasMore, totalCount, nil
}

// parseMarketSearchCard 兼容闲鱼 PC 搜索卡片的多层嵌套与序列化字符串形态，提取单件商品字段。
func parseMarketSearchCard(rawEntry any) (MarketCollectedItem, bool) {
	// outer、ok 保存卡片顶层字典及其类型断言结果。
	outer, ok := rawEntry.(map[string]any)
	if !ok {
		return MarketCollectedItem{}, false
	}
	// dataNode 是卡片内部的 data 子节点；若不存在则回退到顶层字典自身。
	dataNode, _ := outer["data"].(map[string]any)
	if dataNode == nil {
		dataNode = outer
	}
	// itemNode 是 data.item 节点。
	itemNode, _ := dataNode["item"].(map[string]any)
	if itemNode == nil {
		itemNode = dataNode
	}
	// mainNode 是 data.item.main 核心载体节点。
	mainNode, _ := itemNode["main"].(map[string]any)
	if mainNode == nil {
		mainNode = itemNode
	}
	// exContent 保存商品扩展展示属性，兼容对象或 JSON 字符串两种网关返回形态。
	exContent := decodeMapOrJSON(mainNode["exContent"])
	// detailParams 保存嵌套在 exContent.detailParams 中的回退属性。
	detailParams := decodeMapOrJSON(exContent["detailParams"])
	// clickParam、clickArgs 保存点击埋点参数字典，常包含准确的数值价格、卖家 ID 和想要数。
	clickParam := decodeMapOrJSON(mainNode["clickParam"])
	// clickArgs 保存 clickParam.args 子对象。
	clickArgs := decodeMapOrJSON(clickParam["args"])

	// itemID 按优先级从 exContent、detailParams、mainNode 和跳转链接提取商品数字标识。
	itemID := firstNonEmptyString(
		mtopString(exContent["itemId"]),
		mtopString(detailParams["itemId"]),
		mtopString(mainNode["itemId"]),
		mtopString(clickArgs["item_id"]),
		mtopString(clickArgs["id"]),
		extractItemIDFromLink(mtopString(mainNode["targetUrl"])),
	)
	if itemID == "" || strings.HasPrefix(itemID, "auto_") {
		return MarketCollectedItem{}, false
	}

	// rawTitle 提取标题文本并清理搜索高亮 HTML 标签。
	rawTitle := firstNonEmptyString(
		mtopString(exContent["title"]),
		mtopString(detailParams["title"]),
		mtopString(mainNode["title"]),
	)
	// title 是去除标签和首尾空白后的纯净商品标题。
	title := cleanSearchTitle(rawTitle)
	if title == "" {
		return MarketCollectedItem{}, false
	}

	// price 提取商品售价文本（如 "9.90"）。
	price := extractMarketCardPrice(exContent, detailParams, clickArgs)
	// originalPrice 提取可选划线原价。
	originalPrice := cleanPriceText(firstNonEmptyString(
		mtopString(exContent["oriPrice"]),
		mtopString(detailParams["oriPrice"]),
	))
	// picURL 提取并归一化 HTTPS 封面图地址。
	picURL := normalizeHTTPSImageURL(firstNonEmptyString(
		mtopString(exContent["picUrl"]),
		mtopString(detailParams["picUrl"]),
		mtopString(exContent["imageUrl"]),
	))
	// images 保存当前已知的图片列表（搜索卡片通常提供 1 张主图）。
	var images []string
	if picURL != "" {
		images = []string{picURL}
	}
	// sellerID 提取卖家闲鱼数字用户 ID。
	sellerID := firstNonEmptyString(
		mtopString(clickArgs["seller_id"]),
		mtopString(exContent["userId"]),
		mtopString(detailParams["userId"]),
	)
	// sellerNick 提取卖家昵称。
	sellerNick := firstNonEmptyString(
		mtopString(exContent["userNickName"]),
		mtopString(detailParams["userNick"]),
		mtopString(exContent["nick"]),
	)
	// area 提取商品所在省市地区。
	area := strings.TrimSpace(firstNonEmptyString(
		mtopString(exContent["area"]),
		mtopString(detailParams["area"]),
	))
	// wantCount 提取“想要”人数指标。
	wantCount := extractWantCount(exContent, detailParams, clickArgs)
	// freeShipping 判断标签或字段是否声明包邮。
	freeShipping := extractFreeShippingFlag(exContent, detailParams)

	return MarketCollectedItem{
		ItemID:          itemID,
		Title:           title,
		Price:           price,
		OriginalPrice:   originalPrice,
		PicURL:          picURL,
		ImageURLs:       images,
		Area:            area,
		SellerID:        sellerID,
		SellerNick:      sellerNick,
		WantCount:       wantCount,
		CategoryID:      firstNonEmptyString(mtopString(clickArgs["cat_id"]), mtopString(exContent["catId"])),
		IsFreeShipping:  freeShipping,
		IsMultiSpec:     mtopBool(detailParams["isSKU"]),
		HasFullDetail:   false,
		PublishTimeUnix: extractPublishTimeUnix(exContent, detailParams, clickArgs),
		WebURL:          "https://www.goofish.com/item?id=" + itemID,
	}, true
}

// parseMarketItemDetailData 从 mtop.taobao.idle.pc.detail 响应中提取单品完整文案、全部高清主图与规格标记。
func parseMarketItemDetailData(data map[string]any, fallbackItemID string) (*MarketCollectedItem, error) {
	// itemDO 保存详情接口的核心商品对象；部分网关响应可能直接平铺在 data 顶层。
	itemDO := decodeMapOrJSON(data["itemDO"])
	if len(itemDO) == 0 {
		itemDO = data
	}
	// sellerDO 保存卖家公开资料节点。
	sellerDO := decodeMapOrJSON(data["sellerDO"])

	// itemID 提取商品标识，缺失时使用请求传入的 ID。
	itemID := firstNonEmptyString(mtopString(itemDO["itemId"]), mtopString(data["itemId"]), strings.TrimSpace(fallbackItemID))
	if strings.TrimSpace(fallbackItemID) != "" && itemID != strings.TrimSpace(fallbackItemID) {
		return nil, fmt.Errorf("商品详情标识与请求不一致，已拒绝使用该数据")
	}
	// description 提取完整商品描述正文。
	description := strings.TrimSpace(firstNonEmptyString(mtopString(itemDO["desc"]), mtopString(itemDO["description"])))
	// title 提取商品标题；闲鱼部分纯文案帖没有独立 title，自动截取描述首行前 30 字兜底。
	title := cleanSearchTitle(firstNonEmptyString(mtopString(itemDO["title"]), firstLineRunes(description, 30)))
	if title == "" {
		return nil, fmt.Errorf("商品详情缺少标题与描述，可能已下架或不存在")
	}
	// price 提取当前售价文本。
	price := cleanPriceText(firstNonEmptyString(
		mtopString(itemDO["soldPrice"]),
		mtopString(itemDO["price"]),
		mtopString(itemDO["reservePrice"]),
	))
	// originalPrice 提取可选原价文本。
	originalPrice := cleanPriceText(firstNonEmptyString(mtopString(itemDO["oriPrice"]), mtopString(itemDO["originalPrice"])))
	// images 提取 imageInfos 中的全部高清原图地址（最多保留前 9 张以符合闲鱼发布上限）。
	images := extractDetailImages(itemDO)
	// picURL 取第一张主图作为列表封面。
	picURL := ""
	if len(images) > 0 {
		picURL = images[0]
	}
	// skuList 检查详情是否包含多规格列表。
	skuList, _ := itemDO["skuList"].([]any)
	// transportFee 判断邮费是否为 0（包邮/无需邮寄）。
	transportFee := strings.TrimSpace(mtopString(itemDO["transportFee"]))

	return &MarketCollectedItem{
		ItemID:          itemID,
		Title:           title,
		Description:     description,
		Price:           price,
		OriginalPrice:   originalPrice,
		PicURL:          picURL,
		ImageURLs:       images,
		Area:            strings.TrimSpace(firstNonEmptyString(mtopString(sellerDO["city"]), mtopString(itemDO["city"]))),
		SellerID:        firstNonEmptyString(mtopString(sellerDO["sellerId"]), mtopString(itemDO["userId"])),
		SellerNick:      firstNonEmptyString(mtopString(sellerDO["nick"]), mtopString(sellerDO["uniqueName"])),
		WantCount:       extractWantCount(itemDO, nil, nil),
		BrowseCount:     mtopInt(itemDO["browseCnt"]),
		CategoryID:      firstNonEmptyString(mtopString(itemDO["categoryId"]), mtopString(itemDO["catId"])),
		IsFreeShipping:  transportFee == "0" || transportFee == "0.00",
		IsMultiSpec:     len(skuList) > 0,
		HasFullDetail:   description != "" && len(images) > 0,
		PublishTimeUnix: extractPublishTimeUnix(itemDO, nil, nil),
		WebURL:          "https://www.goofish.com/item?id=" + itemID,
	}, nil
}

// parseSellerShopData 解析同行店铺主页在售商品响应；严格遵守“成功省略 cardList 表示空列表”协议约束。
func parseSellerShopData(data map[string]any, sellerUserID string, pageNumber, pageSize int) ([]MarketCollectedItem, bool, int, error) {
	// cards、cardsOK 保存 cardList 数组及其类型断言。
	cards, cardsOK := data["cardList"].([]any)
	// cardListPresent 区分平台正常省略字段（账号无在售商品）与返回畸形非数组类型。
	_, cardListPresent := data["cardList"]
	if !cardListPresent {
		return []MarketCollectedItem{}, false, 0, nil
	}
	if !cardsOK {
		return nil, false, 0, fmt.Errorf("店铺商品 cardList 类型无效")
	}
	// parsedBase 复用既有商品卡片解析器提取基础字段。
	parsedBase := parseItemList(data)
	// wantByItemID、areaByItemID、nickByItemID、pubByItemID 从原始卡片补充提取想要人数、地区、昵称与发布时间。
	wantByItemID, areaByItemID, nickByItemID, pubByItemID := extractShopCardExtras(cards)
	// out 保存转换为统一采集模型的店铺商品切片。
	out := make([]MarketCollectedItem, 0, len(parsedBase))
	// base 是单条基础商品记录。
	for _, base := range parsedBase {
		// wantCount、hasWant 区分原始统计缺失和真实零想要。
		wantCount, hasWant := wantByItemID[base.ID]
		if !hasWant {
			wantCount = -1
		}
		// picURL 归一化主图协议头。
		picURL := normalizeHTTPSImageURL(base.PicURL)
		// images 保存单张封面图切片。
		var images []string
		if picURL != "" {
			images = []string{picURL}
		}
		out = append(out, MarketCollectedItem{
			ItemID:          base.ID,
			Title:           cleanSearchTitle(base.Title),
			Price:           cleanPriceText(base.Price),
			PicURL:          picURL,
			ImageURLs:       images,
			Area:            areaByItemID[base.ID],
			SellerID:        sellerUserID,
			SellerNick:      nickByItemID[base.ID],
			WantCount:       wantCount,
			CategoryID:      base.CategoryID,
			IsMultiSpec:     base.IsMultiSpec,
			HasFullDetail:   false,
			PublishTimeUnix: pubByItemID[base.ID],
			WebURL:          "https://www.goofish.com/item?id=" + base.ID,
		})
	}
	// totalCount、totalPages 计算分页元数据。
	totalCount, totalPages := itemListPagination(data, pageNumber, pageSize)
	// hasMore 优先遵循明确的分页终止标志，仅在缺少标志时依据总页数和当前卡片数估计。
	hasMore := (totalPages > 0 && pageNumber < totalPages) || (totalPages == 0 && len(cards) >= pageSize)
	// next、exists 表示平台明确报告的下一页状态及是否存在该字段。
	if next, exists := data["nextPage"]; exists {
		hasMore = mtopBool(next)
	}
	if totalCount < len(out) {
		totalCount = len(out)
	}
	return out, hasMore, totalCount, nil
}

// extractShopCardExtras 从店铺列表原始卡片中补充提取想要人数、地区、卖家昵称与发布时间戳。
func extractShopCardExtras(cards []any) (map[string]int, map[string]string, map[string]string, map[string]int64) {
	// wants、areas、nicks 分别按商品 ID 索引想要数、地区和卖家昵称。
	wants := make(map[string]int, len(cards))
	// areas 保存商品 ID 到地区文本的映射。
	areas := make(map[string]string, len(cards))
	// nicks 保存商品 ID 到卖家昵称的映射。
	nicks := make(map[string]string, len(cards))
	// pubTimes 保存商品 ID 到发布 Unix 秒时间戳的映射。
	pubTimes := make(map[string]int64, len(cards))
	// rawCard 是单张店铺商品原始卡片。
	for _, rawCard := range cards {
		// card、ok 保存外层卡片对象。
		card, ok := rawCard.(map[string]any)
		if !ok {
			continue
		}
		// cardData 保存内部业务字段字典。
		cardData := decodeMapOrJSON(card["cardData"])
		// detailParams 保存详情参数字典。
		detailParams := decodeMapOrJSON(cardData["detailParams"])
		// trackParams 保存埋点参数字典。
		trackParams := decodeMapOrJSON(cardData["trackParams"])
		// itemID 提取当前卡片的商品 ID。
		itemID := firstNonEmptyString(mtopString(detailParams["itemId"]), mtopString(cardData["id"]))
		if itemID == "" {
			continue
		}
		wants[itemID] = extractWantCount(cardData, detailParams, trackParams)
		areas[itemID] = strings.TrimSpace(firstNonEmptyString(mtopString(cardData["area"]), mtopString(detailParams["area"])))
		nicks[itemID] = strings.TrimSpace(firstNonEmptyString(mtopString(detailParams["userNick"]), mtopString(cardData["userNick"])))
		pubTimes[itemID] = extractPublishTimeUnix(cardData, detailParams, trackParams)
	}
	return wants, areas, nicks, pubTimes
}

// extractPublishTimeUnix 从搜索或店铺卡片埋点与扩展属性中提取商品发布 Unix 秒时间戳。
func extractPublishTimeUnix(exContent, detailParams, args map[string]any) int64 {
	// candidates 汇集可能携带秒级或毫秒级发布时间戳的字段文本。
	candidates := []string{
		mtopString(args["publishTime"]),
		mtopString(args["gmtCreate"]),
		mtopString(exContent["publishTime"]),
		mtopString(exContent["gmtCreate"]),
		mtopString(detailParams["publishTime"]),
		mtopString(detailParams["gmtCreate"]),
	}
	// raw 逐个尝试解析正整数时间戳。
	for _, raw := range candidates {
		// trimmed 清理空白。
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		// parsed、err 解析十进制整数时间戳。
		parsed, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil || parsed <= 0 {
			continue
		}
		// 13 位毫秒级时间戳归一化为 10 位秒级时间戳。
		if parsed > 1_000_000_000_000 {
			parsed /= 1000
		}
		if parsed > 1_500_000_000 && parsed < 4_102_444_800 {
			return parsed
		}
	}
	return 0
}

// extractDetailImages 从详情 itemDO 中提取最多 9 张去重后的 HTTPS 商品图片地址。
func extractDetailImages(itemDO map[string]any) []string {
	// rawImages 保存 imageInfos 数组；部分响应可能命名为 images。
	rawImages, _ := itemDO["imageInfos"].([]any)
	if len(rawImages) == 0 {
		rawImages, _ = itemDO["images"].([]any)
	}
	// seen 对图片 URL 去重。
	seen := make(map[string]struct{}, len(rawImages))
	// urls 保存按展示顺序排列的主图 URL，最多 9 张。
	urls := make([]string, 0, len(rawImages))
	// entry 是 imageInfos 中的单张图片对象或字符串。
	for _, entry := range rawImages {
		// rawURL 保存提取出的原始图片地址。
		var rawURL string
		// typed 区分图片元素是字典还是直接字符串。
		switch typed := entry.(type) {
		case map[string]any:
			rawURL = firstNonEmptyString(mtopString(typed["url"]), mtopString(typed["picUrl"]))
		case string:
			rawURL = typed
		}
		// cleanURL 补齐 https 协议头。
		cleanURL := normalizeHTTPSImageURL(rawURL)
		if cleanURL == "" {
			continue
		}
		// exists 判断图片是否已收录。
		if _, exists := seen[cleanURL]; exists {
			continue
		}
		seen[cleanURL] = struct{}{}
		urls = append(urls, cleanURL)
		if len(urls) >= 9 {
			break
		}
	}
	return urls
}

// extractMarketCardPrice 从搜索卡片的多处候选价格结构提取纯数字金额文本。
func extractMarketCardPrice(exContent, detailParams, clickArgs map[string]any) string {
	// direct 优先读取埋点或详情参数中的完整金额文本。
	direct := cleanPriceText(firstNonEmptyString(
		mtopString(clickArgs["price"]),
		mtopString(detailParams["soldPrice"]),
		mtopString(exContent["soldPrice"]),
	))
	if direct != "" {
		return direct
	}
	// rawPrice 处理 exContent.price 为分段数组（如 [{"text":"¥"},{"text":"9"},{"text":".90"}]）的形态。
	if segments, ok := exContent["price"].([]any); ok {
		// builder 拼接价格分段中的数字与小数点。
		var builder strings.Builder
		// seg 是单个价格文本分段。
		for _, seg := range segments {
			// segMap、isMap 判断分段是否为含 text 字段的对象。
			if segMap, isMap := seg.(map[string]any); isMap {
				builder.WriteString(mtopString(segMap["text"]))
			}
		}
		// joined 清洗拼接后的价格字符串。
		if joined := cleanPriceText(builder.String()); joined != "" {
			return joined
		}
	}
	return cleanPriceText(mtopString(exContent["price"]))
}

// extractWantCount 从卡片字段、埋点参数及 fishTags 标签树中提取“想要”人数。
func extractWantCount(exContent, detailParams, args map[string]any) int {
	// candidates 保存明确的想要人数字段，真实零值不允许被其他统计指标覆盖。
	candidates := []any{args["wantNum"], args["wantCnt"], exContent["wantCnt"], exContent["wantNum"], detailParams["wantCnt"]}
	// candidate 是当前可能提供的想要数原始值。
	for _, candidate := range candidates {
		// n、err 保存非负整数人数及解析失败。
		n, err := strconv.Atoi(strings.TrimSpace(mtopString(candidate)))
		if err == nil && n >= 0 {
			return n
		}
	}
	// textHit 在 fishTags 或 itemLabelDataVO 的嵌套文本中扫描“N人想要”。
	if textHit := scanWantCountInAny(exContent["fishTags"]); textHit > 0 {
		return textHit
	}
	// textHit 是商品标签中的有效正整数人数。
	if textHit := scanWantCountInAny(exContent["itemLabelDataVO"]); textHit > 0 {
		return textHit
	}
	return -1
}

// scanWantCountInAny 递归扫描任意 JSON 结构中的“N人想要”文案并解析整数 N。
func scanWantCountInAny(node any) int {
	// typed 是当前 JSON 节点的运行时类型。
	switch typed := node.(type) {
	case string:
		// match 保存“N人想要”正则捕获组。
		match := wantCountNumberPattern.FindStringSubmatch(typed)
		if len(match) == 2 {
			// n、err 将捕获的数字字符串转为整数。
			if n, err := strconv.Atoi(match[1]); err == nil && n > 0 {
				return n
			}
		}
	case map[string]any:
		// child 是字典中的任意子节点。
		for _, child := range typed {
			// hit 保存子节点递归命中的想要人数。
			if hit := scanWantCountInAny(child); hit > 0 {
				return hit
			}
		}
	case []any:
		// child 是数组中的任意子元素。
		for _, child := range typed {
			// hit 保存数组元素递归命中的想要人数。
			if hit := scanWantCountInAny(child); hit > 0 {
				return hit
			}
		}
	}
	return 0
}

// extractFreeShippingFlag 判断搜索卡片是否包含“包邮”标记。
func extractFreeShippingFlag(exContent, detailParams map[string]any) bool {
	if mtopBool(exContent["freeShipping"]) || mtopBool(detailParams["freeShipping"]) {
		return true
	}
	// rawJSON、err 将标签树序列化为紧凑文本以便快速检测“包邮”字样。
	if rawJSON, err := json.Marshal(exContent["fishTags"]); err == nil && strings.Contains(string(rawJSON), "包邮") && !strings.Contains(string(rawJSON), "不包邮") && !strings.Contains(string(rawJSON), "非包邮") {
		return true
	}
	return false
}

// extractMarketHasMore 判断全站搜索响应是否声明仍有下一页。
func extractMarketHasMore(data map[string]any, rawCount, rowsPerPage int) bool {
	// exists 检查顶层 nextPage 字段是否存在。
	if _, exists := data["nextPage"]; exists {
		return mtopBool(data["nextPage"])
	}
	// exists 检查顶层 hasNextPage 字段是否存在。
	if _, exists := data["hasNextPage"]; exists {
		return mtopBool(data["hasNextPage"])
	}
	// pageInfo 检查可能存在的嵌套分页结构。
	if pageInfo := decodeMapOrJSON(data["pageInfo"]); len(pageInfo) > 0 {
		// exists 检查嵌套 hasMore 字段是否存在。
		if _, exists := pageInfo["hasMore"]; exists {
			return mtopBool(pageInfo["hasMore"])
		}
	}
	return rowsPerPage > 0 && rawCount >= rowsPerPage
}

// decodeMapOrJSON 将 map[string]any 或序列化的 JSON 对象字符串统一解码为字典。
func decodeMapOrJSON(raw any) map[string]any {
	// typed 区分已经是字典还是 JSON 字符串。
	switch typed := raw.(type) {
	case map[string]any:
		return typed
	case string:
		// trimmed 是去除空白后的候选 JSON 文本。
		trimmed := strings.TrimSpace(typed)
		if strings.HasPrefix(trimmed, "{") {
			// parsed 保存反序列化后的字典。
			var parsed map[string]any
			if decodeMarketJSON([]byte(trimmed), &parsed) == nil {
				return parsed
			}
		}
	}
	return nil
}

// decodeMarketJSON 将平台响应或嵌套对象解码至 dst，保留数字精度，避免金额小数和长商品标识被浮点转换破坏。
func decodeMarketJSON(raw []byte, dst any) error {
	// decoder 在解析 JSON 时将所有数字保留为十进制文本。
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	return decoder.Decode(dst)
}

// cleanSearchTitle 移除搜索结果标题中的高亮 HTML 标签并压缩首尾空白。
func cleanSearchTitle(raw string) string {
	// stripped 是去掉 HTML 标签后的纯文本。
	stripped := htmlTagPattern.ReplaceAllString(raw, "")
	return strings.TrimSpace(stripped)
}

// cleanPriceText 去除价格字符串中的货币符号（¥、￥、元）与空白，保留合法数值文本。
func cleanPriceText(raw string) string {
	// cleaned 依次剥离常见货币前缀与空白。
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.TrimPrefix(cleaned, "¥")
	cleaned = strings.TrimPrefix(cleaned, "￥")
	cleaned = strings.TrimSuffix(cleaned, "元")
	return strings.TrimSpace(cleaned)
}

// normalizeHTTPSImageURL 将 //img.alicdn.com/... 或 http:// 图片地址统一规范为 https:// 并还原阿里 CDN 原图分辨率。
func normalizeHTTPSImageURL(raw string) string {
	// trimmed 是去空白后的原始图片链接。
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "//") {
		trimmed = "https:" + trimmed
	} else if strings.HasPrefix(trimmed, "http://") {
		trimmed = "https://" + strings.TrimPrefix(trimmed, "http://")
	}
	if strings.Contains(trimmed, "alicdn.com/") {
		trimmed = aliCDNThumbSuffixPattern.ReplaceAllString(trimmed, "$1")
	}
	return trimmed
}

// extractItemIDFromLink 从闲鱼跳转链接查询参数或正则中提取数字商品 ID。
func extractItemIDFromLink(rawLink string) string {
	// trimmed 是去空白后的跳转地址。
	trimmed := strings.TrimSpace(rawLink)
	if trimmed == "" {
		return ""
	}
	// parsed、err 尝试使用标准 URL 解析读取 id 查询参数。
	if parsed, err := url.Parse(trimmed); err == nil {
		// id 是查询字符串中的 id 参数值。
		if id := strings.TrimSpace(parsed.Query().Get("id")); id != "" {
			return id
		}
	}
	// match 回退使用正则提取 id=数字。
	if match := itemIDFromURLPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		return match[1]
	}
	return ""
}

// firstNonEmptyString 返回首个去除首尾空白后非空的字符串。
func firstNonEmptyString(candidates ...string) string {
	// candidate 是按优先级排列的候选文本。
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) != "" {
			return strings.TrimSpace(candidate)
		}
	}
	return ""
}

// firstLineRunes 取文本首个非空行的前 maxRunes 个字符，用作无标题帖子的安全标题兜底。
func firstLineRunes(text string, maxRunes int) string {
	// line 是按换行切分出的每一行文本。
	for _, line := range strings.Split(text, "\n") {
		// trimmed 是当前行去除首尾空白后的内容。
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		// runes 是按 Unicode 码点切分后的字符切片，防止截断中文半个字节。
		runes := []rune(trimmed)
		if maxRunes > 0 && len(runes) > maxRunes {
			return string(runes[:maxRunes])
		}
		return trimmed
	}
	return ""
}
