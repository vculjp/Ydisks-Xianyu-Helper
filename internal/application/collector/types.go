// Package collector 提供全站闲鱼商品采集、AI 防重改写及一键转入本地商品模板库的应用层用例。
package collector

import (
	"context"
	"errors"

	libraryapp "xianyu-go/internal/application/library"
)

const (
	// MaxDetailBatchItems 限制单次通过链接/商品 ID 精准采集的最大商品数，防止扇出请求触发平台风控。
	MaxDetailBatchItems = 10
	// MaxSellerShopPages 限制单次采集对标同行店铺的最大翻页页数。
	MaxSellerShopPages = 5
	// MaxSaveTemplateBatch 限制单批转存到本地商品模板库的最大商品数，保障单次请求在写超时预算内收口。
	MaxSaveTemplateBatch = 20
	// MaxCollectedImagesPerItem 是单个商品采集并写入图片库的主图上限，与闲鱼发布上限一致。
	MaxCollectedImagesPerItem = 9
)

// ValidationError 表示用户可直接修正的参数校验错误，HTTP 层映射为 400。
type ValidationError struct {
	// Message 是脱敏且面向用户的中文错误提示。
	Message string
}

// Error 返回校验错误的中文描述。
func (e *ValidationError) Error() string {
	return e.Message
}

// ErrAccountNotOwned 表示目标采集账号不存在或不属于当前登录用户。
var ErrAccountNotOwned = errors.New("采集账号不存在或无权使用")

// ErrCollectorAccountStopped 表示本地停用或状态无法确认，必须终止本轮采集，不再访问平台。
var ErrCollectorAccountStopped = &ValidationError{Message: "采集账号已暂停、停用或状态无法确认，请先在账号管理中人工核对"}

// ErrCollectorBusy 拒绝重叠的采集操作，不创建等待后自动补发的请求。
var ErrCollectorBusy = &ValidationError{Message: "已有采集操作正在运行，请等待完成并核对状态后再手动操作"}

// ErrAIUnavailable 表示系统尚未配置可用的大模型 API 密钥或地址。
var ErrAIUnavailable = errors.New("尚未配置系统 AI 接口密钥，请先在「系统与AI」中完成配置")

// CollectedItem 是应用层统一的商品采集快照，不含任何账号 Cookie 或敏感令牌。
type CollectedItem struct {
	// ItemID 是闲鱼商品唯一标识。
	ItemID string
	// Title 是商品标题文本。
	Title string
	// Description 是商品详情正文；仅列表采集时可能为空。
	Description string
	// Price 是当前展示售价文本（元）。
	Price string
	// OriginalPrice 是划线原价文本（元）。
	OriginalPrice string
	// PicURL 是列表封面主图 HTTPS 地址。
	PicURL string
	// ImageURLs 是全部已知商品图片 HTTPS 地址列表。
	ImageURLs []string
	// Area 是商品所在地区文本。
	Area string
	// SellerID 是卖家闲鱼数字用户标识。
	SellerID string
	// SellerNick 是卖家昵称。
	SellerNick string
	// WantCount 是“想要”人数，-1 表示平台未提供可验证的指标。
	WantCount int
	// BrowseCount 是浏览量（详情采集返回）。
	BrowseCount int
	// CategoryID 是平台原始类目 ID。
	CategoryID string
	// IsFreeShipping 表示是否包邮。
	IsFreeShipping bool
	// IsMultiSpec 表示是否含多规格。
	IsMultiSpec bool
	// HasFullDetail 表示是否已拉取完整详情文案与多张主图。
	HasFullDetail bool
	// PublishTimeUnix 是商品发布 Unix 秒时间戳（平台未返回精确秒数时为 0）。
	PublishTimeUnix int64
	// WebURL 是闲鱼商品网页链接。
	WebURL string
}

// SearchQuery 描述全站关键词搜索用例的输入条件。
type SearchQuery struct {
	// CookieID 是用户显式指定的采集账号标识。
	CookieID string
	// Keyword 是搜索关键词。
	Keyword string
	// PageNumber 是从 1 开始的页号。
	PageNumber int
	// RowsPerPage 是每页条数（1–30）。
	RowsPerPage int
	// SortMode 是排序模式：default（综合）、newest（最新发布）、price_asc、price_desc、want_desc（本页想要数降序）。
	SortMode string
	// MinPrice 是最低价过滤文本（元）。
	MinPrice string
	// MaxPrice 是最高价过滤文本（元）。
	MaxPrice string
	// PublishDays 是近 N 天发布过滤（0 表示不限）。
	PublishDays int
	// MinWantCount 是应用层按最低“想要”人数做的二次筛选阈值（0 表示不过滤）。
	MinWantCount int
}

// SearchResult 是关键词搜索或店铺采集返回的分页结果。
type SearchResult struct {
	// Items 是过滤与排序后的商品列表。
	Items []CollectedItem
	// PageNumber 是当前页码。
	PageNumber int
	// HasMore 表示平台是否仍有后续页。
	HasMore bool
	// TotalCount 是估算或实际结果条数。
	TotalCount int
	// AbortedByRisk 表示多页采集时是否因平台风控或凭证失效提前安全中止。
	AbortedByRisk bool
	// Warning 是提前中止或降级时返回给前端的明确提示文案。
	Warning string
}

// DetailCollectInput 描述按多行链接或商品 ID 精准采集的输入。
type DetailCollectInput struct {
	// CookieID 是执行采集的闲鱼账号标识。
	CookieID string
	// RawInputs 是用户粘贴的商品链接、口令文本或商品 ID 列表。
	RawInputs []string
}

// DetailItemError 记录批量详情采集中单个商品失败的原因。
type DetailItemError struct {
	// ItemID 是识别出的目标商品 ID。
	ItemID string
	// Message 是失败原因摘要。
	Message string
}

// DetailCollectResult 是单品或小批量详情精准采集的汇总结果。
type DetailCollectResult struct {
	// Items 是成功采集到完整详情的商品列表。
	Items []CollectedItem
	// Errors 是采集失败的单品明细。
	Errors []DetailItemError
	// AbortedByRisk 表示批次是否因命中平台风控而立即熔断停止后续项。
	AbortedByRisk bool
}

// SellerCollectInput 描述对标同行店铺在售商品采集的输入。
type SellerCollectInput struct {
	// CookieID 是执行采集的闲鱼账号标识。
	CookieID string
	// SellerInput 是同行个人主页链接或纯数字卖家 userId。
	SellerInput string
	// MaxPages 是本次最多抓取的页数（1–5）。
	MaxPages int
}

// RewriteInput 描述单件商品的 AI 防重改写输入。
type RewriteInput struct {
	// Title 是原始商品标题。
	Title string
	// Description 是原始商品描述文案。
	Description string
	// CustomInstruction 是可选的自定义改写风格或补充要求。
	CustomInstruction string
}

// RewriteResult 是 AI 生成的差异化商品标题与详情文案。
type RewriteResult struct {
	// Title 是改写后不超过 30 字的闲鱼商品标题。
	Title string
	// Description 是改写后去除原卖家引流痕迹的商品描述。
	Description string
}

// SaveTemplateItem 描述待转存为本地商品模板的单件采集商品。
type SaveTemplateItem struct {
	// ItemID 是源商品 ID，缺完整详情时可用于按需补抓多图与正文。
	ItemID string
	// Name 是可选模板备注名，留空时自动取标题。
	Name string
	// Title 是待入库标题。
	Title string
	// Description 是待入库详情正文。
	Description string
	// Price 是源商品价格文本（元）。
	Price string
	// OriginalPrice 是可选原价文本（元）。
	OriginalPrice string
	// ImageURLs 是已知商品主图 URL 列表。
	ImageURLs []string
	// HasFullDetail 标记是否已具备完整详情；为 false 且开启补全时会自动补抓详情。
	HasFullDetail bool
}

// SaveTemplatesInput 描述将一批采集商品转存到本地资源库商品模板的请求。
type SaveTemplatesInput struct {
	// CookieID 是需要补抓详情时使用的采集账号标识；仅保存已有完整图文时可留空。
	CookieID string
	// FetchDetailIfMissing 表示条目未抓全详情时是否先调用详情接口补齐多图与描述。
	FetchDetailIfMissing bool
	// EnableAIRewrite 表示入库前是否自动调用 AI 对标题与文案做防重改写。
	EnableAIRewrite bool
	// CustomInstruction 是批量 AI 改写时的附加指令。
	CustomInstruction string
	// PriceMode 是售价换算策略：keep（保持原价）、offset（原价加减固定金额）、fixed（统一固定价）。
	PriceMode string
	// PriceValue 是 offset 或 fixed 模式下的金额文本（元，offset 允许负数但结果最低 0.01 元）。
	PriceValue string
	// Quantity 是生成的模板默认库存（默认 5）。
	Quantity int
	// PostageMode 是邮费模式：none（无需邮寄，虚拟默认）、free（包邮）。
	PostageMode string
	// DeliveryTemplateID 是可选自动绑定的付款发货模板主键（0 表示暂不绑定）。
	DeliveryTemplateID int64
	// CustomVariables 是绑定发货模板时填充的自定义变量键值（如 link）。
	CustomVariables map[string]string
	// Items 是待转存的商品列表（最多 20 条）。
	Items []SaveTemplateItem
}

// SavedTemplateOutcome 记录单条采集商品转存模板的成功或失败详情。
type SavedTemplateOutcome struct {
	// ItemID 是源商品标识。
	ItemID string
	// Title 是最终采用的标题。
	Title string
	// Success 表示是否成功写入商品模板库。
	Success bool
	// TemplateID 是创建成功后的本地商品模板主键。
	TemplateID int64
	// ImageCount 是成功下载并关联的本地图片数量。
	ImageCount int
	// Error 是失败时的用户可读原因。
	Error string
}

// SaveTemplatesResult 汇总整批转存商品模板的执行结果。
type SaveTemplatesResult struct {
	// Total 是请求总条数。
	Total int
	// Succeeded 是成功创建的模板数。
	Succeeded int
	// Failed 是失败条数。
	Failed int
	// AbortedByRisk 表示补抓详情阶段是否因风控提前熔断。
	AbortedByRisk bool
	// Results 是按输入顺序排列的逐条结果。
	Results []SavedTemplateOutcome
}

// PlatformSearchParams 是应用层向平台采集端口传递的标准化搜索参数。
type PlatformSearchParams struct {
	// Background 标记雷达后台请求，适配器必须使用更严格的后台节流。
	Background bool
	// Keyword 是非空搜索词。
	Keyword string
	// PageNumber 是页码。
	PageNumber int
	// RowsPerPage 是每页条数。
	RowsPerPage int
	// SortField 是平台排序字段（空、create 或 price）。
	SortField string
	// SortValue 是平台排序方向（空、asc 或 desc）。
	SortValue string
	// MinPrice 是最低价过滤文本。
	MinPrice string
	// MaxPrice 是最高价过滤文本。
	MaxPrice string
	// PublishDays 是近 N 天发布过滤。
	PublishDays int
}

// PlatformPort 定义商品采集所需的最小闲鱼平台访问接口，由 adapter 层实现节流、凭证会话与风控识别。
type PlatformPort interface {
	// OwnsAccount 以非敏感方式校验指定账号是否归属当前用户。
	OwnsAccount(ctx context.Context, userID int64, cookieID string) (bool, error)
	// SearchMarket 使用指定账号执行单页全站关键词搜索。
	SearchMarket(ctx context.Context, cookieID string, params PlatformSearchParams) ([]CollectedItem, bool, int, error)
	// FetchItemDetail 使用指定账号读取单件商品完整详情；background 为 true 时启用后台慢速节流。
	FetchItemDetail(ctx context.Context, cookieID, itemID string, background bool) (CollectedItem, error)
	// FetchSellerPage 使用指定账号读取对标卖家单页在售商品；background 为 true 时启用后台慢速节流。
	FetchSellerPage(ctx context.Context, cookieID, sellerID string, pageNumber, pageSize int, background bool) ([]CollectedItem, bool, int, error)
	// IsAbortError 判断平台错误是否属于风控验证、登录失效或令牌耗尽等必须立即熔断的错误。
	IsAbortError(err error) bool
}

// AIRewriterPort 定义利用系统配置的大模型改写商品标题与详情的最小端口。
type AIRewriterPort interface {
	// Rewrite 根据原标题、原描述和附加要求生成防同质化的新标题与新描述。
	Rewrite(ctx context.Context, userID int64, input RewriteInput) (RewriteResult, error)
}

// RemoteImageDownloader 定义按系统安全策略下载公网商品主图字节的端口。
type RemoteImageDownloader interface {
	// Fetch 下载指定 http/https 图片并返回原始字节。
	Fetch(ctx context.Context, rawURL string) ([]byte, error)
}

// LibraryImageUploader 定义将下载好的图片写入本地图片库并去重的端口。
type LibraryImageUploader interface {
	// UploadImages 将图片字节保存到用户图片库并返回结果。
	UploadImages(ctx context.Context, userID int64, files []libraryapp.ImageUpload) ([]libraryapp.UploadResult, error)
}

// LibraryTemplateCreator 定义在本地资源库创建商品模板的端口。
type LibraryTemplateCreator interface {
	// CreateTemplate 校验并持久化一条新的商品模板。
	CreateTemplate(ctx context.Context, input libraryapp.Template) (libraryapp.Template, error)
}

// LibraryTemplateFinder 定义已有模板的本地查询能力，避免重复转存再次下载或调用模型。
type LibraryTemplateFinder interface {
	// FindCollectorTemplate 查询指定用户及同一请求摘要的模板；不存在返回资源库的标准未找到错误。
	FindCollectorTemplate(context.Context, int64, string) (libraryapp.Template, error)
}

// ManualVerifyPort 定义一键弹出可见闲鱼窗口供用户手动滑过官方验证并自动提取完整 Cookie Jar 的端口。
type ManualVerifyPort interface {
	// OpenVerifyWindow 载入指定账号登录态并在桌面弹出目标闲鱼网页。
	OpenVerifyWindow(ctx context.Context, cookieID, targetURL string) error
	// CompleteVerifyWindow 从已滑过验证的窗口同步完整 Cookie Jar（含各路径 x5sec）并返回同步的 Cookie 条数。
	CompleteVerifyWindow(ctx context.Context, cookieID string) (int, error)
	// CancelVerifyWindow 关闭尚未同步的验证窗口。
	CancelVerifyWindow(ctx context.Context, cookieID string) error
}

// OpenManualVerifyInput 描述打开可视化验证窗口的参数。
type OpenManualVerifyInput struct {
	// CookieID 是需要解除风控的闲鱼账号标识。
	CookieID string
	// Scene 是验证场景：search（全站搜索页，默认）、detail（商品详情页）或 seller（卖家主页）。
	Scene string
	// Keyword 是搜索场景附带的搜索词（用于触发搜索接口的 x5sec 挑战）。
	Keyword string
	// TargetID 是详情或卖家场景的可选目标 ID。
	TargetID string
}

// ManualVerifyCompleteResult 返回同步浏览器验证窗口后的脱敏摘要。
type ManualVerifyCompleteResult struct {
	// CookieID 是已完成凭证更新的账号标识。
	CookieID string
	// SyncedCount 是本次写入完整 Cookie Jar 快照的 Cookie 项数。
	SyncedCount int
}
