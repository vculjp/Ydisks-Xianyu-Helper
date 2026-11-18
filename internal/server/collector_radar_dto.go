package server

import (
	collectorapp "xianyu-go/internal/application/collector"
)

// collectorRadarTargetDTO 是 HTTP 层输出的单条赛道词或同行监控目标，对应 OpenAPI CollectorRadarTarget。
type collectorRadarTargetDTO struct {
	// ID 是监控配置主键。
	ID int64 `json:"id"`
	// TargetType 是监控类型（keyword 或 seller）。
	TargetType string `json:"target_type"`
	// TargetValue 是关键词或卖家数字 ID。
	TargetValue string `json:"target_value"`
	// Label 是可读展示备注。
	Label string `json:"label"`
	// PublishDays 是关键词新发窗口天数（0 表示不限）。
	PublishDays int `json:"publish_days"`
	// Enabled 表示是否启用参与巡检。
	Enabled bool `json:"enabled"`
	// LastScannedAt 是最近一次扫描完成的 Unix 秒时间戳。
	LastScannedAt int64 `json:"last_scanned_at"`
	// LastHitCount 是最近一次扫描命中的商品数。
	LastHitCount int `json:"last_hit_count"`
	// CreatedAt 是创建时间戳。
	CreatedAt int64 `json:"created_at"`
}

// collectorRadarTargetsResponse 是监控目标列表响应体。
type collectorRadarTargetsResponse struct {
	// Targets 是监控目标数组。
	Targets []collectorRadarTargetDTO `json:"targets"`
}

// collectorRadarTargetInputDTO 是单条待添加监控项输入。
type collectorRadarTargetInputDTO struct {
	// TargetType 是监控类型（keyword 或 seller）。
	TargetType string `json:"target_type"`
	// RawValue 是关键词或同行主页链接/卖家 ID。
	RawValue string `json:"raw_value"`
	// Label 是可选展示备注。
	Label string `json:"label"`
	// PublishDays 是关键词新发过滤天数。
	PublishDays int `json:"publish_days"`
}

// collectorRadarAddTargetsRequest 是批量添加监控目标或导入种子词包的请求体。
type collectorRadarAddTargetsRequest struct {
	// Targets 是显式提交的新增目标数组。
	Targets []collectorRadarTargetInputDTO `json:"targets"`
	// ImportVirtualSeedPack 为 true 时一键并入内置虚拟资料精选监控词包。
	ImportVirtualSeedPack bool `json:"import_virtual_seed_pack"`
}

// collectorRadarToggleTargetRequest 是切换单条监控目标启停状态的请求体。
type collectorRadarToggleTargetRequest struct {
	// Enabled 指定目标的新启用状态。
	Enabled bool `json:"enabled"`
}

// collectorRadarMutationResponse 是更新、删除或清空操作的轻量确认响应。
type collectorRadarMutationResponse struct {
	// Success 表示操作已完成。
	Success bool `json:"success"`
}

// collectorRadarAIKeywordsRequest 是调用 AI 生成当季易爆搜索热词的请求体。
type collectorRadarAIKeywordsRequest struct {
	// Niche 是用户的经营赛道描述文本。
	Niche string `json:"niche"`
}

// collectorRadarAIKeywordsResponse 是 AI 热词裂变响应体。
type collectorRadarAIKeywordsResponse struct {
	// Keywords 是推荐的高潜力短搜索词数组。
	Keywords []string `json:"keywords"`
}

// collectorRadarStartScanRequest 是手动触发慢速巡检的请求体。
type collectorRadarStartScanRequest struct {
	// CookieID 是执行巡检的闲鱼账号标识。
	CookieID string `json:"cookie_id"`
}

// collectorRadarScheduleDTO 是低频后台自动巡检配置传输结构。
type collectorRadarScheduleDTO struct {
	// Enabled 控制自动巡检开关。
	Enabled bool `json:"enabled"`
	// CookieID 是自动巡检绑定的闲鱼账号标识。
	CookieID string `json:"cookie_id"`
	// IntervalHours 是巡检间隔小时数（6/12/24）。
	IntervalHours int `json:"interval_hours"`
	// LastAutoRunUnix 是最近一次自动执行的 Unix 秒时间戳。
	LastAutoRunUnix int64 `json:"last_auto_run_unix"`
}

// collectorRadarScanStatusResponse 是爆品巡检实时进度与定时配置响应体。
type collectorRadarScanStatusResponse struct {
	// Running 表示后台巡检是否正在运行。
	Running bool `json:"running"`
	// CookieID 是当前或上一轮使用的闲鱼账号标识。
	CookieID string `json:"cookie_id"`
	// TotalTargets 是待扫描目标总数。
	TotalTargets int `json:"total_targets"`
	// CompletedTargets 是已完成扫描的目标数。
	CompletedTargets int `json:"completed_targets"`
	// CurrentTarget 是当前正在扫描的目标名称。
	CurrentTarget string `json:"current_target"`
	// UpdatedItems 是本轮扫描更新的商品数。
	UpdatedItems int `json:"updated_items"`
	// RisingItems 是本轮命中的异动飙升商品数。
	RisingItems int `json:"rising_items"`
	// AbortedByRisk 表示是否因风控安全熔断。
	AbortedByRisk bool `json:"aborted_by_risk"`
	// LastError 是最近异常或熔断说明文本。
	LastError string `json:"last_error"`
	// StartedAt 是开始时间戳。
	StartedAt int64 `json:"started_at"`
	// FinishedAt 是结束时间戳。
	FinishedAt int64 `json:"finished_at"`
	// Schedule 是当前用户的低频定时巡检配置。
	Schedule collectorRadarScheduleDTO `json:"schedule"`
}

// collectorRadarItemDTO 是单件黑马爆品快照及增速指标传输对象。
type collectorRadarItemDTO struct {
	// ItemID 是闲鱼商品唯一标识。
	ItemID string `json:"item_id"`
	// Title 是商品标题。
	Title string `json:"title"`
	// Price 是售价文本（元）。
	Price string `json:"price"`
	// OriginalPrice 是原价文本（元）。
	OriginalPrice string `json:"original_price"`
	// PicURL 是高清主图地址。
	PicURL string `json:"pic_url"`
	// Area 是地区文本。
	Area string `json:"area"`
	// SellerID 是卖家数字 ID。
	SellerID string `json:"seller_id"`
	// SellerNick 是卖家昵称。
	SellerNick string `json:"seller_nick"`
	// IsFreeShipping 表示是否包邮。
	IsFreeShipping bool `json:"is_free_shipping"`
	// SourceType 是来源类别（keyword 或 seller）。
	SourceType string `json:"source_type"`
	// SourceLabel 是命中的监控词或同行备注。
	SourceLabel string `json:"source_label"`
	// PublishTimeUnix 是商品发布或估算 Unix 秒时间戳。
	PublishTimeUnix int64 `json:"publish_time_unix"`
	// FirstSeenAt 是首次收录时间戳。
	FirstSeenAt int64 `json:"first_seen_at"`
	// FirstWantCount 是首次收录想要数。
	FirstWantCount int `json:"first_want_count"`
	// PrevSeenAt 是上轮巡检时间戳。
	PrevSeenAt int64 `json:"prev_seen_at"`
	// PrevWantCount 是上轮想要数。
	PrevWantCount int `json:"prev_want_count"`
	// LatestSeenAt 是最新巡检时间戳。
	LatestSeenAt int64 `json:"latest_seen_at"`
	// LatestWantCount 是最新想要人数。
	LatestWantCount int `json:"latest_want_count"`
	// DeltaWant 是较上轮新增 Δ想要人数。
	DeltaWant int `json:"delta_want"`
	// DailyVelocity 是日均想要飙升速率（想要/天）。
	DailyVelocity float64 `json:"daily_velocity"`
	// ViralScore 是黑马综合热度得分。
	ViralScore int `json:"viral_score"`
	// ScanCount 是累计观测轮数。
	ScanCount int `json:"scan_count"`
	// WebURL 是闲鱼商品网页链接。
	WebURL string `json:"web_url"`
}

// collectorRadarItemsResponse 是黑马爆品快照榜单响应体。
type collectorRadarItemsResponse struct {
	// Items 是符合筛选排序条件的黑马商品列表。
	Items []collectorRadarItemDTO `json:"items"`
}

// newCollectorRadarTargetDTO 将应用层监控目标映射为 HTTP DTO。
func newCollectorRadarTargetDTO(item collectorapp.RadarWatchTarget) collectorRadarTargetDTO {
	return collectorRadarTargetDTO{
		ID:            item.ID,
		TargetType:    item.TargetType,
		TargetValue:   item.TargetValue,
		Label:         item.Label,
		PublishDays:   item.PublishDays,
		Enabled:       item.Enabled,
		LastScannedAt: item.LastScannedAt,
		LastHitCount:  item.LastHitCount,
		CreatedAt:     item.CreatedAt,
	}
}

// newCollectorRadarScanStatusResponse 将应用层巡检状态映射为 HTTP 响应。
func newCollectorRadarScanStatusResponse(st collectorapp.RadarScanStatus) collectorRadarScanStatusResponse {
	return collectorRadarScanStatusResponse{
		Running:          st.Running,
		CookieID:         st.CookieID,
		TotalTargets:     st.TotalTargets,
		CompletedTargets: st.CompletedTargets,
		CurrentTarget:    st.CurrentTarget,
		UpdatedItems:     st.UpdatedItems,
		RisingItems:      st.RisingItems,
		AbortedByRisk:    st.AbortedByRisk,
		LastError:        st.LastError,
		StartedAt:        st.StartedAt,
		FinishedAt:       st.FinishedAt,
		Schedule: collectorRadarScheduleDTO{
			Enabled:         st.Schedule.Enabled,
			CookieID:        st.Schedule.CookieID,
			IntervalHours:   st.Schedule.IntervalHours,
			LastAutoRunUnix: st.Schedule.LastAutoRunUnix,
		},
	}
}

// newCollectorRadarItemDTO 将应用层商品热度快照映射为 HTTP DTO。
func newCollectorRadarItemDTO(item collectorapp.RadarItemSnapshot) collectorRadarItemDTO {
	return collectorRadarItemDTO{
		ItemID:          item.ItemID,
		Title:           item.Title,
		Price:           item.Price,
		OriginalPrice:   item.OriginalPrice,
		PicURL:          item.PicURL,
		Area:            item.Area,
		SellerID:        item.SellerID,
		SellerNick:      item.SellerNick,
		IsFreeShipping:  item.IsFreeShipping,
		SourceType:      item.SourceType,
		SourceLabel:     item.SourceLabel,
		PublishTimeUnix: item.PublishTimeUnix,
		FirstSeenAt:     item.FirstSeenAt,
		FirstWantCount:  item.FirstWantCount,
		PrevSeenAt:      item.PrevSeenAt,
		PrevWantCount:   item.PrevWantCount,
		LatestSeenAt:    item.LatestSeenAt,
		LatestWantCount: item.LatestWantCount,
		DeltaWant:       item.DeltaWant,
		DailyVelocity:   item.DailyVelocity,
		ViralScore:      item.ViralScore,
		ScanCount:       item.ScanCount,
		WebURL:          item.WebURL,
	}
}
