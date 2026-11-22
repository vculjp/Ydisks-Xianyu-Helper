import { ChevronDown, LogOut, Menu, RefreshCw, Settings, Store, UserRound } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { findConsoleRouteMeta } from '../../shared/ui/consoleNavigation';

/** ConsoleTopbarProps 描述参考控制台顶栏所需的导航与会话操作。 */
export interface ConsoleTopbarProps {
  /** activeTab 是当前业务页面标识，用于生成面包屑。 */
  activeTab: string;
  /** isAdmin 决定顶栏是否展示系统设置入口。 */
  isAdmin: boolean;
  /** mobileNavigationOpen 表示窄屏侧栏抽屉当前是否展开。 */
  mobileNavigationOpen: boolean;
  /** onToggleNavigation 在桌面端折叠或展开侧栏，在窄屏端打开抽屉。 */
  onToggleNavigation: () => void;
  /** onNavigate 接收顶栏菜单选择的业务页面标识。 */
  onNavigate: (tab: string) => void;
  /** onLogout 注销当前后台会话。 */
  onLogout: () => void;
}

/** ConsoleTopbar 渲染白色固定顶栏、面包屑、刷新入口与管理员账号菜单。 */
const ConsoleTopbar: React.FC<ConsoleTopbarProps> = ({
  activeTab,
  isAdmin,
  mobileNavigationOpen,
  onToggleNavigation,
  onNavigate,
  onLogout,
}) => {
  // routeMeta 是当前页面所属分组、标题和用途说明。
  const routeMeta = findConsoleRouteMeta(activeTab, isAdmin);
  // accountMenuOpen 只控制顶栏账号下拉菜单，不改变页面或服务端状态。
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  // accountMenuRef 指向账号菜单容器，用于判断点击是否发生在菜单内部。
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(/* 账号菜单打开时订阅外部点击和 Escape，关闭后立即释放监听。 */ () => {
    if (!accountMenuOpen) return;
    /** closeOnOutsideClick 在用户点击账号菜单外部时收起菜单。 */
    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (accountMenuRef.current?.contains(event.target as Node)) return;
      setAccountMenuOpen(false);
    };
    /** closeOnEscape 在用户按 Escape 时收起账号菜单。 */
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return /* 当前清理函数移除账号菜单的外部交互监听。 */ () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountMenuOpen]);

  /** navigateFromMenu 在账号菜单中选择页面后关闭菜单并执行原导航回调。 */
  const navigateFromMenu = (tab: string): void => {
    setAccountMenuOpen(false);
    onNavigate(tab);
  };

  /** refreshCurrentPage 通过浏览器刷新重新拉取当前页面所依赖的服务端数据。 */
  const refreshCurrentPage = (): void => {
    window.location.reload();
  };

  return (
    <header className="console-topbar">
      <button
        type="button"
        aria-label="打开导航菜单"
        aria-expanded={mobileNavigationOpen}
        onClick={/* 当前回调在桌面端折叠侧栏，在窄屏端打开抽屉。 */ onToggleNavigation}
        className="console-topbar-menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      <nav className="console-breadcrumbs" aria-label="面包屑">
        <span>{routeMeta.group}</span>
        <span aria-hidden="true">/</span>
        <strong>{routeMeta.label}</strong>
      </nav>

      <div className="console-topbar-tools">
        <button type="button" className="console-topbar-icon" aria-label="刷新当前页面" title="刷新当前页面" onClick={refreshCurrentPage}>
          <RefreshCw className="h-4 w-4" />
        </button>
        <button type="button" className="console-topbar-icon console-shop-button" aria-label="店铺管理" title="店铺管理" onClick={/* 当前回调打开账号管理页。 */ () => navigateFromMenu('accounts')}>
          <Store className="h-4 w-4" />
        </button>
        {isAdmin && (
          <button type="button" className="console-topbar-icon" aria-label="打开系统设置" title="系统设置" onClick={/* 当前回调打开管理员系统设置页。 */ () => navigateFromMenu('settings')}>
            <Settings className="h-4 w-4" />
          </button>
        )}
        <div ref={accountMenuRef} className="console-account">
          <button
            type="button"
            className="console-account-button"
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            onClick={/* 当前回调切换账号下拉菜单。 */ () => setAccountMenuOpen(/* previous 是切换前的菜单状态。 */ previous => !previous)}
          >
            <span className="console-account-avatar" aria-hidden="true"><UserRound className="h-3.5 w-3.5" /></span>
            <span className="console-account-name">{isAdmin ? '管理员' : '操作员'}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {accountMenuOpen && (
            <div className="console-account-menu" role="menu" aria-label="账号菜单">
              {isAdmin && (
                <button type="button" role="menuitem" onClick={/* 当前回调打开系统设置页。 */ () => navigateFromMenu('settings')}>
                  <Settings className="h-3.5 w-3.5" />
                  系统设置
                </button>
              )}
              <button type="button" role="menuitem" className="is-danger" onClick={/* 当前回调保持账号菜单关闭并注销会话。 */ () => { setAccountMenuOpen(false); onLogout(); }}>
                <LogOut className="h-3.5 w-3.5" />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default ConsoleTopbar;
