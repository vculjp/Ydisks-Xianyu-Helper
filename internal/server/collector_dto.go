package server

import (
	collectorapp "xianyu-go/internal/application/collector"
)

// collectedItemDTO 是 HTTP 层输出的单件采集商品快照，严格对应 OpenAPI CollectedItem。
type collectedItemDTO struct {
	// ItemID 是闲鱼商品唯一标识。
	ItemID string `json:"item_id"`
	// Title 是商品标题。
	Title string `json:"title"`
	// Description 是商品描述正文。
	Description string `json:"description"`
	// Price 是售价文本（元）。
	Price string `json:"price"`
	// OriginalPrice 是原价文本（元）。
	OriginalPrice string `json:"original_price"`
	// PicURL 是封面主图地址。
	PicURL string `json:"pic_url"`
	// ImageURLs 是全部已知主图地址列表。
	ImageURLs []string `json:"image_urls"`
	// Area 是地区文本。
	Area string `json:"area"`
	// SellerID 是卖家数字 ID。
	SellerID string `json:"seller_id"`
	// SellerNick 是卖家昵称。
	SellerNick string `json:"seller_nick"`
	// WantCount 是想要人数。
	WantCount int `json:"want_count"`
	// BrowseCount 是浏览次数。
	BrowseCount int `json:"browse_count"`
	// CategoryID 是平台类目 ID。
	CategoryID string `json:"category_id"`
	// IsFreeShipping 表示是否包邮。
	IsFreeShipping bool `json:"is_free_shipping"`
	// IsMultiSpec 表示是否多规格。
	IsMultiSpec bool `json:"is_multi_spec"`
	// HasFullDetail 表示是否已拉取完整详情图文。
	HasFullDetail bool `json:"has_full_detail"`
	// PublishTimeUnix 是商品发布 Unix 秒时间戳（未知时为 0）。
	PublishTimeUnix int64 `json:"publish_time_unix"`
	// WebURL 是闲鱼商品链接。
	WebURL string `json:"web_url"`
}

// collectorSearchRequest 是全站关键词搜索请求体。
type collectorSearchRequest struct {
	// CookieID 是指定的采集账号标识。
	CookieID string `json:"cookie_id"`
	// Keyword 是搜索关键词。
	Keyword string `json:"keyword"`
	// PageNumber 是页码。
	PageNumber int `json:"page_number"`
	// RowsPerPage 是每页条数。
	RowsPerPage int `json:"rows_per_page"`
	// SortMode 是排序模式。
	SortMode string `json:"sort_mode"`
	// MinPrice 是最低价过滤文本。
	MinPrice string `json:"min_price"`
	// MaxPrice 是最高价过滤文本。
	MaxPrice string `json:"max_price"`
	// PublishDays 是发布天数过滤。
	PublishDays int `json:"publish_days"`
	// MinWantCount 是最低想要数筛选阈值。
	MinWantCount int `json:"min_want_count"`
}

// collectorSearchResponse 是全站搜索或店铺商品采集的统一列表响应体。
type collectorSearchResponse struct {
	// Items 是采集到的商品数组。
	Items []collectedItemDTO `json:"items"`
	// PageNumber 是当前页码。
	PageNumber int `json:"page_number"`
	// HasMore 表示是否仍有后续页。
	HasMore bool `json:"has_more"`
	// TotalCount 是估算或实际商品总数。
	TotalCount int `json:"total_count"`
	// AbortedByRisk 表示多页翻页时是否因平台风控安全中止。
	AbortedByRisk bool `json:"aborted_by_risk"`
	// Warning 是可选提示文本。
	Warning string `json:"warning"`
}

// collectorDetailRequest 是按商品链接或 ID 精准采集请求体。
type collectorDetailRequest struct {
	// CookieID 是指定的采集账号标识。
	CookieID string `json:"cookie_id"`
	// Inputs 是商品链接、分享文本或数字 ID 数组。
	Inputs []string `json:"inputs"`
}

// collectorDetailErrorDTO 描述单个商品详情采集失败明细。
type collectorDetailErrorDTO struct {
	// ItemID 是识别出的商品 ID。
	ItemID string `json:"item_id"`
	// Message 是失败原因。
	Message string `json:"message"`
}

// collectorDetailResponse 是单品/多品精准详情采集响应体。
type collectorDetailResponse struct {
	// Items 是成功采集的商品详情列表。
	Items []collectedItemDTO `json:"items"`
	// Errors 是失败条目列表。
	Errors []collectorDetailErrorDTO `json:"errors"`
	// AbortedByRisk 表示是否因风控提前熔断。
	AbortedByRisk bool `json:"aborted_by_risk"`
}

// collectorSellerRequest 是同行店铺商品采集请求体。
type collectorSellerRequest struct {
	// CookieID 是指定的采集账号标识。
	CookieID string `json:"cookie_id"`
	// SellerInput 是同行主页链接或卖家 ID。
	SellerInput string `json:"seller_input"`
	// MaxPages 是单次最大抓取页数（1–5）。
	MaxPages int `json:"max_pages"`
}

// collectorAIRewriteRequest 是单件商品 AI 标题与文案改写请求体。
type collectorAIRewriteRequest struct {
	// Title 是原标题。
	Title string `json:"title"`
	// Description 是原描述。
	Description string `json:"description"`
	// CustomInstruction 是可选附加改写要求。
	CustomInstruction string `json:"custom_instruction"`
}

// collectorAIRewriteResponse 是 AI 改写成功响应体。
type collectorAIRewriteResponse struct {
	// Title 是改写后的新标题。
	Title string `json:"title"`
	// Description 是改写后的新详情文案。
	Description string `json:"description"`
}

// collectorSaveTemplateItemDTO 是待转存到本地模板库的单件采集商品输入。
type collectorSaveTemplateItemDTO struct {
	// ItemID 是源商品标识。
	ItemID string `json:"item_id"`
	// Name 是可选模板备注名。
	Name string `json:"name"`
	// Title 是商品标题。
	Title string `json:"title"`
	// Description 是商品详情文案。
	Description string `json:"description"`
	// Price 是源商品价格文本。
	Price string `json:"price"`
	// OriginalPrice 是可选原价文本。
	OriginalPrice string `json:"original_price"`
	// ImageURLs 是商品主图链接数组。
	ImageURLs []string `json:"image_urls"`
	// HasFullDetail 表示是否已具备完整详情。
	HasFullDetail bool `json:"has_full_detail"`
}

// collectorSaveTemplatesRequest 是批量转存商品模板库请求体。
type collectorSaveTemplatesRequest struct {
	// CookieID 是补抓缺失详情时使用的采集账号标识。
	CookieID string `json:"cookie_id"`
	// FetchDetailIfMissing 表示缺少详情多图时是否自动补抓。
	FetchDetailIfMissing bool `json:"fetch_detail_if_missing"`
	// EnableAIRewrite 表示入库前是否执行 AI 改写。
	EnableAIRewrite bool `json:"enable_ai_rewrite"`
	// CustomInstruction 是批量 AI 改写附加指令。
	CustomInstruction string `json:"custom_instruction"`
	// PriceMode 是定价模式（keep/offset/fixed）。
	PriceMode string `json:"price_mode"`
	// PriceValue 是 offset 或 fixed 对应的金额文本。
	PriceValue string `json:"price_value"`
	// Quantity 是默认库存。
	Quantity int `json:"quantity"`
	// PostageMode 是邮费方式（none/free）。
	PostageMode string `json:"postage_mode"`
	// DeliveryTemplateID 是可选绑定的发货模板主键。
	DeliveryTemplateID int64 `json:"delivery_template_id"`
	// CustomVariables 是发货模板自定义变量键值（如 link）。
	CustomVariables map[string]string `json:"custom_variables"`
	// Items 是待转存的商品数组。
	Items []collectorSaveTemplateItemDTO `json:"items"`
}

// collectorSavedTemplateOutcomeDTO 描述单条商品转存模板的执行结果。
type collectorSavedTemplateOutcomeDTO struct {
	// ItemID 是源商品标识。
	ItemID string `json:"item_id"`
	// Title 是商品标题。
	Title string `json:"title"`
	// Success 表示是否创建成功。
	Success bool `json:"success"`
	// TemplateID 是新建本地模板主键。
	TemplateID int64 `json:"template_id"`
	// ImageCount 是关联的本地图片数量。
	ImageCount int `json:"image_count"`
	// Error 是失败说明文本。
	Error string `json:"error"`
}

// collectorSaveTemplatesResponse 是批量转存本地模板库响应体。
type collectorSaveTemplatesResponse struct {
	// Total 是请求总条数。
	Total int `json:"total"`
	// Succeeded 是成功条数。
	Succeeded int `json:"succeeded"`
	// Failed 是失败条数。
	Failed int `json:"failed"`
	// AbortedByRisk 表示是否因风控提前中止补抓详情。
	AbortedByRisk bool `json:"aborted_by_risk"`
	// Results 是逐条执行明细。
	Results []collectorSavedTemplateOutcomeDTO `json:"results"`
}

// collectorManualVerifyOpenRequest 是一键弹出桌面可见闲鱼验证窗口的请求体。
type collectorManualVerifyOpenRequest struct {
	// CookieID 是待恢复风控的目标闲鱼账号标识。
	CookieID string `json:"cookie_id"`
	// Scene 是当前采集模式（search/detail/seller），用于精准打开对应闲鱼页面。
	Scene string `json:"scene"`
	// Keyword 是可选搜索词。
	Keyword string `json:"keyword"`
	// TargetID 是可选商品链接或卖家标识。
	TargetID string `json:"target_id"`
}

// collectorManualVerifyOpenResponse 是成功弹出可见闲鱼窗口的响应体。
type collectorManualVerifyOpenResponse struct {
	// TargetURL 是已在桌面浏览器窗口打开的闲鱼官方页面地址。
	TargetURL string `json:"target_url"`
}

// collectorManualVerifyCookieRequest 是一键同步恢复或关闭验证窗口的请求体。
type collectorManualVerifyCookieRequest struct {
	// CookieID 是目标闲鱼账号标识。
	CookieID string `json:"cookie_id"`
}

// collectorManualVerifyCompleteResponse 是完成手动验证并同步完整 Cookie Jar 快照后的响应体。
type collectorManualVerifyCompleteResponse struct {
	// CookieID 是已恢复的闲鱼账号标识。
	CookieID string `json:"cookie_id"`
	// SyncedCount 是从浏览器窗口同步保存的完整 Cookie 条目数（含路径级 x5sec 票据）。
	SyncedCount int `json:"synced_count"`
}

// collectorManualVerifyCancelResponse 是主动关闭验证窗口的响应体。
type collectorManualVerifyCancelResponse struct {
	// Canceled 表示验证窗口已关闭。
	Canceled bool `json:"canceled"`
}

// newCollectedItemDTO 将应用层采集商品映射为非敏感传输 DTO，空数组保证序列化为 []。
func newCollectedItemDTO(item collectorapp.CollectedItem) collectedItemDTO {
	// imgs 确保空切片不会序列化为 null。
	imgs := item.ImageURLs
	if imgs == nil {
		imgs = []string{}
	}
	return collectedItemDTO{
		ItemID:         item.ItemID,
		Title:          item.Title,
		Description:    item.Description,
		Price:          item.Price,
		OriginalPrice:  item.OriginalPrice,
		PicURL:         item.PicURL,
		ImageURLs:      imgs,
		Area:           item.Area,
		SellerID:       item.SellerID,
		SellerNick:     item.SellerNick,
		WantCount:      item.WantCount,
		BrowseCount:    item.BrowseCount,
		CategoryID:     item.CategoryID,
		IsFreeShipping: item.IsFreeShipping,
		IsMultiSpec:     item.IsMultiSpec,
		HasFullDetail:   item.HasFullDetail,
		PublishTimeUnix: item.PublishTimeUnix,
		WebURL:          item.WebURL,
	}
}

// newCollectorSearchResponse 将应用层搜索或店铺分页结果映射为传输响应。
func newCollectorSearchResponse(res collectorapp.SearchResult) collectorSearchResponse {
	// list 保存非 nil 商品 DTO 数组。
	list := make([]collectedItemDTO, 0, len(res.Items))
	// item 遍历应用层结果。
	for _, item := range res.Items {
		list = append(list, newCollectedItemDTO(item))
	}
	return collectorSearchResponse{
		Items:         list,
		PageNumber:    res.PageNumber,
		HasMore:       res.HasMore,
		TotalCount:    res.TotalCount,
		AbortedByRisk: res.AbortedByRisk,
		Warning:       res.Warning,
	}
}
