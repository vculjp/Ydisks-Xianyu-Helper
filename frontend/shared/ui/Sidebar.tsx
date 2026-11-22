import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, GitCommitHorizontal, LogOut } from 'lucide-react';
import { consoleHomeEntry, visibleConsoleGroups, type ConsoleNavEntry, type ConsoleNavGroup } from './consoleNavigation';
import YdisksLogo from './YdisksLogo';

// SidebarBuildInfo 描述应用壳传递给侧边栏的公开构建版本信息。
export interface SidebarBuildInfo {
  // version 是当前服务构建版本，只用于界面展示。
  version: string;
  // commit 是当前服务构建提交标识，只用于界面展示。
  commit: string;
}

// SidebarProps 描述侧边栏所需的导航和会话回调。
interface SidebarProps {
  /** activeTab 表示当前Tab。 */ activeTab: string;
  /** isAdmin 表示当前用户是否为管理员。 */ isAdmin?: boolean;
  /** collapsed 表示侧边栏是否折叠。 */ collapsed: boolean;
  /** mobileOpen 表示窄屏导航抽屉是否展开；桌面端仍由 collapsed 控制宽度。 */
  mobileOpen?: boolean;
  /** onToggleCollapsed 表示切换侧边栏折叠状态的回调。 */ onToggleCollapsed: () => void;
  /** onNavigate 表示切换主导航页面的回调。 */ onNavigate: (tab: string) => void;
  /** onLogout 表示注销当前会话的回调。 */ onLogout: () => void;
  /** buildInfo 是由应用壳加载并传入的公开构建版本信息。 */ buildInfo: SidebarBuildInfo;
  /** hasUnreadChatMessage 表示在线聊天入口是否仍有未读消息，需要展示红点。 */ hasUnreadChatMessage?: boolean;
}

/** buildSidebarOpenState 复制用户手动展开状态，避免渲染期间直接修改状态对象。 */
const buildSidebarOpenState = (groups: ConsoleNavGroup[], activeTab: string): Record<string, boolean> => {
  // nextState 保存本次渲染需要展示的分组展开状态。
  const nextState: Record<string, boolean> = {};
  for (const /* group 是当前需要计算默认展开状态的分组。 */ group of groups) {
    nextState[group.key] = group.key === 'products' || group.items.some(/* item 检查分组是否包含当前页面。 */ item => item.id === activeTab);
  }
  return nextState;
};

// Sidebar 渲染参考控制台的分组折叠导航，并保留移动抽屉、折叠偏好和会话操作。
const Sidebar: React.FC<SidebarProps> = ({
  activeTab, isAdmin = false, collapsed, mobileOpen = false, onToggleCollapsed, onNavigate, onLogout, buildInfo, hasUnreadChatMessage = false,
}) => {
  // groups 是当前权限下可见的折叠菜单分组。
  const groups = visibleConsoleGroups(isAdmin);
  // manualOpenState 保存用户主动展开或收起的分组，未记录的分组按是否包含当前页面推导。
  const [manualOpenState, setManualOpenState] = useState<Record<string, boolean>>(() => buildSidebarOpenState(groups, activeTab));

  useEffect(/* 当前副作用在路由或权限变化时展开包含当前页面的分组，避免选中项被隐藏。 */ () => {
    setManualOpenState(/* previous 是变化前的用户展开状态。 */ previous => {
      // activeGroup 是当前页面所属的分组，首页没有分组。
      const activeGroup = groups.find(/* group 检查分组是否包含当前页面。 */ group => group.items.some(/* item 按路由标识匹配当前页面。 */ item => item.id === activeTab));
      if (!activeGroup || previous[activeGroup.key]) return previous;
      return { ...previous, [activeGroup.key]: true };
    });
  }, [activeTab, isAdmin]);

  /** isGroupOpen 计算分组当前是否展开；用户没有手动切换时以当前页面所在分组为准。 */
  const isGroupOpen = (group: ConsoleNavGroup): boolean => manualOpenState[group.key] ?? group.items.some(/* item 判断当前页面是否在分组内。 */ item => item.id === activeTab);

  /** toggleGroup 由分组标题点击触发，只改变当前分组的展开状态。 */
  const toggleGroup = (group: ConsoleNavGroup): void => {
    setManualOpenState(/* previous 是切换前的展开状态。 */ previous => ({ ...previous, [group.key]: !(previous[group.key] ?? group.items.some(/* item 判断当前页面是否在分组内。 */ item => item.id === activeTab)) }));
  };

  /** renderEntry 渲染一个页面入口，保留聊天未读红点和当前页面语义。 */
  const renderEntry = (entry: ConsoleNavEntry, nested: boolean): React.ReactElement => {
    // Icon 是该入口的 Lucide 图标组件。
    const Icon = entry.icon;
    // active 表示该入口是否对应当前业务页面。
    const active = activeTab === entry.id;
    return (
      <button
        key={entry.id}
        type="button"
        title={collapsed ? entry.label : undefined}
        aria-label={entry.label}
        aria-current={active ? 'page' : undefined}
        onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => onNavigate(entry.id)}
        className={`console-nav-link ${nested ? 'console-nav-link-nested' : ''} ${active ? 'is-active' : ''}`}
      >
        <span className="console-nav-icon">
          {!nested && <Icon className="h-[15px] w-[15px]" />}
          {entry.id === 'chat' && hasUnreadChatMessage && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-red-500" role="status" aria-label="在线聊天有未读消息" />}
        </span>
        {!collapsed && <span className="console-nav-label">{entry.label}</span>}
        {active && !collapsed && <span className="console-nav-active-dot" />}
      </button>
    );
  };

  // displayVersion 显示版本号。
  const displayVersion = /^\d+\.\d+\.\d+$/.test(buildInfo.version)
    ? `v${buildInfo.version}`
    : buildInfo.version;

  return (
    <aside className={`console-sidebar ${mobileOpen ? 'visible translate-x-0 is-mobile-open' : 'invisible -translate-x-full'} ${collapsed ? 'is-collapsed' : ''}`}>
      <div className={`console-brand ${collapsed ? 'is-collapsed' : ''}`}>
        <button type="button" className="console-brand-button" aria-label="返回主页" onClick={/* 点击品牌回到运营概览。 */ () => onNavigate('dashboard')}>
          <YdisksLogo className="console-brand-logo" />
        </button>
      </div>

      <nav className="console-navigation" aria-label="主导航">
        {collapsed ? (
          <div className="console-collapsed-items">
            {[consoleHomeEntry, ...groups.flatMap(/* group 取分组内入口用于折叠态。 */ group => group.items)].map(/* entry 是折叠态下的单个页面入口。 */ entry => renderEntry(entry, false))}
          </div>
        ) : (
          <>
            {renderEntry(consoleHomeEntry, false)}
            {groups.map(/* group 是当前待渲染的菜单分组。 */ group => {
              // GroupIcon 是分组标题前的图标组件。
              const GroupIcon = group.icon;
              // open 表示分组的子入口是否展开。
              const open = isGroupOpen(group);
              return (
                <section key={group.key} className="console-nav-group">
                  <button
                    type="button"
                    className={`console-nav-group-toggle ${open ? 'is-open' : ''}`}
                    aria-expanded={open}
                    onClick={/* 点击分组标题切换子菜单展开状态。 */ () => toggleGroup(group)}
                  >
                    <GroupIcon className="h-[15px] w-[15px]" />
                    <span>{group.label}</span>
                    <ChevronDown className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="console-nav-children">
                      {group.items.map(/* entry 是分组内的单个页面入口。 */ entry => renderEntry(entry, true))}
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </nav>

      <div className="console-sidebar-footer">
        <div title={collapsed ? `版本 ${buildInfo.version} · ${buildInfo.commit}` : undefined} className="console-version">
          {collapsed ? (
            <GitCommitHorizontal className="h-[15px] w-[15px] text-slate-400" aria-label={`版本 ${buildInfo.version}`} />
          ) : (
            <>
              <span className="console-version-label">运行版本</span>
              <span className="console-version-value">{displayVersion}</span>
              <span className="console-version-commit">{buildInfo.commit}</span>
            </>
          )}
        </div>
        <div className={`console-sidebar-actions ${collapsed ? 'is-collapsed' : ''}`}>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            className="console-sidebar-action"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed && <span>收起侧边栏</span>}
          </button>
          <button
            type="button"
            onClick={onLogout}
            title={collapsed ? '退出登录' : undefined}
            aria-label="退出登录"
            className="console-sidebar-action console-sidebar-action-danger"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>退出登录</span>}
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
