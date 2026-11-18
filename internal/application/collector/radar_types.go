package collector

import "context"

// RadarWatchTarget 表示应用层的单条赛道关键词或对标同行监控配置。
type RadarWatchTarget struct {
	// ID 是监控配置主键。
	ID int64
	// TargetType 是监控类型：keyword（赛道关键词）或 seller（同行卖家 ID）。
	TargetType string
	// TargetValue 是归一化后的关键词文本或纯数字卖家 ID。
	TargetValue string
	// Label 是界面展示名称或备注。
	Label string
	// PublishDays 是关键词模式下的新发天数过滤（0 不限，1/3/7 天专抓新发黑马）。
	PublishDays int
	// Enabled 表示是否参与巡检。
	Enabled bool
	// LastScannedAt 是最近一次完成巡检的 Unix 秒时间戳。
	LastScannedAt int64
	// LastHitCount 是最近一次巡检抓取到的商品数。
	LastHitCount int
	// CreatedAt 是创建 Unix 秒时间戳。
	CreatedAt int64
}

// RadarTargetInput 描述单条新增监控目标输入。
type RadarTargetInput struct {
	// TargetType 是监控类型（keyword 或 seller）。
	TargetType string
	// RawValue 是关键词或同行主页链接/卖家数字 ID。
	RawValue string
	// Label 是可选备注名。
	Label string
	// PublishDays 是关键词新发窗口（默认 3 天）。
	PublishDays int
}

// RadarItemSnapshot 表示应用层输出的单件黑马爆品快照与增速指标。
type RadarItemSnapshot struct {
	// ItemID 是闲鱼商品唯一标识。
	ItemID string
	// Title 是商品标题。
	Title string
	// Price 是售价文本（元）。
	Price string
	// OriginalPrice 是划线原价文本（元）。
	OriginalPrice string
	// PicURL 是高清封面主图 HTTPS 地址。
	PicURL string
	// Area 是商品地区文本。
	Area string
	// SellerID 是卖家数字 ID。
	SellerID string
	// SellerNick 是卖家昵称。
	SellerNick string
	// IsFreeShipping 表示是否包邮。
	IsFreeShipping bool
	// SourceType 是来源类型（keyword 或 seller）。
	SourceType string
	// SourceLabel 是命中的监控词或同行备注。
	SourceLabel string
	// PublishTimeUnix 是解析或折算出的发布 Unix 秒时间戳。
	PublishTimeUnix int64
	// FirstSeenAt 是首次收录时间戳。
	FirstSeenAt int64
	// FirstWantCount 是首次收录时的想要人数。
	FirstWantCount int
	// PrevSeenAt 是上一轮巡检时间戳。
	PrevSeenAt int64
	// PrevWantCount 是上一轮巡检时的想要人数。
	PrevWantCount int
	// LatestSeenAt 是最新巡检时间戳。
	LatestSeenAt int64
	// LatestWantCount 是最新想要人数。
	LatestWantCount int
	// DeltaWant 是较上轮巡检真实新增的想要人数（同行新发破零同样计入）。
	DeltaWant int
	// DailyVelocityX100 是日均想要增速乘以 100 的整数值。
	DailyVelocityX100 int
	// DailyVelocity 是日均想要增速浮点数（想要/天）。
	DailyVelocity float64
	// ViralScore 是黑马爆品综合热度得分。
	ViralScore int
	// ScanCount 是累计巡检命中次数。
	ScanCount int
	// WebURL 是闲鱼商品网页链接。
	WebURL string
}

// RadarListQuery 描述黑马爆品榜单的查询与筛选参数。
type RadarListQuery struct {
	// SortBy 是榜单模式：score（黑马综合榜）、delta（Δ想要暴涨榜）、velocity（新发飙升榜）、seller_new（同行上新榜）。
	SortBy string
	// SourceType 可选按来源过滤（keyword / seller / 空串）。
	SourceType string
	// MinWantCount 是最低当前想要人数。
	MinWantCount int
	// MinDeltaWant 是最低新增 Δ想要人数。
	MinDeltaWant int
	// MaxAgeHours 限制发布时长上限（小时，0 不限）。
	MaxAgeHours int
	// Limit 是返回条数上限。
	Limit int
}

// RadarScheduleConfig 描述用户的可选低频后台定时巡检设置（默认关闭）。
type RadarScheduleConfig struct {
	// Enabled 控制是否启用后台低频自动巡检。
	Enabled bool
	// CookieID 是自动巡检使用的闲鱼账号标识。
	CookieID string
	// IntervalHours 是巡检间隔小时数（允许 6、12 或 24 小时）。
	IntervalHours int
	// LastAutoRunUnix 记录最近一次自动触发巡检的 Unix 秒时间戳。
	LastAutoRunUnix int64
}

// ScheduledRadarUser 供后台低频调度器枚举已开启自动巡检的用户配置。
type ScheduledRadarUser struct {
	// UserID 是用户标识。
	UserID int64
	// Config 是该用户的定时巡检配置。
	Config RadarScheduleConfig
}

// RadarScanStatus 反映当前用户爆品巡检任务的实时进度、风控状态与定时配置。
type RadarScanStatus struct {
	// Running 表示当前是否有巡检任务正在后台慢速执行。
	Running bool
	// CookieID 是本轮巡检使用的闲鱼账号标识。
	CookieID string
	// TotalTargets 是本轮待巡检的监控目标总数。
	TotalTargets int
	// CompletedTargets 是本轮已完成的监控目标数。
	CompletedTargets int
	// CurrentTarget 是正在扫描的监控词或同行名称。
	CurrentTarget string
	// UpdatedItems 是本轮扫描更新的商品总数。
	UpdatedItems int
	// RisingItems 是本轮发现 Δ想要 > 0 或新发高增速的异动商品数。
	RisingItems int
	// AbortedByRisk 表示本轮是否因命中 RGV587 滑块或凭证失效提前熔断。
	AbortedByRisk bool
	// LastError 记录最近一次熔断或异常提示文本。
	LastError string
	// StartedAt 是本轮或上一轮巡检开始的 Unix 秒时间戳。
	StartedAt int64
	// FinishedAt 是上一轮巡检结束的 Unix 秒时间戳。
	FinishedAt int64
	// Schedule 是当前用户的低频自动巡检配置。
	Schedule RadarScheduleConfig
}

// RadarRepositoryPort 定义爆品雷达所需的数据库持久化端口。
type RadarRepositoryPort interface {
	// ListTargets 读取用户的全部监控目标。
	ListTargets(ctx context.Context, userID int64) ([]RadarWatchTarget, error)
	// UpsertTarget 幂等新增或更新监控目标。
	UpsertTarget(ctx context.Context, userID int64, target RadarWatchTarget) (RadarWatchTarget, error)
	// ToggleTarget 更新监控目标启停状态。
	ToggleTarget(ctx context.Context, userID, targetID int64, enabled bool) error
	// DeleteTarget 删除单条监控目标。
	DeleteTarget(ctx context.Context, userID, targetID int64) error
	// MarkTargetScanned 记录目标最近一次扫描完成时间与命中数。
	MarkTargetScanned(ctx context.Context, userID, targetID int64, scannedAt int64, hitCount int) error
	// GetSnapshot 读取单个商品既有历史快照。
	GetSnapshot(ctx context.Context, userID int64, itemID string) (RadarItemSnapshot, bool, error)
	// SaveSnapshot 写入或更新单个商品热度快照。
	SaveSnapshot(ctx context.Context, userID int64, snap RadarItemSnapshot) error
	// ListSnapshots 按榜单规则查询黑马商品快照列表。
	ListSnapshots(ctx context.Context, userID int64, query RadarListQuery) ([]RadarItemSnapshot, error)
	// ClearSnapshots 清空指定用户的历史商品快照。
	ClearSnapshots(ctx context.Context, userID int64) error
	// GetSchedule 读取用户的低频定时巡检配置。
	GetSchedule(ctx context.Context, userID int64) (RadarScheduleConfig, error)
	// SaveSchedule 保存用户的低频定时巡检配置。
	SaveSchedule(ctx context.Context, userID int64, cfg RadarScheduleConfig) error
	// ListScheduledUsers 枚举所有开启了定时自动巡检的用户配置。
	ListScheduledUsers(ctx context.Context) ([]ScheduledRadarUser, error)
}

// AIKeywordGeneratorPort 定义调用系统大模型裂变当季高潜力选品关键词的端口。
type AIKeywordGeneratorPort interface {
	// SuggestKeywords 根据用户的经营赛道与当前月份推荐高潜力搜索热词。
	SuggestKeywords(ctx context.Context, userID int64, niche string, count int) ([]string, error)
}
