package browser

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mxschmitt/playwright-go"

	"xianyu-go/internal/xianyu/cookierefresh"
)

// manualVerifySessionTTL 限制人工过验证弹窗的最大存活时长，超时后下次打开或关闭时自动回收。
const manualVerifySessionTTL = 15 * time.Minute

// manualVerifySession 保存单个账号正在桌面显示的 Chromium 验证窗口上下文及释放钩子。
type manualVerifySession struct {
	// cookieID 是当前窗口所属的闲鱼账号标识。
	cookieID string
	// context 是可见的持久化 Chromium 浏览器上下文。
	context playwright.BrowserContext
	// openedAt 记录窗口打开时刻以便回收遗忘窗口。
	openedAt time.Time
	// releaseOnce 保证底层浏览器关闭与生命周期计数扣减幂等只执行一次。
	releaseOnce sync.Once
	// finishOperation 在关闭浏览器后释放 Manager 活动操作计数。
	finishOperation func()
}

// close 幂等关闭可见 Chromium 窗口并归还浏览器管理器生命周期计数。
func (s *manualVerifySession) close() {
	if s == nil {
		return
	}
	s.releaseOnce.Do(func() {
		if s.context != nil {
			_ = s.context.Close()
		}
		if s.finishOperation != nil {
			s.finishOperation()
		}
	})
}

// CollectorManualVerifier 管理仅供用户本人在可见窗口手动完成闲鱼官方安全验证的浏览器会话。
// 它绝不执行任何自动点击、滑块拖动或验证码绕过，只负责载入登录态打开网页并在用户确认完成后同步最新 Cookie Jar。
type CollectorManualVerifier struct {
	// manager 是底层共享的 Playwright 生命周期拥有者；无浏览器模式下为 nil。
	manager *Manager
	// mu 保护 closed 与 sessions 映射。
	mu sync.Mutex
	// closed 表示服务正在退出，不再接受打开新验证窗口。
	closed bool
	// sessions 按账号 ID 记录当前打开中的可见验证窗口（每账号至多 1 个）。
	sessions map[string]*manualVerifySession
}

// NewCollectorManualVerifier 构造人工可见验证窗口管理器；manager 为 nil 时所有调用安全返回不可用提示。
func NewCollectorManualVerifier(manager *Manager) *CollectorManualVerifier {
	return &CollectorManualVerifier{
		manager:  manager,
		sessions: make(map[string]*manualVerifySession),
	}
}

// Start 满足生命周期组件启动签名，无需启动任何后台轮询 goroutine。
func (v *CollectorManualVerifier) Start(_ context.Context) error {
	return nil
}

// CloseContext 在进程退出时逆序先于 browser.Manager 关闭全部未关闭的验证窗口并归还生命周期计数。
func (v *CollectorManualVerifier) CloseContext(_ context.Context) error {
	if v == nil {
		return nil
	}
	v.mu.Lock()
	v.closed = true
	// pending 复制待关闭会话以便在锁外执行浏览器进程关闭。
	pending := make([]*manualVerifySession, 0, len(v.sessions))
	// key、sess 遍历并清空当前活跃会话表。
	for key, sess := range v.sessions {
		pending = append(pending, sess)
		delete(v.sessions, key)
	}
	v.mu.Unlock()

	// sess 逐个关闭可见浏览器窗口。
	for _, sess := range pending {
		sess.close()
	}
	return nil
}

// OpenWindow 启动一个可见的桌面 Chromium 窗口，注入账号当前 Cookie 并导航到指定的闲鱼页面供用户手动完成官方验证。
func (v *CollectorManualVerifier) OpenWindow(
	ctx context.Context,
	cookieID string,
	cookieStr string,
	snapshot []cookierefresh.BrowserCookie,
	targetURL string,
) error {
	if v == nil || v.manager == nil {
		return errors.New("当前运行环境禁用了本地 Chromium 浏览器（-no-browser），无法弹出可视化验证窗口")
	}
	// normalizedID 是去空白后的账号标识。
	normalizedID := strings.TrimSpace(cookieID)
	if normalizedID == "" {
		return errors.New("账号标识不能为空")
	}
	// safeURL、urlErr 校验只允许打开闲鱼官方 https://www.goofish.com 域名。
	safeURL, urlErr := validateGoofishVerifyURL(targetURL)
	if urlErr != nil {
		return urlErr
	}

	// stale 收集同账号旧窗口或已超时遗忘窗口，在锁外先行关闭。
	var stale []*manualVerifySession
	v.mu.Lock()
	if v.closed {
		v.mu.Unlock()
		return errors.New("服务正在关闭，无法打开验证窗口")
	}
	// now 记录当前时间用于判断 15 分钟超时会话。
	now := time.Now()
	// id、existing 检查并摘除同账号已有窗口或超时窗口。
	for id, existing := range v.sessions {
		if id == normalizedID || now.Sub(existing.openedAt) > manualVerifySessionTTL {
			stale = append(stale, existing)
			delete(v.sessions, id)
		}
	}
	v.mu.Unlock()
	// oldSess 释放旧窗口，防止同一 profile 目录文件锁冲突。
	for _, oldSess := range stale {
		oldSess.close()
	}

	// err 登记底层 Manager 活动操作计数。
	if err := v.manager.beginOperation(ctx); err != nil {
		return err
	}
	// opOnce 确保异常回滚与正常关闭只扣减一次操作计数。
	var opOnce sync.Once
	// finishOp 归还 Manager 活动操作计数。
	finishOp := func() {
		opOnce.Do(v.manager.endOperation)
	}
	// err 初始化底层 Playwright 运行时。
	if err := v.manager.init(); err != nil {
		finishOp()
		return fmt.Errorf("初始化本地 Chromium 失败: %w", err)
	}

	// profileDir 使用独立于自动续期的专用验证目录，绝不触碰冻结的 user_<id> 目录锁。
	profileDir, dirErr := resolvePersistentUserDataDir(filepath.Join("browser_data", "collector_verify_"+pureUserID(normalizedID)))
	if dirErr != nil {
		finishOp()
		return dirErr
	}
	cleanSingletonFiles(profileDir)

	// opts 固定以有界面模式（Headless=false）启动真实桌面窗口，供用户亲手完成验证。
	opts := passwordPersistentContextOptions(false)
	// bctx、launchErr 启动持久化 Chromium 上下文（若残留锁文件则清理后重试一次）。
	bctx, launchErr := v.manager.pw.Chromium.LaunchPersistentContext(profileDir, opts)
	if launchErr != nil {
		cleanSingletonFiles(profileDir)
		bctx, launchErr = v.manager.pw.Chromium.LaunchPersistentContext(profileDir, opts)
	}
	if launchErr != nil || bctx == nil {
		finishOp()
		return fmt.Errorf("弹出桌面验证浏览器窗口失败（请确认服务运行在带桌面的本机环境）: %w", launchErr)
	}

	// syncErr 将账号现有登录 Cookie 注入窗口，免去用户重复扫码登录。
	var syncErr error
	if len(snapshot) > 0 {
		syncErr = syncCredentialCookies(bctx, cookieStr, snapshot)
	} else {
		syncErr = syncCredentialCookies(bctx, cookieStr)
	}
	if syncErr != nil {
		_ = bctx.Close()
		finishOp()
		return fmt.Errorf("向验证窗口注入账号登录态失败: %w", syncErr)
	}

	// page 复用持久化上下文首个标签页或新建标签页。
	var page playwright.Page
	// pages 读取当前上下文已打开的标签页列表。
	if pages := bctx.Pages(); len(pages) > 0 {
		page = pages[0]
	} else {
		// newPageErr 保存新建标签页错误。
		var newPageErr error
		page, newPageErr = bctx.NewPage()
		if newPageErr != nil {
			_ = bctx.Close()
			finishOp()
			return fmt.Errorf("创建验证页面失败: %w", newPageErr)
		}
	}
	_ = page.AddInitScript(playwright.Script{Content: playwright.String(stealthScript())})
	// gotoErr 记录导航至目标闲鱼页面的错误。
	if _, gotoErr := page.Goto(safeURL, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(30000),
	}); gotoErr != nil {
		_ = bctx.Close()
		finishOp()
		return fmt.Errorf("打开闲鱼网页失败: %w", gotoErr)
	}
	_ = page.BringToFront()

	// session 包装已打开的可见窗口。
	session := &manualVerifySession{
		cookieID:        normalizedID,
		context:         bctx,
		openedAt:        time.Now(),
		finishOperation: finishOp,
	}
	v.mu.Lock()
	if v.closed {
		v.mu.Unlock()
		session.close()
		return errors.New("服务正在关闭")
	}
	// replaced 检查并发期间是否刚插入了另一会话。
	replaced := v.sessions[normalizedID]
	v.sessions[normalizedID] = session
	v.mu.Unlock()
	if replaced != nil {
		replaced.close()
	}
	return nil
}

// CompleteWindow 从用户已完成手动验证的窗口读取完整 Cookie Jar（含各接口路径下的 x5sec 票据）并关闭窗口。
func (v *CollectorManualVerifier) CompleteWindow(cookieID string) (string, []cookierefresh.BrowserCookie, error) {
	if v == nil {
		return "", nil, errors.New("验证窗口管理器未启用")
	}
	// normalizedID 是去空白后的账号标识。
	normalizedID := strings.TrimSpace(cookieID)
	v.mu.Lock()
	// sess 取出当前账号打开的验证窗口会话。
	sess := v.sessions[normalizedID]
	delete(v.sessions, normalizedID)
	v.mu.Unlock()

	if sess == nil {
		return "", nil, errors.New("未找到打开中的验证窗口，请先点击「弹出闲鱼窗口过滑块」，且滑完前先不要手动关掉该浏览器窗口")
	}
	defer sess.close()

	// rawCookies、readErr 读取浏览器上下文中所有域名与路径下的最新 Cookie（含 h5api.m.goofish.com 下的 x5sec）。
	rawCookies, readErr := sess.context.Cookies("https://www.goofish.com", "https://h5api.m.goofish.com", "https://passport.goofish.com")
	if readErr != nil {
		return "", nil, fmt.Errorf("读取验证窗口 Cookie 失败（请不要在点击同步前提前关闭弹出的浏览器窗口）: %w", readErr)
	}
	// snapshot 转换为权威 Cookie Jar 快照，完整保留 Domain、Path、Expires 与 HttpOnly。
	snapshot := cookieSnapshotFromPlaywright(rawCookies)
	// canonicalValue 生成 /im 主站标准 Cookie 字符串。
	canonicalValue, _ := cookierefresh.ScopedCookieHeaderForRequest(snapshot, goofishIMURL, "https://goofish.com", time.Now())
	// flatMap 解析键值对以确认账号仍处于已登录态且未串号。
	flatMap := parseCookieStr(canonicalValue)
	if strings.TrimSpace(flatMap["unb"]) == "" {
		return "", nil, errors.New("验证窗口中未检测到有效的闲鱼登录态（缺少 unb），请在弹出窗口确认已登录目标闲鱼号后再点同步")
	}
	return canonicalValue, snapshot, nil
}

// CancelWindow 主动关闭指定账号打开中的验证窗口而不修改已保存凭证。
func (v *CollectorManualVerifier) CancelWindow(cookieID string) {
	if v == nil {
		return
	}
	v.mu.Lock()
	// sess 取出并移除当前会话。
	sess := v.sessions[strings.TrimSpace(cookieID)]
	delete(v.sessions, strings.TrimSpace(cookieID))
	v.mu.Unlock()
	if sess != nil {
		sess.close()
	}
}

// validateGoofishVerifyURL 确保验证窗口只导航到闲鱼官网域名。
func validateGoofishVerifyURL(raw string) (string, error) {
	// trimmed 是去空白后的目标网址，空串默认打开闲鱼搜索页。
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "https://www.goofish.com/search?q=%E7%94%B5%E5%AD%90%E8%B5%84%E6%96%99", nil
	}
	// parsed、err 解析目标 URL。
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), "www.goofish.com") {
		return "", errors.New("验证窗口仅允许打开闲鱼官方网站 www.goofish.com")
	}
	return parsed.String(), nil
}
