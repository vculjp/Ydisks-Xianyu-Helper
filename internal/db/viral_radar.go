package db

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// ViralWatchTarget 对应 viral_watch_targets 表中的单条赛道关键词或对标同行监控配置。
type ViralWatchTarget struct {
	// ID 是监控配置主键。
	ID int64
	// UserID 是所属用户标识。
	UserID int64
	// TargetType 区分监控类型：keyword（赛道关键词）或 seller（对标同行卖家 ID）。
	TargetType string
	// TargetValue 是归一化后的关键词文本或卖家数字 ID。
	TargetValue string
	// Label 是可读展示备注名。
	Label string
	// PublishDays 是关键词搜索时的上架天数过滤（0 表示不限，1/3/7 表示新发黑马窗口）。
	PublishDays int
	// Enabled 表示该监控项是否参与巡检。
	Enabled bool
	// LastScannedAt 是最近一次完成巡检的 Unix 秒时间戳。
	LastScannedAt int64
	// LastHitCount 是最近一次巡检命中的有效商品数量。
	LastHitCount int
	// CreatedAt 是创建时刻的 Unix 秒时间戳。
	CreatedAt int64
}

// ViralItemSnapshot 对应 viral_item_snapshots 表中的单件商品热度与增量历史快照。
type ViralItemSnapshot struct {
	// ID 是快照记录主键。
	ID int64
	// UserID 是所属用户标识。
	UserID int64
	// ItemID 是闲鱼商品数字标识。
	ItemID string
	// Title 是商品标题。
	Title string
	// Price 是当前售价文本（元）。
	Price string
	// OriginalPrice 是可选原价文本（元）。
	OriginalPrice string
	// PicURL 是高清封面主图地址。
	PicURL string
	// Area 是商品地区文本。
	Area string
	// SellerID 是卖家数字 ID。
	SellerID string
	// SellerNick 是卖家昵称。
	SellerNick string
	// IsFreeShipping 表示商品是否包邮。
	IsFreeShipping bool
	// SourceType 记录最近发现该商品的监控来源类型（keyword 或 seller）。
	SourceType string
	// SourceLabel 记录最近发现该商品的监控词或同行备注。
	SourceLabel string
	// PublishTimeUnix 是解析或估算出的商品发布 Unix 秒时间戳（未知时为 0）。
	PublishTimeUnix int64
	// FirstSeenAt 是首次收录该商品的 Unix 秒时间戳。
	FirstSeenAt int64
	// FirstWantCount 是首次收录时的想要人数。
	FirstWantCount int
	// PrevSeenAt 是上一轮巡检观测该商品的 Unix 秒时间戳。
	PrevSeenAt int64
	// PrevWantCount 是上一轮巡检观测到的想要人数。
	PrevWantCount int
	// LatestSeenAt 是最近一次观测该商品的 Unix 秒时间戳。
	LatestSeenAt int64
	// LatestWantCount 是最新观测到的想要人数。
	LatestWantCount int
	// DeltaWant 是较上一轮快照新增的想要人数（首次出现时为 0）。
	DeltaWant int
	// DailyVelocityX100 是日均想要飙升速率乘以 100 后的定点数（例如 2450 代表 24.50 想要/天）。
	DailyVelocityX100 int
	// ViralScore 是综合日均增速、近期增量与想要基数的黑马指数。
	ViralScore int
	// ScanCount 是累计观测到该商品的巡检轮数。
	ScanCount int
}

// ViralSnapshotQuery 描述黑马爆品快照列表的筛选与排序条件。
type ViralSnapshotQuery struct {
	// SortBy 指定排序维度：score（综合黑马分）、delta（Δ想要暴涨量）、velocity（日均飙升速率）、seller_new（同行上新起量）。
	SortBy string
	// SourceType 可选按来源过滤（keyword / seller / 空串表示全部）。
	SourceType string
	// MinWantCount 是最低当前想要人数阈值。
	MinWantCount int
	// MinDeltaWant 是最低新增 Δ想要 阈值。
	MinDeltaWant int
	// MaxAgeHours 限制商品发布时长上限（小时，0 表示不限）。
	MaxAgeHours int
	// Limit 控制返回条数上限（默认 100，最大 200）。
	Limit int
}

// ViralRadarStore 提供爆品检测雷达监控目标与热度快照的跨方言持久化访问。
type ViralRadarStore struct {
	// DB 是共享数据库连接池。
	DB *sql.DB
	// Dialect 是当前数据库方言。
	Dialect Dialect
}

// ListTargets 查询指定用户的全部监控目标，按创建时间升序返回。
func (s *ViralRadarStore) ListTargets(ctx context.Context, userID int64) ([]ViralWatchTarget, error) {
	// rows、err 查询用户名下的全部监控项。
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id,user_id,target_type,target_value,label,publish_days,enabled,last_scanned_at,last_hit_count,created_at
		 FROM viral_watch_targets WHERE user_id = ? ORDER BY id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// out 收集扫描得到的监控目标切片。
	out := make([]ViralWatchTarget, 0)
	for rows.Next() {
		// item 保存当前行记录。
		var item ViralWatchTarget
		// enabledInt 转换整型布尔列。
		var enabledInt int
		// scanErr 读取单行字段。
		if scanErr := rows.Scan(
			&item.ID, &item.UserID, &item.TargetType, &item.TargetValue, &item.Label,
			&item.PublishDays, &enabledInt, &item.LastScannedAt, &item.LastHitCount, &item.CreatedAt,
		); scanErr != nil {
			return nil, scanErr
		}
		item.Enabled = enabledInt != 0
		out = append(out, item)
	}
	return out, rows.Err()
}

// UpsertTarget 创建或更新单条监控目标（按 user_id + target_type + target_value 幂等去重）。
func (s *ViralRadarStore) UpsertTarget(ctx context.Context, target ViralWatchTarget) (ViralWatchTarget, error) {
	// now 记录当前 Unix 秒时间戳。
	now := time.Now().Unix()
	if target.CreatedAt <= 0 {
		target.CreatedAt = now
	}
	// enabledInt 将布尔开关映射为 0/1。
	enabledInt := 0
	if target.Enabled {
		enabledInt = 1
	}
	// existingID 检查是否已存在相同目标。
	var existingID int64
	// queryErr 查询既有记录主键。
	queryErr := s.DB.QueryRowContext(ctx,
		`SELECT id FROM viral_watch_targets WHERE user_id = ? AND target_type = ? AND target_value = ?`,
		target.UserID, target.TargetType, target.TargetValue,
	).Scan(&existingID)
	if queryErr != nil && !errors.Is(queryErr, sql.ErrNoRows) {
		return ViralWatchTarget{}, queryErr
	}
	if existingID > 0 {
		// execErr 更新既有目标的标签、新发天数与启用状态。
		if _, execErr := s.DB.ExecContext(ctx,
			`UPDATE viral_watch_targets SET label = ?, publish_days = ?, enabled = ? WHERE id = ? AND user_id = ?`,
			target.Label, target.PublishDays, enabledInt, existingID, target.UserID,
		); execErr != nil {
			return ViralWatchTarget{}, execErr
		}
		target.ID = existingID
		return target, nil
	}
	// insertErr 插入新监控目标。
	if _, insertErr := s.DB.ExecContext(ctx,
		`INSERT INTO viral_watch_targets (user_id,target_type,target_value,label,publish_days,enabled,last_scanned_at,last_hit_count,created_at)
		 VALUES (?,?,?,?,?,?,0,0,?)`,
		target.UserID, target.TargetType, target.TargetValue, target.Label, target.PublishDays, enabledInt, target.CreatedAt,
	); insertErr != nil {
		return ViralWatchTarget{}, insertErr
	}
	// fetchErr 回读新建行的自增主键，兼容 SQLite/MySQL/PostgreSQL。
	if fetchErr := s.DB.QueryRowContext(ctx,
		`SELECT id FROM viral_watch_targets WHERE user_id = ? AND target_type = ? AND target_value = ?`,
		target.UserID, target.TargetType, target.TargetValue,
	).Scan(&target.ID); fetchErr != nil {
		return ViralWatchTarget{}, fetchErr
	}
	return target, nil
}

// ToggleTarget 切换单条监控目标的启用状态。
func (s *ViralRadarStore) ToggleTarget(ctx context.Context, userID, targetID int64, enabled bool) error {
	// enabledInt 转换布尔值为整型。
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	// res、err 更新目标启用列。
	res, err := s.DB.ExecContext(ctx,
		`UPDATE viral_watch_targets SET enabled = ? WHERE id = ? AND user_id = ?`,
		enabledInt, targetID, userID,
	)
	if err != nil {
		return err
	}
	// affected 检查是否命中用户自己的记录。
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteTarget 删除用户指定的单条监控目标。
func (s *ViralRadarStore) DeleteTarget(ctx context.Context, userID, targetID int64) error {
	// res、err 按用户与主键删除。
	res, err := s.DB.ExecContext(ctx, `DELETE FROM viral_watch_targets WHERE id = ? AND user_id = ?`, targetID, userID)
	if err != nil {
		return err
	}
	// affected 校验记录存在性。
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkTargetScanned 更新监控目标最近一次成功巡检的时间戳与命中商品条数。
func (s *ViralRadarStore) MarkTargetScanned(ctx context.Context, userID, targetID int64, scannedAt int64, hitCount int) error {
	// err 写回扫描统计。
	_, err := s.DB.ExecContext(ctx,
		`UPDATE viral_watch_targets SET last_scanned_at = ?, last_hit_count = ? WHERE id = ? AND user_id = ?`,
		scannedAt, hitCount, targetID, userID,
	)
	return err
}

// GetItemSnapshot 读取单个商品在当前用户下的既有快照（不存在时返回 ErrNotFound）。
func (s *ViralRadarStore) GetItemSnapshot(ctx context.Context, userID int64, itemID string) (ViralItemSnapshot, error) {
	// row 查询单条商品历史快照。
	row := s.DB.QueryRowContext(ctx,
		`SELECT id,user_id,item_id,title,price,original_price,pic_url,area,seller_id,seller_nick,is_free_shipping,
		        source_type,source_label,publish_time_unix,first_seen_at,first_want_count,prev_seen_at,prev_want_count,
		        latest_seen_at,latest_want_count,delta_want,daily_velocity_x100,viral_score,scan_count
		 FROM viral_item_snapshots WHERE user_id = ? AND item_id = ?`,
		userID, strings.TrimSpace(itemID),
	)
	// snap、err 扫描结果列。
	snap, err := scanViralSnapshot(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ViralItemSnapshot{}, ErrNotFound
	}
	return snap, err
}

// SaveItemSnapshot 插入或更新单件商品的热度快照记录。
func (s *ViralRadarStore) SaveItemSnapshot(ctx context.Context, snap ViralItemSnapshot) error {
	// freeShipInt 将布尔包邮标记转为整型。
	freeShipInt := 0
	if snap.IsFreeShipping {
		freeShipInt = 1
	}
	if snap.ID > 0 {
		// err 按已知主键更新快照。
		_, err := s.DB.ExecContext(ctx,
			`UPDATE viral_item_snapshots
			 SET title=?, price=?, original_price=?, pic_url=?, area=?, seller_id=?, seller_nick=?, is_free_shipping=?,
			     source_type=?, source_label=?, publish_time_unix=?, prev_seen_at=?, prev_want_count=?,
			     latest_seen_at=?, latest_want_count=?, delta_want=?, daily_velocity_x100=?, viral_score=?, scan_count=?
			 WHERE id=? AND user_id=?`,
			snap.Title, snap.Price, snap.OriginalPrice, snap.PicURL, snap.Area, snap.SellerID, snap.SellerNick, freeShipInt,
			snap.SourceType, snap.SourceLabel, snap.PublishTimeUnix, snap.PrevSeenAt, snap.PrevWantCount,
			snap.LatestSeenAt, snap.LatestWantCount, snap.DeltaWant, snap.DailyVelocityX100, snap.ViralScore, snap.ScanCount,
			snap.ID, snap.UserID,
		)
		return err
	}
	// err 插入首次发现的商品快照。
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO viral_item_snapshots (
		     user_id,item_id,title,price,original_price,pic_url,area,seller_id,seller_nick,is_free_shipping,
		     source_type,source_label,publish_time_unix,first_seen_at,first_want_count,prev_seen_at,prev_want_count,
		     latest_seen_at,latest_want_count,delta_want,daily_velocity_x100,viral_score,scan_count
		 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		snap.UserID, snap.ItemID, snap.Title, snap.Price, snap.OriginalPrice, snap.PicURL, snap.Area, snap.SellerID, snap.SellerNick, freeShipInt,
		snap.SourceType, snap.SourceLabel, snap.PublishTimeUnix, snap.FirstSeenAt, snap.FirstWantCount, snap.PrevSeenAt, snap.PrevWantCount,
		snap.LatestSeenAt, snap.LatestWantCount, snap.DeltaWant, snap.DailyVelocityX100, snap.ViralScore, snap.ScanCount,
	)
	return err
}

// ListSnapshots 按榜单排序与过滤条件返回用户的黑马爆品快照列表。
func (s *ViralRadarStore) ListSnapshots(ctx context.Context, userID int64, query ViralSnapshotQuery) ([]ViralItemSnapshot, error) {
	// limit 规范返回条数上限。
	limit := query.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	// clauses 与 args 动态组装安全的参数化过滤子句。
	clauses := []string{"user_id = ?"}
	// args 保存与占位符一一对应的查询参数。
	args := []any{userID}

	if query.SourceType == "keyword" || query.SourceType == "seller" {
		clauses = append(clauses, "source_type = ?")
		args = append(args, query.SourceType)
	} else if query.SortBy == "seller_new" {
		clauses = append(clauses, "source_type = 'seller'")
	}
	if query.MinWantCount > 0 {
		clauses = append(clauses, "latest_want_count >= ?")
		args = append(args, query.MinWantCount)
	}
	if query.MinDeltaWant > 0 {
		clauses = append(clauses, "delta_want >= ?")
		args = append(args, query.MinDeltaWant)
	}
	if query.MaxAgeHours > 0 {
		// minPubUnix 计算最早允许的发布时间戳（含估算时间戳）。
		minPubUnix := time.Now().Unix() - int64(query.MaxAgeHours)*3600
		clauses = append(clauses, "publish_time_unix >= ?")
		args = append(args, minPubUnix)
	}

	// orderClause 使用固定白名单排序表达式，杜绝 SQL 注入。
	orderClause := "viral_score DESC, delta_want DESC, daily_velocity_x100 DESC, latest_want_count DESC"
	switch query.SortBy {
	case "delta":
		orderClause = "delta_want DESC, daily_velocity_x100 DESC, latest_want_count DESC"
	case "velocity":
		orderClause = "daily_velocity_x100 DESC, latest_want_count DESC, viral_score DESC"
	case "seller_new":
		orderClause = "delta_want DESC, publish_time_unix DESC, latest_want_count DESC"
	}

	args = append(args, limit)
	// sqlText 拼接完整查询语句。
	sqlText := `SELECT id,user_id,item_id,title,price,original_price,pic_url,area,seller_id,seller_nick,is_free_shipping,
	                   source_type,source_label,publish_time_unix,first_seen_at,first_want_count,prev_seen_at,prev_want_count,
	                   latest_seen_at,latest_want_count,delta_want,daily_velocity_x100,viral_score,scan_count
	            FROM viral_item_snapshots WHERE ` + strings.Join(clauses, " AND ") + ` ORDER BY ` + orderClause + ` LIMIT ?`

	// rows、err 执行列表查询。
	rows, err := s.DB.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// out 收集查询结果切片。
	out := make([]ViralItemSnapshot, 0)
	for rows.Next() {
		// snap、scanErr 扫描单行快照。
		snap, scanErr := scanViralSnapshot(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, snap)
	}
	return out, rows.Err()
}

// ClearSnapshots 清空指定用户已积累的爆品快照记录。
func (s *ViralRadarStore) ClearSnapshots(ctx context.Context, userID int64) error {
	// err 删除该用户下全部快照。
	_, err := s.DB.ExecContext(ctx, `DELETE FROM viral_item_snapshots WHERE user_id = ?`, userID)
	return err
}

// scanViralSnapshot 将单行查询结果扫描为 ViralItemSnapshot 结构。
func scanViralSnapshot(scanner interface{ Scan(...any) error }) (ViralItemSnapshot, error) {
	// snap 保存扫描后的快照模型。
	var snap ViralItemSnapshot
	// freeShipInt 读取整型包邮列。
	var freeShipInt int
	// err 顺序扫描全部 24 列。
	err := scanner.Scan(
		&snap.ID, &snap.UserID, &snap.ItemID, &snap.Title, &snap.Price, &snap.OriginalPrice,
		&snap.PicURL, &snap.Area, &snap.SellerID, &snap.SellerNick, &freeShipInt,
		&snap.SourceType, &snap.SourceLabel, &snap.PublishTimeUnix,
		&snap.FirstSeenAt, &snap.FirstWantCount, &snap.PrevSeenAt, &snap.PrevWantCount,
		&snap.LatestSeenAt, &snap.LatestWantCount, &snap.DeltaWant,
		&snap.DailyVelocityX100, &snap.ViralScore, &snap.ScanCount,
	)
	snap.IsFreeShipping = freeShipInt != 0
	return snap, err
}
