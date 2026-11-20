package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	collectorapp "xianyu-go/internal/application/collector"
	"xianyu-go/internal/db"
)

// radarScheduleSettingKey 是保存在 user_settings 表中的爆品雷达定时巡检配置键名。
const radarScheduleSettingKey = "viral_radar_schedule"

// CollectorRadarRepository 将应用层爆品雷达持久化端口适配到 db.ViralRadarStore 与 db.UserSettings。
type CollectorRadarRepository struct {
	// store 提供跨方言数据库仓储访问。
	store *db.Store
}

// NewCollectorRadarRepository 构造黑马爆品雷达仓储适配器。
func NewCollectorRadarRepository(store *db.Store) *CollectorRadarRepository {
	return &CollectorRadarRepository{store: store}
}

// ListTargets 读取用户的全部监控目标。
func (r *CollectorRadarRepository) ListTargets(ctx context.Context, userID int64) ([]collectorapp.RadarWatchTarget, error) {
	if r == nil || r.store == nil || r.store.ViralRadar == nil {
		return []collectorapp.RadarWatchTarget{}, nil
	}
	// rows、err 查询数据库目标行。
	rows, err := r.store.ViralRadar.ListTargets(ctx, userID)
	if err != nil {
		return nil, err
	}
	// out 映射为应用层结构。
	out := make([]collectorapp.RadarWatchTarget, 0, len(rows))
	// item 遍历数据库监控记录。
	for _, item := range rows {
		out = append(out, toAppRadarTarget(item))
	}
	return out, nil
}

// UpsertTarget 创建或更新单条监控目标。
func (r *CollectorRadarRepository) UpsertTarget(ctx context.Context, userID int64, target collectorapp.RadarWatchTarget) (collectorapp.RadarWatchTarget, error) {
	if r == nil || r.store == nil || r.store.ViralRadar == nil {
		return collectorapp.RadarWatchTarget{}, errors.New("爆品雷达存储未初始化")
	}
	// saved、err 幂等写入数据库。
	saved, err := r.store.ViralRadar.UpsertTarget(ctx, db.ViralWatchTarget{
		UserID:      userID,
		TargetType:  target.TargetType,
		TargetValue: target.TargetValue,
		Label:       target.Label,
		PublishDays: target.PublishDays,
		Enabled:     target.Enabled,
	})
	if err != nil {
		return collectorapp.RadarWatchTarget{}, err
	}
	return toAppRadarTarget(saved), nil
}

// ToggleTarget 更新监控目标启用状态。
func (r *CollectorRadarRepository) ToggleTarget(ctx context.Context, userID, targetID int64, enabled bool) error {
	if r == nil || r.store == nil || r.store.ViralRadar == nil {
		return errors.New("爆品雷达存储未初始化")
	}
	// err 更新启用标记。
	err := r.store.ViralRadar.ToggleTarget(ctx, userID, targetID, enabled)
	if errors.Is(err, db.ErrNotFound) {
		return &collectorapp.ValidationError{Message: "监控目标不存在或已删除"}
	}
	return err
}

// DeleteTarget 删除单条监控目标。
func (r *CollectorRadarRepository) DeleteTarget(ctx context.Context, userID, targetID int64) error {
	if r == nil || r.store == nil || r.store.ViralRadar == nil {
		return errors.New("爆品雷达存储未初始化")
	}
	// err 删除目标记录。
	err := r.store.ViralRadar.DeleteTarget(ctx, userID, targetID)
	if errors.Is(err, db.ErrNotFound) {
		return &collectorapp.ValidationError{Message: "监控目标不存在或已删除"}
	}
	return err
}

// MarkTargetScanned 更新目标最近巡检时间与命中数。
func (r *CollectorRadarRepository) MarkTargetScanned(ctx context.Context, userID, targetID int64, scannedAt int64, hitCount int) error {
	if r == nil || r.store == nil || r.store.ViralRadar == nil {
		return nil
	}
	return r.store.ViralRadar.MarkTargetScanned(ctx, userID, targetID, scannedAt, hitCount)
}

// GetSnapshot 读取单个商品既有热度快照。
func (r *CollectorRadarRepository) GetSnapshot(ctx context.Context, userID int64, itemID string) (collectorapp.RadarItemSnapshot, bool, error) {
	if r == nil || r.store == nil || r.store.ViralRadar == nil {
		return collectorapp.RadarItemSnapshot{}, false, nil
	}
	// snap、err 查询单条快照。
	snap, err := r.store.ViralRadar.GetItemSnapshot(ctx, userID, itemID)
	if errors.Is(err, db.ErrNotFound) {
		return collectorapp.RadarItemSnapshot{}, false, nil
	}
	if err != nil {
		return collectorapp.RadarItemSnapshot{}, false, err
	}
	return toAppRadarSnapshot(snap), true, nil
}

// SaveSnapshot 保存或覆盖单个商品热度快照（若数据库已有主键则原地更新）。
func (r *CollectorRadarRepository) SaveSnapshot(ctx context.Context, userID int64, snap collectorapp.RadarItemSnapshot) error {
	if r == nil || r.store == nil || r.store.ViralRadar == nil {
		return errors.New("爆品雷达存储未初始化")
	}
	// existingID 检查既有记录主键。
	var existingID int64
	// prev、prevErr 读取已有记录主键以决定 INSERT 或 UPDATE。
	if prev, prevErr := r.store.ViralRadar.GetItemSnapshot(ctx, userID, snap.ItemID); prevErr == nil {
		existingID = prev.ID
	} else if !errors.Is(prevErr, db.ErrNotFound) {
		return prevErr
	}
	return r.store.ViralRadar.SaveItemSnapshot(ctx, db.ViralItemSnapshot{
		ID:                existingID,
		UserID:            userID,
		ItemID:            snap.ItemID,
		Title:             snap.Title,
		Price:             snap.Price,
		OriginalPrice:     snap.OriginalPrice,
		PicURL:            snap.PicURL,
		Area:              snap.Area,
		SellerID:          snap.SellerID,
		SellerNick:        snap.SellerNick,
		IsFreeShipping:    snap.IsFreeShipping,
		SourceType:        snap.SourceType,
		SourceLabel:       snap.SourceLabel,
		PublishTimeUnix:   snap.PublishTimeUnix,
		FirstSeenAt:       snap.FirstSeenAt,
		FirstWantCount:    snap.FirstWantCount,
		PrevSeenAt:        snap.PrevSeenAt,
		PrevWantCount:     snap.PrevWantCount,
		LatestSeenAt:      snap.LatestSeenAt,
		LatestWantCount:   snap.LatestWantCount,
		DeltaWant:         snap.DeltaWant,
		DailyVelocityX100: snap.DailyVelocityX100,
		ViralScore:        snap.ViralScore,
		ScanCount:         snap.ScanCount,
	})
}

// ListSnapshots 按榜单与筛选条件查询黑马爆品快照。
func (r *CollectorRadarRepository) ListSnapshots(ctx context.Context, userID int64, query collectorapp.RadarListQuery) ([]collectorapp.RadarItemSnapshot, error) {
	if r == nil || r.store == nil || r.store.ViralRadar == nil {
		return []collectorapp.RadarItemSnapshot{}, nil
	}
	// rows、err 执行条件排序查询。
	rows, err := r.store.ViralRadar.ListSnapshots(ctx, userID, db.ViralSnapshotQuery{
		SortBy:       query.SortBy,
		SourceType:   query.SourceType,
		MinWantCount: query.MinWantCount,
		MinDeltaWant: query.MinDeltaWant,
		MaxAgeHours:  query.MaxAgeHours,
		Limit:        query.Limit,
	})
	if err != nil {
		return nil, err
	}
	// out 转换结果集。
	out := make([]collectorapp.RadarItemSnapshot, 0, len(rows))
	// row 遍历数据库快照行。
	for _, row := range rows {
		out = append(out, toAppRadarSnapshot(row))
	}
	return out, nil
}

// ClearSnapshots 清空用户的历史爆品快照。
func (r *CollectorRadarRepository) ClearSnapshots(ctx context.Context, userID int64) error {
	if r == nil || r.store == nil || r.store.ViralRadar == nil {
		return nil
	}
	return r.store.ViralRadar.ClearSnapshots(ctx, userID)
}

// radarScheduleStoredJSON 是存储在 user_settings 中的定时巡检 JSON 结构。
type radarScheduleStoredJSON struct {
	// Enabled 表示自动巡检开关。
	Enabled bool `json:"enabled"`
	// CookieID 是自动巡检绑定的闲鱼账号标识。
	CookieID string `json:"cookie_id"`
	// IntervalHours 是巡检周期小时数。
	IntervalHours int `json:"interval_hours"`
	// LastAutoRunUnix 是最近一次自动巡检时间戳。
	LastAutoRunUnix int64 `json:"last_auto_run_unix"`
}

// GetSchedule 读取用户的低频定时自动巡检配置（默认关闭，周期 12 小时）。
func (r *CollectorRadarRepository) GetSchedule(ctx context.Context, userID int64) (collectorapp.RadarScheduleConfig, error) {
	// def 是安全的默认关闭配置。
	def := collectorapp.RadarScheduleConfig{Enabled: false, IntervalHours: 12}
	if r == nil || r.store == nil || r.store.UserSettings == nil {
		return def, errors.New("定时计划存储未初始化")
	}
	// raw、err 读取用户设置文本。
	raw, err := r.store.UserSettings.GetForUser(ctx, userID, radarScheduleSettingKey)
	if err != nil || strings.TrimSpace(raw) == "" {
		return def, err
	}
	// parsed 解码持久化 JSON。
	var parsed radarScheduleStoredJSON
	// unmarshalErr 检查 JSON 合法性。
	if unmarshalErr := json.Unmarshal([]byte(raw), &parsed); unmarshalErr != nil {
		return def, errors.New("定时计划数据格式无效，需人工核对")
	}
	if parsed.IntervalHours != 6 && parsed.IntervalHours != 12 && parsed.IntervalHours != 24 {
		parsed.IntervalHours = 12
	}
	return collectorapp.RadarScheduleConfig{
		Enabled:         parsed.Enabled,
		CookieID:        parsed.CookieID,
		IntervalHours:   parsed.IntervalHours,
		LastAutoRunUnix: parsed.LastAutoRunUnix,
	}, nil
}

// SaveSchedule 将用户的低频定时巡检配置保存至 user_settings。
func (r *CollectorRadarRepository) SaveSchedule(ctx context.Context, userID int64, cfg collectorapp.RadarScheduleConfig) error {
	if r == nil || r.store == nil || r.store.UserSettings == nil {
		return errors.New("用户设置存储未初始化")
	}
	// encoded、err 编码定时配置 JSON。
	encoded, err := json.Marshal(radarScheduleStoredJSON{
		Enabled:         cfg.Enabled,
		CookieID:        cfg.CookieID,
		IntervalHours:   cfg.IntervalHours,
		LastAutoRunUnix: cfg.LastAutoRunUnix,
	})
	if err != nil {
		return err
	}
	return r.store.UserSettings.SetForUser(ctx, userID, radarScheduleSettingKey, string(encoded))
}

// ListScheduledUsers 枚举所有启用了后台自动巡检的用户配置。
func (r *CollectorRadarRepository) ListScheduledUsers(ctx context.Context) ([]collectorapp.ScheduledRadarUser, error) {
	if r == nil || r.store == nil || r.store.UserSettings == nil {
		return nil, nil
	}
	// rawByUser、err 读取全部保存过定时配置的用户记录。
	rawByUser, err := r.store.UserSettings.ListByKey(ctx, radarScheduleSettingKey)
	if err != nil {
		return nil, err
	}
	// out 收集处于启用状态的有效配置。
	out := make([]collectorapp.ScheduledRadarUser, 0, len(rawByUser))
	// uid、raw 遍历每个用户的设置 JSON。
	for uid, raw := range rawByUser {
		// parsed 解码单个配置。
		var parsed radarScheduleStoredJSON
		if json.Unmarshal([]byte(raw), &parsed) != nil || !parsed.Enabled {
			continue
		}
		out = append(out, collectorapp.ScheduledRadarUser{
			UserID: uid,
			Config: collectorapp.RadarScheduleConfig{
				Enabled:         parsed.Enabled,
				CookieID:        parsed.CookieID,
				IntervalHours:   parsed.IntervalHours,
				LastAutoRunUnix: parsed.LastAutoRunUnix,
			},
		})
	}
	return out, nil
}

// toAppRadarTarget 将数据库监控记录映射为应用层对象。
func toAppRadarTarget(row db.ViralWatchTarget) collectorapp.RadarWatchTarget {
	return collectorapp.RadarWatchTarget{
		ID:            row.ID,
		TargetType:    row.TargetType,
		TargetValue:   row.TargetValue,
		Label:         row.Label,
		PublishDays:   row.PublishDays,
		Enabled:       row.Enabled,
		LastScannedAt: row.LastScannedAt,
		LastHitCount:  row.LastHitCount,
		CreatedAt:     row.CreatedAt,
	}
}

// toAppRadarSnapshot 将数据库商品热度快照映射为应用层对象。
func toAppRadarSnapshot(row db.ViralItemSnapshot) collectorapp.RadarItemSnapshot {
	return collectorapp.RadarItemSnapshot{
		ItemID:            row.ItemID,
		Title:             row.Title,
		Price:             row.Price,
		OriginalPrice:     row.OriginalPrice,
		PicURL:            row.PicURL,
		Area:              row.Area,
		SellerID:          row.SellerID,
		SellerNick:        row.SellerNick,
		IsFreeShipping:    row.IsFreeShipping,
		SourceType:        row.SourceType,
		SourceLabel:       row.SourceLabel,
		PublishTimeUnix:   row.PublishTimeUnix,
		FirstSeenAt:       row.FirstSeenAt,
		FirstWantCount:    row.FirstWantCount,
		PrevSeenAt:        row.PrevSeenAt,
		PrevWantCount:     row.PrevWantCount,
		LatestSeenAt:      row.LatestSeenAt,
		LatestWantCount:   row.LatestWantCount,
		DeltaWant:         row.DeltaWant,
		DailyVelocityX100: row.DailyVelocityX100,
		DailyVelocity:     float64(row.DailyVelocityX100) / 100.0,
		ViralScore:        row.ViralScore,
		ScanCount:         row.ScanCount,
		WebURL:            "https://www.goofish.com/item?id=" + row.ItemID,
	}
}

// 编译期断言适配器满足应用层爆品雷达仓储端口。
var _ collectorapp.RadarRepositoryPort = (*CollectorRadarRepository)(nil)
