package adapter

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	collectorapp "xianyu-go/internal/application/collector"
	"xianyu-go/internal/db"
	"xianyu-go/internal/xianyu/cookierefresh"
	"xianyu-go/internal/xianyu/protocol"
)

// BrowserManualVerifyDriver 定义底层浏览器验证窗口驱动的最小接口，由 *browser.CollectorManualVerifier 实现。
type BrowserManualVerifyDriver interface {
	// OpenWindow 打开带现有登录态的可见闲鱼页面。
	OpenWindow(ctx context.Context, cookieID, cookieStr string, snapshot []cookierefresh.BrowserCookie, targetURL string) error
	// CompleteWindow 从可见窗口读取通过验证后的权威 Cookie Jar 并关闭窗口。
	CompleteWindow(cookieID string) (string, []cookierefresh.BrowserCookie, error)
	// CancelWindow 关闭打开中的验证窗口。
	CancelWindow(cookieID string)
}

// CollectorManualVerifyAdapter 将应用层一键弹窗手动过验证与自动同步 Cookie 连接到数据库与账号运行时。
type CollectorManualVerifyAdapter struct {
	// store 提供受互斥锁保护的账号 Cookie 与完整 Jar 快照读写能力。
	store *db.Store
	// driver 是可见 Chromium 窗口管理器。
	driver BrowserManualVerifyDriver
	// updateRunningCookie 在新凭证落库后通知在线账号实例热更新。
	updateRunningCookie func(context.Context, string, string)
}

// NewCollectorManualVerifyAdapter 构造一键弹窗人工验证适配器。
func NewCollectorManualVerifyAdapter(
	store *db.Store,
	driver BrowserManualVerifyDriver,
	updateRunningCookie func(context.Context, string, string),
) *CollectorManualVerifyAdapter {
	return &CollectorManualVerifyAdapter{
		store:               store,
		driver:              driver,
		updateRunningCookie: updateRunningCookie,
	}
}

// OpenVerifyWindow 读取账号当前 Cookie 快照并弹出可见闲鱼窗口供用户手动滑过验证。
func (a *CollectorManualVerifyAdapter) OpenVerifyWindow(ctx context.Context, cookieID, targetURL string) error {
	if a == nil || a.store == nil || a.store.Cookies == nil {
		return errors.New("账号凭证存储未初始化")
	}
	if a.driver == nil {
		return &collectorapp.ValidationError{Message: "当前服务端未启用本地 Chromium 浏览器，无法弹出可视化验证窗口"}
	}
	// normalizedID 是目标账号标识。
	normalizedID := strings.TrimSpace(cookieID)
	// unlock 短暂加锁读取当前凭证与 Cookie Jar 快照后立即释放。
	unlock := a.store.LockAccountCredentials(normalizedID)
	// runtimeData、loadErr 读取账号平台凭证。
	runtimeData, loadErr := a.store.Cookies.GetCookiePlatformRuntimeData(ctx, normalizedID)
	unlock()
	if errors.Is(loadErr, db.ErrNotFound) {
		return collectorapp.ErrAccountNotOwned
	}
	if loadErr != nil {
		return fmt.Errorf("读取账号当前 Cookie 失败: %w", loadErr)
	}
	if !hasStoredCredential(runtimeData) {
		return &collectorapp.ValidationError{Message: "该账号尚未保存有效登录态，请先在账号管理扫码登录"}
	}
	// snapshot 提取已有的完整 Cookie Jar 快照（若存在则优先完整注入）。
	snapshot := cookierefresh.SnapshotFromMetadata(runtimeData.MetadataJSON)
	return a.driver.OpenWindow(ctx, normalizedID, runtimeData.Value, snapshot, targetURL)
}

// CompleteVerifyWindow 从用户已滑完验证的窗口提取完整 Cookie Jar（含各接口路径下的 x5sec 票据），原子写回数据库并通知运行时。
func (a *CollectorManualVerifyAdapter) CompleteVerifyWindow(ctx context.Context, cookieID string) (int, error) {
	if a == nil || a.store == nil || a.store.Cookies == nil {
		return 0, errors.New("账号凭证存储未初始化")
	}
	if a.driver == nil {
		return 0, &collectorapp.ValidationError{Message: "当前服务端未启用本地 Chromium 浏览器"}
	}
	// normalizedID 是目标账号标识。
	normalizedID := strings.TrimSpace(cookieID)
	// canonicalVal、snapshot、completeErr 在无凭证锁状态下读取并关闭可见浏览器窗口。
	canonicalVal, snapshot, completeErr := a.driver.CompleteWindow(normalizedID)
	if completeErr != nil {
		return 0, &collectorapp.ValidationError{Message: completeErr.Error()}
	}
	// parsedMap 核对窗口中实际登录的闲鱼数字账号是否与所选账号一致，防止用户误登其他号覆盖凭证。
	parsedMap := protocol.TransCookies(canonicalVal)
	// unb 是验证窗口当前登录的闲鱼数字账号。
	if unb := strings.TrimSpace(parsedMap["unb"]); unb != "" && unb != normalizedID {
		return 0, &collectorapp.ValidationError{
			Message: fmt.Sprintf("验证窗口当前登录的账号（%s）与所选账号（%s）不一致，已拒绝覆盖", unb, normalizedID),
		}
	}

	// unlock 加锁写回权威 Cookie Jar 快照（保留 /h5/mtop.taobao.idlemtopsearch.pc.search 等路径下的 x5sec 票据）。
	unlock := a.store.LockAccountCredentials(normalizedID)
	// latest、loadErr 读取当前元数据以合并新快照。
	latest, loadErr := a.store.Cookies.GetCookiePlatformRuntimeData(ctx, normalizedID)
	if loadErr != nil {
		unlock()
		return 0, fmt.Errorf("读取账号记录失败: %w", loadErr)
	}
	// metadata 写入完整 Cookie Jar 快照。
	metadata := cookierefresh.MetadataWithSnapshot(latest.MetadataJSON, snapshot)
	// saveErr 保存新 Cookie 与完整 Jar 快照。
	saveErr := a.store.Cookies.UpdateRenewalCookie(ctx, normalizedID, canonicalVal, metadata, time.Now().Unix())
	unlock()
	if saveErr != nil {
		return 0, fmt.Errorf("保存同步后的 Cookie 失败: %w", saveErr)
	}
	if a.updateRunningCookie != nil {
		a.updateRunningCookie(ctx, normalizedID, canonicalVal)
	}
	return len(snapshot), nil
}

// CancelVerifyWindow 关闭指定账号尚未同步的可见验证窗口。
func (a *CollectorManualVerifyAdapter) CancelVerifyWindow(_ context.Context, cookieID string) error {
	if a != nil && a.driver != nil {
		a.driver.CancelWindow(cookieID)
	}
	return nil
}

// 编译期断言适配器满足应用层人工验证端口。
var _ collectorapp.ManualVerifyPort = (*CollectorManualVerifyAdapter)(nil)
