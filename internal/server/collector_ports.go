package server

import (
	"context"

	collectorapp "xianyu-go/internal/application/collector"
)

// CollectorPort 定义全站商品采集 HTTP 路由消费的最小应用服务能力。
type CollectorPort interface {
	// SearchKeyword 使用指定账号搜索全站闲鱼商品。
	SearchKeyword(context.Context, int64, collectorapp.SearchQuery) (collectorapp.SearchResult, error)
	// CollectItemDetails 按商品链接或 ID 列表精准抓取完整详情。
	CollectItemDetails(context.Context, int64, collectorapp.DetailCollectInput) (collectorapp.DetailCollectResult, error)
	// CollectSellerItems 按同行主页链接或卖家 ID 抓取在售商品。
	CollectSellerItems(context.Context, int64, collectorapp.SellerCollectInput) (collectorapp.SearchResult, error)
	// RewriteItem 调用系统大模型对单品标题与文案做防重改写。
	RewriteItem(context.Context, int64, collectorapp.RewriteInput) (collectorapp.RewriteResult, error)
	// SaveToTemplates 将采集商品批量下载主图并转入本地资源库商品模板。
	SaveToTemplates(context.Context, int64, collectorapp.SaveTemplatesInput) (collectorapp.SaveTemplatesResult, error)
	// OpenManualVerify 弹出预载登录态的可见闲鱼窗口供用户手动完成滑块验证。
	OpenManualVerify(context.Context, int64, collectorapp.OpenManualVerifyInput) (string, error)
	// CompleteManualVerify 读取可见窗口完成验证后的完整 Cookie Jar 快照并关闭窗口。
	CompleteManualVerify(context.Context, int64, string) (collectorapp.ManualVerifyCompleteResult, error)
	// CancelManualVerify 主动关闭打开中的验证窗口。
	CancelManualVerify(context.Context, int64, string) error
	// ListRadarTargets 读取用户的全部爆品雷达监控目标。
	ListRadarTargets(context.Context, int64) ([]collectorapp.RadarWatchTarget, error)
	// AddRadarTargets 批量添加监控目标或导入内置虚拟资料词包。
	AddRadarTargets(context.Context, int64, []collectorapp.RadarTargetInput, bool) ([]collectorapp.RadarWatchTarget, error)
	// ToggleRadarTarget 切换单条监控目标启停状态。
	ToggleRadarTarget(context.Context, int64, int64, bool) error
	// DeleteRadarTarget 删除单条监控目标。
	DeleteRadarTarget(context.Context, int64, int64) error
	// SuggestRadarKeywords 调用系统 AI 裂变当季高潜力搜索热词。
	SuggestRadarKeywords(context.Context, int64, string) ([]string, error)
	// StartRadarScan 启动全池慢速爆品巡检任务。
	StartRadarScan(context.Context, int64, string) (collectorapp.RadarScanStatus, error)
	// StopRadarScan 停止当前用户正在运行的爆品巡检任务。
	StopRadarScan(context.Context, int64) (collectorapp.RadarScanStatus, error)
	// GetRadarScanStatus 查询爆品巡检实时进度与定时配置。
	GetRadarScanStatus(context.Context, int64) (collectorapp.RadarScanStatus, error)
	// UpdateRadarSchedule 保存低频自动巡检配置。
	UpdateRadarSchedule(context.Context, int64, collectorapp.RadarScheduleConfig) (collectorapp.RadarScheduleConfig, error)
	// ListRadarItems 按黑马得分或增量增速筛选商品快照列表。
	ListRadarItems(context.Context, int64, collectorapp.RadarListQuery) ([]collectorapp.RadarItemSnapshot, error)
	// ClearRadarItems 清空用户的历史爆品快照数据。
	ClearRadarItems(context.Context, int64) error
}

// collectorApplication 返回全站商品采集用例。
func (server *Server) collectorApplication() CollectorPort {
	return server.applicationServiceSet().collector
}
