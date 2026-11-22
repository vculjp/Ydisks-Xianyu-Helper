// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach,describe,expect,test,vi } from 'vitest';
import type { Item } from '../features/items/api';
import type { DeliveryRuleTarget } from './AuthenticatedShell';

vi.mock('../features/dashboard/pages/Dashboard', /* dashboardMockFactory 提供仪表盘页面的轻量替身。 */ () => {
  // DashboardMock 渲染仪表盘页面标识，避免行为测试加载真实图表依赖。
  const DashboardMock: React.FC = () => <div data-testid="dashboard-page">仪表盘</div>;
  return { default: DashboardMock };
});

vi.mock('../features/settings/pages/Settings', /* settingsMockFactory 提供设置页面的轻量替身。 */ () => {
  // SettingsMock 渲染设置页面标识，验证管理员权限分支。
  const SettingsMock: React.FC = () => <div data-testid="settings-page">设置</div>;
  return { default: SettingsMock };
});

vi.mock('../features/items/pages/ItemList', /* itemListMockFactory 提供商品页面的联动替身。 */ () => {
  // MockItemListProps 描述商品页面替身接收的规则配置回调。
  interface MockItemListProps {
    // onConfigureDelivery 负责通知父级打开商品规则配置。
    onConfigureDelivery: (item: Item) => void;
  }
  // ItemListMock 模拟用户点击商品规则配置入口。
  const ItemListMock: React.FC<MockItemListProps> = ({ onConfigureDelivery }) => {
    // itemFixture 是商品→规则联动测试使用的最小商品对象。
    const itemFixture = { cookie_id: 'cookie-1', item_id: 'item-1' } as Item;
    return <button data-testid="configure-delivery" onClick={/* configureAction 触发规则配置联动。 */ () => onConfigureDelivery(itemFixture)}>配置发货规则</button>;
  };
  return { default: ItemListMock };
});

vi.mock('../features/rules/pages/Rules', /* rulesMockFactory 提供规则页面的轻量替身。 */ () => {
  // MockRulesProps 描述规则页面替身接收的联动参数。
  interface MockRulesProps {
    // initialDeliveryTarget 保存商品页面传来的规则目标。
    initialDeliveryTarget?: DeliveryRuleTarget;
    // onDeliveryTargetHandled 表示规则页面已消费联动目标。
    onDeliveryTargetHandled?: () => void;
  }
  // RulesMock 展示规则目标，验证商品→规则页参数保持不变。
  const RulesMock: React.FC<MockRulesProps> = ({ initialDeliveryTarget, onDeliveryTargetHandled }) => (
    <div data-testid="rules-page">
      <span>{initialDeliveryTarget?.cookieId}:{initialDeliveryTarget?.itemId}</span>
      <button onClick={/* handledAction 确认规则页面已消费目标。 */ () => onDeliveryTargetHandled?.()}>完成</button>
    </div>
  );
  return { default: RulesMock };
});

// loadAppContent 动态导入认证后页面组合器，等待懒加载模块完成解析。
const loadAppContent = async () => import('./AuthenticatedShell');

describe('AuthenticatedShell 页面组合行为', /* 当前回调验证权限回退和跨页面联动边界。 */ () => {
  afterEach(/* 当前回调清理每个页面组合测试挂载的 DOM。 */ () => cleanup());

  test('非管理员访问设置页时回退到仪表盘', /* 当前回调验证非管理员的设置页权限回退。 */ async () => {
    // appContentModule 表示动态加载的页面组合模块。
    const appContentModule = await loadAppContent();
    // AppContentComponent 表示动态模块导出的页面组合组件。
    const AppContentComponent = appContentModule.AppContent;
    render(
      <AppContentComponent
        activeTab="settings"
        isAdmin={false}
        onConfigureDelivery={/* configureTargetAction 接收商品规则目标。 */ () => undefined}
        onDeliveryTargetHandled={/* handledAction 表示规则目标已消费。 */ () => undefined}
      />,
    );

    await waitFor(/* dashboardAssertion 等待仪表盘懒加载完成。 */ () => expect(screen.getByTestId('dashboard-page')).toBeTruthy());
    expect(screen.queryByTestId('settings-page')).toBeNull();
  });

  test('管理员访问设置页时加载设置页面', /* 当前回调验证管理员设置页面加载。 */ async () => {
    // appContentModule 表示动态加载的页面组合模块。
    const appContentModule = await loadAppContent();
    // AppContentComponent 表示动态模块导出的页面组合组件。
    const AppContentComponent = appContentModule.AppContent;
    render(
      <AppContentComponent
        activeTab="settings"
        isAdmin
        onConfigureDelivery={/* configureTargetAction 接收商品规则目标。 */ () => undefined}
        onDeliveryTargetHandled={/* handledAction 表示规则目标已消费。 */ () => undefined}
      />,
    );

    await waitFor(/* settingsAssertion 等待设置页面懒加载完成。 */ () => expect(screen.getByTestId('settings-page')).toBeTruthy());
  });

  test('商品配置入口把目标传递到规则页面并支持消费确认', /* 当前回调验证商品到规则页面的联动参数和消费确认。 */ async () => {
    // appContentModule 表示动态加载的页面组合模块。
    const appContentModule = await loadAppContent();
    // AppContentComponent 表示动态模块导出的页面组合组件。
    const AppContentComponent = appContentModule.AppContent;
    // configureTarget 保存商品页面发出的规则目标。
    const configureTarget = vi.fn<(target: DeliveryRuleTarget) => void>();
    render(
      <AppContentComponent
        activeTab="items"
        isAdmin={false}
        onConfigureDelivery={configureTarget}
        onDeliveryTargetHandled={/* handledAction 表示规则目标已消费。 */ () => undefined}
      />,
    );

    await waitFor(/* itemAssertion 等待商品页面懒加载完成。 */ () => expect(screen.getByTestId('configure-delivery')).toBeTruthy());
    fireEvent.click(screen.getByTestId('configure-delivery'));
    expect(configureTarget).toHaveBeenCalledWith(expect.objectContaining({ cookieId: 'cookie-1', itemId: 'item-1', trigger: 'order_paid' }));
    // target 是商品页面刚刚发出的完整规则配置目标。
    const target = configureTarget.mock.calls[0][0];
    expect(target.requestId).toEqual(expect.any(Number));

    cleanup();
    // handledTarget 记录规则页面消费联动目标的回调。
    const handledTarget = vi.fn();
    render(
      <AppContentComponent
        activeTab="rules"
        isAdmin={false}
        deliveryRuleTarget={target}
        onConfigureDelivery={/* configureTargetAction 接收商品规则目标。 */ () => undefined}
        onDeliveryTargetHandled={handledTarget}
      />,
    );
    await waitFor(/* rulesAssertion 等待规则页面懒加载完成。 */ () => expect(screen.getByTestId('rules-page')).toBeTruthy());
    expect(screen.getByText('cookie-1:item-1')).toBeTruthy();
    fireEvent.click(screen.getByText('完成'));
    expect(handledTarget).toHaveBeenCalledTimes(1);
  });

  test('移动导航展开、切换页面和关闭不会改变桌面侧栏布局', /* drawerNavigationTest 锁定窄屏导航的开关和桌面间距边界。 */ async () => {
    // AuthenticatedShellComponent 是包含移动端导航抽屉的正式页面壳。
    const AuthenticatedShellComponent = (await loadAppContent()).default;
    // navigate 保存用户实际选择的主导航目标，确保抽屉点击仍触发原有路由行为。
    const navigate = vi.fn<(tab: string) => void>();
    // view 承载应用壳 DOM，以检查移动端无额外左侧占位。
    const view = render(
      <AuthenticatedShellComponent
        activeTab="dashboard"
        isAdmin
        collapsed={false}
        onToggleCollapsed={/* collapseAction 保留桌面折叠能力，窄屏关闭抽屉不应调用它。 */ () => undefined}
        onNavigate={navigate}
        onLogout={/* logoutAction 本用例不执行注销。 */ () => undefined}
        onConfigureDelivery={/* configureAction 本用例不执行商品联动。 */ () => undefined}
        onDeliveryTargetHandled={/* handledAction 本用例没有待消费联动。 */ () => undefined}
      />,
    );
    // main 是不再在移动端常驻侧栏左侧边距的主要内容容器。
    const main = view.container.querySelector('main');
    expect(main?.className.split(/\s+/)).toContain('console-main');
    expect(main?.className).not.toContain('ml-64');
    // workspace 是桌面侧栏偏移与移动端零偏移的布局容器。
    expect(view.container.querySelector('.console-workspace')).toBeTruthy();
    expect(screen.queryByText('免费版')).toBeNull();
    expect(screen.queryByText('升级')).toBeNull();
    // menuButton 是移动端顶部的抽屉入口。
    const menuButton = screen.getByRole('button', { name: '打开导航菜单' });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menuButton);
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: '关闭导航菜单' })).toBeTruthy();
    // sidebar 是真实导航侧栏，打开时应解除隐藏和移出屏幕的类。
    const sidebar = view.container.querySelector('aside');
    expect(sidebar?.className).toContain('visible translate-x-0');
    fireEvent.click(screen.getByRole('button', { name: '店铺' }));
    fireEvent.click(screen.getByRole('button', { name: '账号管理' }));
    expect(navigate).toHaveBeenCalledWith('accounts');
    expect(screen.queryByRole('button', { name: '关闭导航菜单' })).toBeNull();
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
  });
});
