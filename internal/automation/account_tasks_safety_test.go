package automation

import (
	"context"
	"errors"
	"testing"

	"xianyu-go/internal/db"
)

// TestAccountTaskSafetyRejectsOverlappingBatch 确认已有计划执行权时，手动与后台入口均不能启动额外任务。
func TestAccountTaskSafetyRejectsOverlappingBatch(t *testing.T) {
	// runner 无仓储和平台客户端；若越过闸门就无法正常完成测试。
	runner := &accountTaskCoordinator{}
	runner.batchActive.Store(true)
	// ctx 仅用于本地调度判断。
	ctx := context.Background()
	// err 保存执行权占用时人工任务入口的拒绝结果。
	if _, err := runner.runAccountTask(ctx, "another-account", TaskAutoRate); !errors.Is(err, errAccountTaskBusy) {
		t.Fatal("并行账号任务未被拒绝")
	}
	runner.scanAccountTasks(ctx)
	if !runner.batchActive.Load() {
		t.Fatal("拒绝的任务释放了其他任务的执行权")
	}
}

// TestAccountTaskSafetySharedAdmission 验证外部采集持有执行权时，账号任务被拒绝，释放后其他本地批次才可进入。
func TestAccountTaskSafetySharedAdmission(t *testing.T) {
	// center 是未连接平台的本地调度中心。
	center := &Center{}
	// release、acquired 模拟采集适配器获得执行权。
	release, acquired := center.TryAcquireBatchAdmission()
	if !acquired {
		t.Fatal("无法获得空闲执行权")
	}
	// err 验证采集持有执行权期间账号任务无法启动。
	if _, err := center.taskRunner.runAccountTask(context.Background(), "other", TaskAutoRate); !errors.Is(err, errAccountTaskBusy) {
		t.Fatal("跨模块重叠访问未被拒绝")
	}
	// second 是重复尝试取得共享执行权的结果。
	if _, second := center.TryAcquireBatchAdmission(); second {
		t.Fatal("重复取得执行权")
	}
	release()
	// nextRelease、nextAcquired 在前一持有者释放之后验证闸门重新可用。
	nextRelease, nextAcquired := center.TryAcquireBatchAdmission()
	if !nextAcquired {
		t.Fatal("释放后执行权未恢复")
	}
	nextRelease()
}

// TestAccountTaskSafetyStopsBeforeClaim 确认账号停用后不领取新的订单任务。
func TestAccountTaskSafetyStopsBeforeClaim(t *testing.T) {
	// repository 提供虚拟订单及已停用状态；claimErr 只在非法越过检查时才会返回。
	repository := &accountTaskFlowRepository{value: "unb=fixture", dueOrderIDs: []string{"test-order"}, safetyDisabled: true, claimErr: errors.New("unexpected claim")}
	// runner 使用既有测试客户端，无任何真实网络请求。
	runner := newAccountTaskFlowCoordinator(repository, &accountTaskFlowClient{})
	// summary、err 保存批次停止前的结果；不应领取或执行这笔订单。
	summary, err := runner.runAutoRate(context.Background(), db.AccountTaskSettings{CookieID: "test-account"})
	if err == nil || errors.Is(err, repository.claimErr) || summary.Success != 0 {
		t.Fatal("停用状态未阻止下一笔任务")
	}
}
