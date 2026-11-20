package collector

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"sync"
	"time"
)

// radarUserRun 保存单个用户最近或正在运行的爆品慢速巡检状态与取消句柄。
type radarUserRun struct {
	// status 是受 coordinator.mu 保护的最新状态副本。
	status RadarScanStatus
	// cancel 供用户手动停止或进程退出时取消当前巡检任务。
	cancel context.CancelFunc
}

// radarCoordinator 管理按用户串行、8~14 秒随机抖动限速的爆品巡检 worker 与可选低频自动调度。
type radarCoordinator struct {
	// mu 保护 rootCtx、closed、runs 与 clearing，不在持锁时执行网络或仓储操作。
	mu sync.Mutex
	// targetMu 串行化本进程监控项新增的总量校验和写入，仓储调用受请求上下文约束。
	targetMu sync.Mutex
	// scheduleMu 保护定时配置读改写和本地安全暂停标记；不能在持有 mu 时获取。
	scheduleMu sync.Mutex
	// scheduleSuspended 在暂停配置尚未成功落库时仍阻止本进程自动启动；仅显式保存计划才能清除。
	scheduleSuspended map[int64]bool
	// clearing 记录正在清理榜单的用户，防止清理期间启动新巡检。
	clearing map[int64]bool
	// rootCtx 是由生命周期协调器注入的进程根 Context。
	rootCtx context.Context
	// rootCancel 在进程退出时取消内部定时巡检循环。
	rootCancel context.CancelFunc
	// closed 标记服务是否正在关闭。
	closed bool
	// wg 等待全部后台巡检与定时循环安全退出。
	wg sync.WaitGroup
	// runs 按 userID 记录当前或最近一轮巡检任务状态。
	runs map[int64]*radarUserRun
	// stepDelay 返回相邻监控目标之间的防风控慢速间隔（生产默认 8~14 秒随机抖动）。
	stepDelay func() time.Duration
}

// newRadarCoordinator 构造带默认 8~14 秒随机抖动节流的爆品巡检协调器。
func newRadarCoordinator(customDelay func() time.Duration) *radarCoordinator {
	// delayFn 默认在 8000ms ~ 14000ms 之间生成随机抖动间隔。
	delayFn := customDelay
	if delayFn == nil {
		delayFn = defaultRadarJitterDelay
	}
	return &radarCoordinator{
		runs:              make(map[int64]*radarUserRun),
		scheduleSuspended: make(map[int64]bool),
		clearing:          make(map[int64]bool),
		stepDelay:         delayFn,
	}
}

// defaultRadarJitterDelay 生成 8~14 秒之间的均匀随机休眠时长，降低固定周期特征。
func defaultRadarJitterDelay() time.Duration {
	// extraMillis 在 [0, 6000] 毫秒内随机采样。
	extraMillis := int64(3000)
	// n、err 从加密随机源读取抖动毫秒数。
	if n, err := rand.Int(rand.Reader, big.NewInt(6001)); err == nil {
		extraMillis = n.Int64()
	}
	return 8*time.Second + time.Duration(extraMillis)*time.Millisecond
}

// StartRadar 由组合根生命周期协调器启动进程级根 Context 与低频定时检查协程。
func (s *Service) StartRadar(ctx context.Context) error {
	if s == nil || s.radar == nil {
		return nil
	}
	s.radar.mu.Lock()
	if s.radar.closed || s.radar.rootCtx != nil {
		s.radar.mu.Unlock()
		return nil
	}
	// childCtx、cancel 派生受协调器根 Context 管辖的子上下文。
	childCtx, cancel := context.WithCancel(ctx)
	s.radar.rootCtx = childCtx
	s.radar.rootCancel = cancel
	s.radar.wg.Add(1)
	s.radar.mu.Unlock()

	go s.runScheduledRadarLoop(childCtx)
	return nil
}

// CloseRadar 在进程关闭时取消全部正在执行的慢速巡检并等待 goroutine 干净退出。
func (s *Service) CloseRadar(ctx context.Context) error {
	if s == nil || s.radar == nil {
		return nil
	}
	s.radar.mu.Lock()
	s.radar.closed = true
	if s.radar.rootCancel != nil {
		s.radar.rootCancel()
	}
	// userRun 取消所有进行中的用户巡检任务。
	for _, userRun := range s.radar.runs {
		if userRun.cancel != nil {
			userRun.cancel()
		}
	}
	s.radar.mu.Unlock()

	// done 等待全部后台协程退出或受关闭超时约束返回。
	done := make(chan struct{})
	go func() {
		s.radar.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// StartRadarScan 手动触发当前用户的全池慢速爆品巡检（后台异步执行，同用户防并发重入）。
func (s *Service) StartRadarScan(ctx context.Context, userID int64, cookieID string) (RadarScanStatus, error) {
	if userID <= 0 {
		return RadarScanStatus{}, invalid("用户会话无效")
	}
	if s.radarRepo == nil || s.radar == nil {
		return RadarScanStatus{}, invalid("爆品巡检引擎未启用")
	}
	// normalizedCookie 是用户指定的采集账号。
	normalizedCookie := strings.TrimSpace(cookieID)
	if normalizedCookie == "" {
		return RadarScanStatus{}, invalid("请先在顶部选择一个已登录的闲鱼采集账号")
	}
	// ownErr 校验采集账号归属权限。
	if ownErr := s.requireOwnedAccount(ctx, userID, normalizedCookie); ownErr != nil {
		return RadarScanStatus{}, ownErr
	}
	// targets、err 读取所有已启用的监控目标。
	targets, err := s.enabledRadarTargets(ctx, userID)
	if err != nil {
		return RadarScanStatus{}, err
	}
	if len(targets) == 0 {
		return RadarScanStatus{}, invalid("监控池暂无已启用的词或同行，请先导入种子词包或添加监控目标")
	}
	// schedule、scheduleErr 读取当前定时配置，未知状态不能当成已关闭。
	schedule, scheduleErr := s.radarRepo.GetSchedule(ctx, userID)
	if scheduleErr != nil {
		return RadarScanStatus{}, invalid("无法读取定时计划，请核对本地数据库；本次未启动巡检")
	}
	return s.launchUserRadarScan(userID, normalizedCookie, targets, schedule)
}

// StopRadarScan 立即中断当前用户正在执行的爆品巡检任务，保留已写入的商品快照。
func (s *Service) StopRadarScan(ctx context.Context, userID int64) (RadarScanStatus, error) {
	if userID <= 0 {
		return RadarScanStatus{}, invalid("用户会话无效")
	}
	s.radar.mu.Lock()
	// run 查找当前用户的巡检状态。
	run := s.radar.runs[userID]
	if run != nil && run.cancel != nil {
		run.cancel()
	}
	s.radar.mu.Unlock()
	return s.GetRadarScanStatus(ctx, userID)
}

// GetRadarScanStatus 查询当前用户的实时巡检进度、最近风控提示及定时配置。
func (s *Service) GetRadarScanStatus(ctx context.Context, userID int64) (RadarScanStatus, error) {
	if userID <= 0 {
		return RadarScanStatus{}, invalid("用户会话无效")
	}
	// out 保存默认空状态。
	var out RadarScanStatus
	if s.radar != nil {
		s.radar.mu.Lock()
		// run 读取内存中的最近运行记录。
		if run := s.radar.runs[userID]; run != nil {
			out = run.status
		}
		s.radar.mu.Unlock()
	}
	if s.radarRepo != nil {
		// schedule、schedErr 合并数据库持久化的定时巡检设置。
		schedule, schedErr := s.radarRepo.GetSchedule(ctx, userID)
		if schedErr != nil {
			return out, invalid("无法确认定时计划状态，请检查本地数据库")
		}
		out.Schedule = schedule
		s.radar.scheduleMu.Lock()
		// suspended 表示计划登记失败时生效的进程内阻断，不能把持久化的启用字段当成正在自动运行。
		suspended := s.radar.scheduleSuspended[userID]
		s.radar.scheduleMu.Unlock()
		if suspended && schedule.Enabled && out.LastError == "" {
			out.LastError = "定时计划本地登记失败，当前进程禁止自动巡检，请人工核对并保存计划"
		}
	}
	return out, nil
}

// enabledRadarTargets 过滤出当前用户所有处于启用状态的监控目标。
func (s *Service) enabledRadarTargets(ctx context.Context, userID int64) ([]RadarWatchTarget, error) {
	// all、err 查询全部监控目标。
	all, err := s.radarRepo.ListTargets(ctx, userID)
	if err != nil {
		return nil, err
	}
	// active 保留 enabled=true 的目标。
	active := make([]RadarWatchTarget, 0, len(all))
	// item 遍历目标列表。
	for _, item := range all {
		if item.Enabled {
			active = append(active, item)
		}
	}
	return active, nil
}

// launchUserRadarScan 在进程生命周期 Context 下启动单用户异步巡检协程。
func (s *Service) launchUserRadarScan(userID int64, cookieID string, targets []RadarWatchTarget, schedule RadarScheduleConfig) (RadarScanStatus, error) {
	if len(targets) == 0 {
		return RadarScanStatus{}, invalid("没有启用的监控目标")
	}
	s.radar.mu.Lock()
	if s.radar.closed {
		s.radar.mu.Unlock()
		return RadarScanStatus{}, invalid("服务正在关闭，无法启动新巡检")
	}
	if s.radar.clearing[userID] {
		s.radar.mu.Unlock()
		return RadarScanStatus{}, invalid("榜单正在清理，请稍后启动巡检")
	}
	// existing 表示已有任务执行权，不再错误地登记新的自动运行时间。
	if existing := s.radar.runs[userID]; existing != nil && existing.status.Running {
		s.radar.mu.Unlock()
		return RadarScanStatus{}, invalid("巡检已在运行，请等待完成或先停止")
	}
	// parentCtx 使用进程根 Context（测试未调用 StartRadar 时回退到 Background）。
	parentCtx := s.radar.rootCtx
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	// runCtx、cancel 创建本轮可独立停止的上下文。
	runCtx, cancel := context.WithCancel(parentCtx)
	// initial 构造本轮初始进度。
	initial := RadarScanStatus{
		Running:       true,
		CookieID:      cookieID,
		TotalTargets:  len(targets),
		CurrentTarget: targets[0].Label,
		StartedAt:     time.Now().Unix(),
		Schedule:      schedule,
	}
	s.radar.runs[userID] = &radarUserRun{status: initial, cancel: cancel}
	s.radar.wg.Add(1)
	s.radar.mu.Unlock()

	go s.executeRadarScan(runCtx, userID, cookieID, targets)
	return initial, nil
}

// executeRadarScan 按顺序慢速扫描每个监控目标，计算 Δ想要 与日均增速并遇到风控立即熔断。
func (s *Service) executeRadarScan(ctx context.Context, userID int64, cookieID string, targets []RadarWatchTarget) {
	defer s.radar.wg.Done()
	// finish 统一在退出时收敛 Running=false 与结束时间。
	finish := func(aborted bool, errMsg string) {
		s.radar.mu.Lock()
		// run 更新当前用户运行记录。
		if run := s.radar.runs[userID]; run != nil {
			run.status.Running = false
			run.status.CurrentTarget = ""
			run.status.AbortedByRisk = aborted
			if errMsg != "" {
				run.status.LastError = errMsg
			}
			run.status.FinishedAt = time.Now().Unix()
			run.cancel = nil
		}
		s.radar.mu.Unlock()
	}

	// seen 记录本轮已成功保存的商品，跨目标重复命中不再次统计增量或覆盖来源。
	seen := make(map[string]struct{})
	// idx、target 顺序巡检每个监控项，相邻两项之间严格插入 8~14 秒随机休眠。
	for idx, target := range targets {
		if ctx.Err() != nil {
			finish(false, "已手动停止本轮爆品巡检")
			return
		}
		if idx > 0 {
			// timer 在目标之间执行可取消的慢速防风控抖动等待。
			timer := time.NewTimer(s.radar.stepDelay())
			select {
			case <-ctx.Done():
				timer.Stop()
				finish(false, "已手动停止本轮爆品巡检")
				return
			case <-timer.C:
			}
		}

		s.radar.mu.Lock()
		// run 更新当前扫描目标标题。
		if run := s.radar.runs[userID]; run != nil {
			run.status.CurrentTarget = target.Label
		}
		s.radar.mu.Unlock()

		// items、scanErr 单页精扫第 1 页前 30 条核心商品，绝不深翻页。
		items, scanErr := s.fetchSingleRadarTarget(ctx, cookieID, target)
		if scanErr != nil {
			if errors.Is(scanErr, ErrCollectorBusy) {
				// 本地执行权争用并非平台风险，本轮直接结束，不排队、不重试、不修改定时计划。
				finish(false, "本地其他任务正在运行，本轮巡检已停止；请人工核对任务状态")
				return
			}
			if s.platform.IsAbortError(scanErr) {
				// pauseCtx 在本轮取消后仍允许短暂写入本地安全状态，不执行任何平台操作。
				pauseCtx, cancelPause := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
				// pauseErr 保存定时计划关闭失败的原因；错误正文不进入界面。
				pauseErr := s.suspendRadarSchedule(pauseCtx, userID)
				cancelPause()
				if pauseErr != nil {
					finish(true, "采集已停止；定时计划关闭未能持久化，本次进程禁止自动重启。请立即人工核对并关闭计划，重启后仍需核对。")
					return
				}
				finish(true, "采集账号需要人工核对，已停止本轮并关闭定时计划。请通过官方渠道检查账号状态和授权；不要自动重试。")
				return
			}
			if ctx.Err() != nil {
				finish(false, "已手动停止本轮爆品巡检")
				return
			}
			// 非风控单条异常记录提示但继续扫描后续目标。
			s.radar.mu.Lock()
			// run 记录非熔断异常与完成进度。
			if run := s.radar.runs[userID]; run != nil {
				run.status.CompletedTargets = idx + 1
				run.status.LastError = scanErr.Error()
			}
			s.radar.mu.Unlock()
			continue
		}

		// nowUnix 统一本目标内全部商品的观测时间戳。
		nowUnix := time.Now().Unix()
		// updated 只统计真正落库成功的商品，失败数不计入成功进度。
		updated := 0
		// lastWriteError 保存本目标的最近一次数据库失败，结束时保留供用户排查。
		lastWriteError := ""
		// risingAdded 统计本目标内出现 Δ想要 > 0 或日均想要 >= 10 的黑马数。
		risingAdded := 0
		// item 逐件对比历史快照并更新数据库。
		for _, item := range items {
			if ctx.Err() != nil {
				break
			}
			if item.WantCount < 0 {
				lastWriteError = "部分商品未提供有效想要人数，未覆盖既有热度快照"
				continue
			}
			// exists 标记该商品已在本轮其他目标成功持久化。
			if _, exists := seen[item.ItemID]; exists {
				continue
			}
			// prevSnap、found、getErr 查询该商品是否已有历史记录。
			prevSnap, found, getErr := s.radarRepo.GetSnapshot(ctx, userID, item.ItemID)
			if getErr != nil {
				lastWriteError = "读取商品快照失败：" + getErr.Error()
				continue
			}
			// nextSnap 计算最新 Δ想要增量、日均飙升速率与黑马得分。
			nextSnap := buildUpdatedRadarSnapshot(nowUnix, target, item, prevSnap, found)
			// saveErr 写入更新后的商品热度快照。
			if saveErr := s.radarRepo.SaveSnapshot(ctx, userID, nextSnap); saveErr == nil {
				seen[item.ItemID] = struct{}{}
				updated++
				if nextSnap.DeltaWant > 0 || nextSnap.DailyVelocityX100 >= 1000 {
					risingAdded++
				}
			} else {
				lastWriteError = "保存商品快照失败：" + saveErr.Error()
			}
		}
		if ctx.Err() == nil && lastWriteError == "" {
			// markErr 表示本目标观测统计的数据库写入异常。
			if markErr := s.radarRepo.MarkTargetScanned(ctx, userID, target.ID, nowUnix, len(items)); markErr != nil {
				lastWriteError = "保存目标扫描统计失败：" + markErr.Error()
			}
		}

		s.radar.mu.Lock()
		// run 累加本目标完成数与异动商品数。
		if run := s.radar.runs[userID]; run != nil {
			run.status.CompletedTargets = idx + 1
			run.status.UpdatedItems += updated
			run.status.RisingItems += risingAdded
			if lastWriteError != "" {
				run.status.LastError = lastWriteError
			}
		}
		s.radar.mu.Unlock()
		if ctx.Err() != nil {
			finish(false, "已停止本轮爆品巡检")
			return
		}
	}
	finish(false, "")
}

// fetchSingleRadarTarget 根据目标类型执行单次平台请求（使用后台慢速节流标记）。
func (s *Service) fetchSingleRadarTarget(ctx context.Context, cookieID string, target RadarWatchTarget) ([]CollectedItem, error) {
	if target.TargetType == "seller" {
		// items、_、_、err 拉取对标同行第 1 页在售商品。
		items, _, _, err := s.platform.FetchSellerPage(ctx, cookieID, target.TargetValue, 1, 20, true)
		return items, err
	}
	// items、_、_、err 拉取赛道关键词第 1 页前 30 条商品。
	items, _, _, err := s.platform.SearchMarket(ctx, cookieID, PlatformSearchParams{
		Keyword:     target.TargetValue,
		PageNumber:  1,
		RowsPerPage: 30,
		PublishDays: target.PublishDays,
		Background:  true,
	})
	return items, err
}

// runScheduledRadarLoop 每 3 分钟低频检查一次是否有用户到达了设定的 6/12/24 小时自动巡检周期。
func (s *Service) runScheduledRadarLoop(ctx context.Context) {
	defer s.radar.wg.Done()
	// ticker 每 3 分钟唤醒检查一次定时计划。
	ticker := time.NewTicker(3 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.triggerDueScheduledScans(ctx)
		}
	}
}

// triggerDueScheduledScans 为已到期且当前空闲的用户触发一轮后台慢速巡检。
func (s *Service) triggerDueScheduledScans(ctx context.Context) {
	if s.radarRepo == nil {
		return
	}
	// scheduledUsers、err 查询所有开启了定时巡检的用户。
	scheduledUsers, err := s.radarRepo.ListScheduledUsers(ctx)
	if err != nil {
		return
	}
	// nowUnix 记录当前秒时间戳。
	nowUnix := time.Now().Unix()
	// entry 逐个检查是否已达设定的间隔小时数。
	for _, entry := range scheduledUsers {
		if ctx.Err() != nil {
			return
		}
		// cfg 是该用户的定时配置。
		cfg := entry.Config
		if !cfg.Enabled || cfg.CookieID == "" || cfg.IntervalHours <= 0 {
			continue
		}
		if nowUnix-cfg.LastAutoRunUnix < int64(cfg.IntervalHours)*3600 {
			continue
		}
		// owned、ownErr 复核账号仍归属该用户。
		owned, ownErr := s.platform.OwnsAccount(ctx, entry.UserID, cfg.CookieID)
		if ownErr != nil || !owned {
			continue
		}
		// targets、tErr 读取启用中的目标。
		targets, tErr := s.enabledRadarTargets(ctx, entry.UserID)
		if tErr != nil || len(targets) == 0 {
			continue
		}
		s.radar.scheduleMu.Lock()
		if s.radar.scheduleSuspended[entry.UserID] {
			s.radar.scheduleMu.Unlock()
			continue
		}
		// latest、readErr 在获得定时配置写锁后重新读取，避免覆盖刚关闭或改动的计划。
		latest, readErr := s.radarRepo.GetSchedule(ctx, entry.UserID)
		if readErr != nil || !latest.Enabled || latest.CookieID != cfg.CookieID || latest.IntervalHours != cfg.IntervalHours ||
			nowUnix-latest.LastAutoRunUnix < int64(latest.IntervalHours)*3600 {
			s.radar.scheduleMu.Unlock()
			continue
		}
		// 先持久化本轮调度占用时间，再启动 worker；存储失败绝不启动平台请求。
		latest.LastAutoRunUnix = nowUnix
		// saveErr 表示本轮登记失败；本进程禁止再自动尝试，需人工核对并保存计划。
		if saveErr := s.radarRepo.SaveSchedule(ctx, entry.UserID, latest); saveErr != nil {
			s.radar.scheduleSuspended[entry.UserID] = true
			s.radar.scheduleMu.Unlock()
			continue
		}
		// 若执行权已被其他任务占用，保守跳过本周期，不补发请求。
		_, _ = s.launchUserRadarScan(entry.UserID, latest.CookieID, targets, latest)
		s.radar.scheduleMu.Unlock()
	}
}
