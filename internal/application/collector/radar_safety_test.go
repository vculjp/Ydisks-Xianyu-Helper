package collector

import (
	"context"
	"errors"
	"testing"
)

// safetyScheduleRepo 仅实现安全暂停与调度验证所需端口；未实现的调用使测试直接失败。
type safetyScheduleRepo struct {
	// RadarRepositoryPort 嵌入未使用的仓储方法，避免伪造其他业务行为。
	RadarRepositoryPort
	// cfg 模拟已经持久化的定时计划。
	cfg RadarScheduleConfig
	// writeErr 模拟本地数据库写入故障。
	writeErr error
	// readErr 模拟读取持久化计划失败。
	readErr error
	// writes 记录成功或失败的计划写入尝试次数。
	writes int
}

// GetSchedule 返回仓储中的计划快照，不共享可变指针。
func (r *safetyScheduleRepo) GetSchedule(context.Context, int64) (RadarScheduleConfig, error) {
	return r.cfg, r.readErr
}

// TestRadarSafetyBusyStopsWithoutRisk 验证本地执行权争用不会误判平台风险或覆盖已有计划。
func TestRadarSafetyBusyStopsWithoutRisk(t *testing.T) {
	// repo 保存已经启用的计划。
	repo := &safetyScheduleRepo{cfg: RadarScheduleConfig{Enabled: true, CookieID: "a", IntervalHours: 12}}
	// platform 仅模拟本地繁忙拒绝，不发送任何平台请求。
	platform := &fakePlatform{owned: true, sellerErrByPage: map[int]error{1: ErrCollectorBusy}, abortErr: ErrCollectorBusy}
	// svc 是隔离的本地协调器。
	svc := &Service{platform: platform, radarRepo: repo, radar: newRadarCoordinator(nil)}
	svc.radar.runs[1] = &radarUserRun{status: RadarScanStatus{Running: true}}
	svc.radar.wg.Add(1)
	svc.executeRadarScan(context.Background(), 1, "a", []RadarWatchTarget{{TargetType: "seller", TargetValue: "12345"}})
	if !repo.cfg.Enabled || svc.radar.runs[1].status.AbortedByRisk || svc.radar.runs[1].status.Running || repo.writes != 0 {
		t.Fatal("本地繁忙被错误标记为风险或修改计划")
	}
}

// TestRadarSafetyScheduleReadFailure 验证计划状态未知时拒绝启动并明确报告查询失败。
func TestRadarSafetyScheduleReadFailure(t *testing.T) {
	// repo 模拟本地数据库配置读取异常。
	repo := &safetyScheduleRepo{readErr: errors.New("fixture unavailable")}
	// svc 不持有真实平台客户端。
	svc := &Service{platform: &fakePlatform{owned: true}, radarRepo: repo, radar: newRadarCoordinator(nil)}
	// err 表示巡检启动应被拒绝。
	if _, err := svc.StartRadarScan(context.Background(), 1, "a"); err == nil || len(svc.radar.runs) != 0 {
		t.Fatal("计划未知时开启了巡检")
	}
	// err 表示状态查询不能静默返回已关闭。
	if _, err := svc.GetRadarScanStatus(context.Background(), 1); err == nil {
		t.Fatal("读取计划失败未报告")
	}
}

// TestRadarSafetyScheduleReservationFailure 在登记失败时禁止启动任何 worker，并阻止进程内再次自动尝试。
func TestRadarSafetyScheduleReservationFailure(t *testing.T) {
	// repo 模拟启用的到期计划，但本地写入失败。
	repo := &safetyScheduleRepo{cfg: RadarScheduleConfig{Enabled: true, CookieID: "a", IntervalHours: 12}, writeErr: errors.New("fixture write failed")}
	// svc 仅由本地替身构成，不持有真实平台连接。
	svc := &Service{platform: &fakePlatform{owned: true}, radarRepo: repo, radar: newRadarCoordinator(nil)}
	svc.triggerDueScheduledScans(context.Background())
	svc.triggerDueScheduledScans(context.Background())
	if len(svc.radar.runs) != 0 || repo.writes != 1 || !svc.radar.scheduleSuspended[1] {
		t.Fatal("登记失败仍允许巡检或重复自动尝试")
	}
}

// SaveSchedule 模拟持久化成功或明确的数据库故障。
func (r *safetyScheduleRepo) SaveSchedule(_ context.Context, _ int64, cfg RadarScheduleConfig) error {
	r.writes++
	if r.writeErr != nil {
		return r.writeErr
	}
	r.cfg = cfg
	return nil
}

// ListScheduledUsers 模拟开启的计划仍可能被后台调度器枚举。
func (r *safetyScheduleRepo) ListScheduledUsers(context.Context) ([]ScheduledRadarUser, error) {
	if !r.cfg.Enabled {
		return nil, nil
	}
	return []ScheduledRadarUser{{UserID: 1, Config: r.cfg}}, nil
}

// ListTargets 提供一个候选监控目标，验证暂停时不会启动 worker。
func (r *safetyScheduleRepo) ListTargets(context.Context, int64) ([]RadarWatchTarget, error) {
	return []RadarWatchTarget{{Enabled: true, TargetType: "seller", TargetValue: "123"}}, nil
}

// TestRadarSafetyAbortPersistsDisabledSchedule 验证平台拒绝后结束本轮、关闭并持久化计划。
func TestRadarSafetyAbortPersistsDisabledSchedule(t *testing.T) {
	// ctx 是本地测试的独立上下文，不访问平台。
	ctx := context.Background()
	// risk 是假平台返回的需要人工处理的错误。
	risk := errors.New("verification required")
	// repo 保存此前已开启的计划，历史时间不得被清除。
	repo := &safetyScheduleRepo{cfg: RadarScheduleConfig{Enabled: true, CookieID: "a", IntervalHours: 12, LastAutoRunUnix: 123}}
	// platform 只提供模拟拒绝结果，不触发真实网络请求。
	platform := &fakePlatform{owned: true, sellerErrByPage: map[int]error{1: risk}, abortErr: risk}
	// svc 使用模拟仓储、平台与新的本地调度器。
	svc := &Service{platform: platform, radarRepo: repo, radar: newRadarCoordinator(nil)}
	svc.radar.runs[1] = &radarUserRun{status: RadarScanStatus{Running: true}}
	svc.radar.wg.Add(1)
	svc.executeRadarScan(ctx, 1, "a", []RadarWatchTarget{{TargetType: "seller", TargetValue: "123"}})
	// status、err 重新读取任务状态和已经落库的计划。
	status, err := svc.GetRadarScanStatus(ctx, 1)
	if err != nil || status.Running || !status.AbortedByRisk || status.Schedule.Enabled || repo.cfg.LastAutoRunUnix != 123 || repo.writes != 1 {
		t.Fatal("异常后定时计划未正确停止或历史状态被覆盖")
	}
	// restarted 模拟新的进程读取同一仓储，未显式开启时不触发巡检。
	restarted := &Service{platform: platform, radarRepo: repo, radar: newRadarCoordinator(nil)}
	restarted.triggerDueScheduledScans(ctx)
	if len(restarted.radar.runs) != 0 {
		t.Fatal("已关闭计划在重启后被自动触发")
	}
}

// TestRadarSafetyPersistenceFailureBlocksScheduler 验证数据库失败时本地调度仍拒绝重启。
func TestRadarSafetyPersistenceFailureBlocksScheduler(t *testing.T) {
	// ctx 用于同步本地调度测试。
	ctx := context.Background()
	// repo 模拟原计划还处于启用状态且暂停写入失败。
	repo := &safetyScheduleRepo{cfg: RadarScheduleConfig{Enabled: true, CookieID: "a", IntervalHours: 12}, writeErr: errors.New("db unavailable")}
	// svc 持有有效账号和本地安全暂停标记。
	svc := &Service{platform: &fakePlatform{owned: true}, radarRepo: repo, radar: newRadarCoordinator(nil)}
	if svc.suspendRadarSchedule(ctx, 1) == nil {
		t.Fatal("暂停写入失败未返回错误")
	}
	svc.triggerDueScheduledScans(ctx)
	if len(svc.radar.runs) != 0 || !svc.radar.scheduleSuspended[1] {
		t.Fatal("数据库故障时仍允许自动启动")
	}
	// 修复存储后只接受用户显式关闭计划，不自动恢复原启用状态。
	repo.writeErr = nil
	// err 保存恢复数据库后人工关闭计划的写入结果。
	if _, err := svc.UpdateRadarSchedule(ctx, 1, RadarScheduleConfig{Enabled: false, CookieID: "a", IntervalHours: 12}); err != nil {
		t.Fatal("显式关闭计划失败")
	}
	if repo.cfg.Enabled || svc.radar.scheduleSuspended[1] {
		t.Fatal("持久化关闭后本地故障标记未收口")
	}
}
