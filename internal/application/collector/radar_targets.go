package collector

import (
	"context"
	"strings"
	"unicode/utf8"
)

// ListRadarTargets 返回当前用户的全部赛道词与同行监控目标。
func (s *Service) ListRadarTargets(ctx context.Context, userID int64) ([]RadarWatchTarget, error) {
	if userID <= 0 {
		return nil, invalid("用户会话无效")
	}
	if s.radarRepo == nil {
		return []RadarWatchTarget{}, nil
	}
	return s.radarRepo.ListTargets(ctx, userID)
}

// AddRadarTargets 批量校验并添加监控目标（支持一键导入虚拟资料种子词包）。
func (s *Service) AddRadarTargets(ctx context.Context, userID int64, inputs []RadarTargetInput, importVirtualSeedPack bool) ([]RadarWatchTarget, error) {
	if userID <= 0 {
		return nil, invalid("用户会话无效")
	}
	if s.radarRepo == nil {
		return nil, invalid("爆品监控仓储未启用")
	}
	// combined 汇总显式输入与可选内置种子词包。
	combined := make([]RadarTargetInput, 0, len(inputs)+8)
	if importVirtualSeedPack {
		combined = append(combined, DefaultVirtualGoodsSeedKeywords()...)
	}
	combined = append(combined, inputs...)
	if len(combined) == 0 {
		return nil, invalid("请提供至少一条需要添加的关键词或同行主页链接")
	}
	if len(combined) > 30 {
		return nil, invalid("单次最多添加 30 条监控目标")
	}
	// 同一服务内串行校验和写入监控目标，防止并发添加突破总量上限。
	s.radar.targetMu.Lock()
	defer s.radar.targetMu.Unlock()

	// existingList、listErr 检查当前用户累计目标上限（最多 50 条以保障慢速巡检节奏）。
	existingList, listErr := s.radarRepo.ListTargets(ctx, userID)
	if listErr != nil {
		return nil, listErr
	}
	// keys 汇总现有与本次新增的唯一监控目标，重复更新不消耗新名额。
	keys := make(map[string]struct{}, len(existingList)+len(combined))
	// target 是数据库已保存的监控项。
	for _, target := range existingList {
		keys[target.TargetType+"\x00"+target.TargetValue] = struct{}{}
	}
	// normalizedTargets 保存全部通过校验的输入；有非法项时在任何写入之前终止。
	normalizedTargets := make([]RadarWatchTarget, 0, len(combined))
	// raw 是当前待校验的用户输入。
	for _, raw := range combined {
		// normalized、normErr 校验并转换单条监控项。
		normalized, normErr := normalizeRadarTargetInput(raw)
		if normErr != nil {
			return nil, normErr
		}
		keys[normalized.TargetType+"\x00"+normalized.TargetValue] = struct{}{}
		normalizedTargets = append(normalizedTargets, normalized)
	}
	if len(keys) > 50 {
		return nil, invalid("监控池最多保存 50 条目标，请先清理不再关注的词或同行")
	}
	// saved 收集写入成功的目标记录。
	saved := make([]RadarWatchTarget, 0, len(normalizedTargets))
	// normalized 是经整批校验后待幂等写入的目标。
	for _, normalized := range normalizedTargets {
		// upserted、upsertErr 写入数据库。
		upserted, upsertErr := s.radarRepo.UpsertTarget(ctx, userID, normalized)
		if upsertErr != nil {
			return nil, upsertErr
		}
		saved = append(saved, upserted)
	}
	return saved, nil
}

// ToggleRadarTarget 启用或暂停单条监控目标。
func (s *Service) ToggleRadarTarget(ctx context.Context, userID, targetID int64, enabled bool) error {
	if userID <= 0 || targetID <= 0 {
		return invalid("监控目标参数无效")
	}
	if s.radarRepo == nil {
		return invalid("爆品监控仓储未启用")
	}
	return s.radarRepo.ToggleTarget(ctx, userID, targetID, enabled)
}

// DeleteRadarTarget 删除单条监控目标。
func (s *Service) DeleteRadarTarget(ctx context.Context, userID, targetID int64) error {
	if userID <= 0 || targetID <= 0 {
		return invalid("监控目标参数无效")
	}
	if s.radarRepo == nil {
		return invalid("爆品监控仓储未启用")
	}
	return s.radarRepo.DeleteTarget(ctx, userID, targetID)
}

// SuggestRadarKeywords 调用系统配置的 AI 大模型结合当前月份与用户赛道推荐潜爆搜索热词。
func (s *Service) SuggestRadarKeywords(ctx context.Context, userID int64, niche string) ([]string, error) {
	if userID <= 0 {
		return nil, invalid("用户会话无效")
	}
	if s.keywordGenerator == nil {
		return nil, ErrAIUnavailable
	}
	// cleanNiche 清理赛道描述文本，留空默认聚焦虚拟电子资料。
	cleanNiche := strings.TrimSpace(niche)
	if cleanNiche == "" {
		cleanNiche = "虚拟资源、电子学习资料、职场办公模板与效率工具"
	}
	if utf8.RuneCountInString(cleanNiche) > 120 {
		cleanNiche = string([]rune(cleanNiche)[:120])
	}
	return s.keywordGenerator.SuggestKeywords(ctx, userID, cleanNiche, 8)
}

// ListRadarItems 按黑马得分、Δ想要暴涨量、新发飙升速率或同行上新筛选商品榜单。
func (s *Service) ListRadarItems(ctx context.Context, userID int64, query RadarListQuery) ([]RadarItemSnapshot, error) {
	if userID <= 0 {
		return nil, invalid("用户会话无效")
	}
	if s.radarRepo == nil {
		return []RadarItemSnapshot{}, nil
	}
	// list、err 从仓储读取快照行。
	list, err := s.radarRepo.ListSnapshots(ctx, userID, query)
	if err != nil {
		return nil, err
	}
	// idx 为每条记录补齐浮点日均增速与标准闲鱼网页链接。
	for idx := range list {
		list[idx].DailyVelocity = float64(list[idx].DailyVelocityX100) / 100.0
		if list[idx].WebURL == "" {
			list[idx].WebURL = "https://www.goofish.com/item?id=" + list[idx].ItemID
		}
	}
	return list, nil
}

// ClearRadarItems 清空当前用户的历史爆品快照数据。
func (s *Service) ClearRadarItems(ctx context.Context, userID int64) error {
	if userID <= 0 {
		return invalid("用户会话无效")
	}
	if s.radarRepo == nil {
		return nil
	}
	s.radar.mu.Lock()
	// run 是用户当前巡检状态，运行期间不得清理快照。
	run := s.radar.runs[userID]
	if s.radar.clearing[userID] || (run != nil && run.status.Running) {
		s.radar.mu.Unlock()
		return invalid("请先停止当前巡检并等待任务结束，再清空榜单")
	}
	s.radar.clearing[userID] = true
	s.radar.mu.Unlock()
	// 清理完成或失败均释放启动阻塞标记，不在锁内执行数据库删除。
	defer func() {
		s.radar.mu.Lock()
		delete(s.radar.clearing, userID)
		s.radar.mu.Unlock()
	}()
	return s.radarRepo.ClearSnapshots(ctx, userID)
}

// UpdateRadarSchedule 更新用户的低频后台定时巡检开关、采集账号与间隔小时数。
func (s *Service) UpdateRadarSchedule(ctx context.Context, userID int64, cfg RadarScheduleConfig) (RadarScheduleConfig, error) {
	if userID <= 0 {
		return RadarScheduleConfig{}, invalid("用户会话无效")
	}
	if s.radarRepo == nil {
		return RadarScheduleConfig{}, invalid("爆品监控仓储未启用")
	}
	// normalized 规范化定时配置。
	normalized := RadarScheduleConfig{
		Enabled:       cfg.Enabled,
		CookieID:      strings.TrimSpace(cfg.CookieID),
		IntervalHours: cfg.IntervalHours,
	}
	if normalized.IntervalHours != 6 && normalized.IntervalHours != 12 && normalized.IntervalHours != 24 {
		normalized.IntervalHours = 12
	}
	if normalized.Enabled {
		if normalized.CookieID == "" {
			return RadarScheduleConfig{}, invalid("开启后台自动巡检前请先选择执行采集的闲鱼账号")
		}
		// ownErr 校验定时巡检绑定的账号归属权限。
		if ownErr := s.requireOwnedAccount(ctx, userID, normalized.CookieID); ownErr != nil {
			return RadarScheduleConfig{}, ownErr
		}
	}
	s.radar.scheduleMu.Lock()
	defer s.radar.scheduleMu.Unlock()
	if normalized.Enabled && s.radar.scheduleSuspended[userID] {
		s.radar.mu.Lock()
		// run 是仍在收束的巡检；锁顺序固定为 scheduleMu 后 mu。
		run := s.radar.runs[userID]
		// running 表示风险停止流程尚未彻底收束，拒绝再次启用计划。
		running := run != nil && run.status.Running
		s.radar.mu.Unlock()
		if running {
			return RadarScheduleConfig{}, invalid("请等待巡检停止并人工核对账号后再配置计划")
		}
	}
	// prev、readErr 读取此前自动运行时间，读取失败时不覆盖已有配置。
	prev, readErr := s.radarRepo.GetSchedule(ctx, userID)
	if readErr != nil {
		return RadarScheduleConfig{}, readErr
	}
	normalized.LastAutoRunUnix = prev.LastAutoRunUnix
	// saveErr 保存用户定时巡检设置。
	if saveErr := s.radarRepo.SaveSchedule(ctx, userID, normalized); saveErr != nil {
		return RadarScheduleConfig{}, saveErr
	}
	// 只有用户显式保存成功才清除本地阻断；不因时间流逝或凭证变化自动恢复。
	delete(s.radar.scheduleSuspended, userID)
	return normalized, nil
}

// suspendRadarSchedule 关闭该用户的定时巡检计划，保留绑定账号、周期和运行时间。
// 写入失败时本进程仍阻止下一轮自动调度；不承诺数据库不可用时能跨重启持久化。
func (s *Service) suspendRadarSchedule(ctx context.Context, userID int64) error {
	s.radar.scheduleMu.Lock()
	defer s.radar.scheduleMu.Unlock()
	s.radar.scheduleSuspended[userID] = true
	// cfg、readErr 读取持久化计划，禁止使用旧快照覆盖用户设置。
	cfg, readErr := s.radarRepo.GetSchedule(ctx, userID)
	if readErr != nil {
		return readErr
	}
	if !cfg.Enabled {
		return nil
	}
	cfg.Enabled = false
	return s.radarRepo.SaveSchedule(ctx, userID, cfg)
}

// normalizeRadarTargetInput 校验并规范化单条监控目标输入。
func normalizeRadarTargetInput(input RadarTargetInput) (RadarWatchTarget, error) {
	// targetType 规范目标类别。
	targetType := strings.ToLower(strings.TrimSpace(input.TargetType))
	if targetType == "" {
		targetType = "keyword"
	}
	// label 是清理空白后的可选备注。
	label := strings.TrimSpace(input.Label)
	switch targetType {
	case "keyword":
		// kw 是去空白后的搜索关键词。
		kw := strings.TrimSpace(input.RawValue)
		if kw == "" || utf8.RuneCountInString(kw) > 50 {
			return RadarWatchTarget{}, invalid("请输入 1–50 个字符的监控关键词")
		}
		// pubDays 限制为合法新发窗口（0/1/3/7/14）。
		pubDays := input.PublishDays
		switch pubDays {
		case 0, 1, 3, 7, 14:
		default:
			pubDays = 3
		}
		if label == "" {
			label = kw
		}
		return RadarWatchTarget{
			TargetType:  "keyword",
			TargetValue: kw,
			Label:       truncateRunes(label, 60),
			PublishDays: pubDays,
			Enabled:     true,
		}, nil
	case "seller":
		// sellerID、err 从主页链接或纯数字文本提取卖家 userId。
		sellerID, err := ExtractSellerID(input.RawValue)
		if err != nil {
			return RadarWatchTarget{}, err
		}
		if label == "" {
			label = "同行店铺 " + sellerID
		}
		return RadarWatchTarget{
			TargetType:  "seller",
			TargetValue: sellerID,
			Label:       truncateRunes(label, 60),
			PublishDays: 0,
			Enabled:     true,
		}, nil
	default:
		return RadarWatchTarget{}, invalid("不支持的监控目标类型")
	}
}
