import React,{ lazy,Suspense,useEffect,useState } from 'react';
import type { Item } from '../features/items/api';
import Sidebar from '../../shared/ui/Sidebar';
import { useChatTitleNotification } from '../features/chat/titleNotification';
import { getHealth } from '../features/system/api';
import type { BuildInfo } from '../features/system/types';
import ConsoleTopbar from './ConsoleTopbar';

// DeliveryRuleTarget 描述商品页跳转到自动化规则页时需要携带的目标信息。
export interface DeliveryRuleTarget {
  // cookieId 表示目标闲鱼账号标识。
  cookieId: string;
  // itemId 表示目标商品标识。
  itemId: string;
  // trigger 表示要打开的自动化规则触发时机。
  trigger: 'order_paid' | 'order_created';
  // requestId 用于区分连续发起的跳转请求。
  requestId: number;
}

// AuthenticatedShellProps 描述认证后应用壳需要的导航、权限和联动回调。
export interface AuthenticatedShellProps {
  // activeTab 表示当前正在展示的业务页面标识。
  activeTab: string;
  // isAdmin 表示当前会话是否拥有管理员权限。
  isAdmin: boolean;
  // collapsed 表示侧边栏是否处于折叠状态。
  collapsed: boolean;
  // deliveryRuleTarget 表示待传递给规则页的商品发货目标。
  deliveryRuleTarget?: DeliveryRuleTarget;
  // onToggleCollapsed 负责切换侧边栏折叠状态。
  onToggleCollapsed: () => void;
  // onNavigate 负责切换业务页面并同步外部路由。
  onNavigate: (tab: string) => void;
  // onLogout 负责注销当前会话并清理认证状态。
  onLogout: () => void;
  // onConfigureDelivery 负责接收商品页发起的规则配置目标。
  onConfigureDelivery: (target: DeliveryRuleTarget) => void;
  // onDeliveryTargetHandled 负责确认规则页已经消费跳转目标。
  onDeliveryTargetHandled: () => void;
}

// Dashboard 是按需加载的仪表盘页面，避免首屏同步载入图表依赖。
const Dashboard = lazy(/* Dashboard 页面按路由激活时加载。 */ () => import('../features/dashboard/pages/Dashboard'));
// AccountList 是按需加载的账号管理页面，避免未访问时载入账号弹窗和二维码代码。
const AccountList = lazy(/* AccountList 页面按路由激活时加载。 */ () => import('../features/accounts/pages/AccountList'));
// AccountEditModal 在账号页面首次打开编辑时按需加载，保持账号页主分片在预算内。
const AccountEditModal = lazy(/* 账号编辑弹窗随账号页面按需加载。 */ () => import('../features/accounts/components/AccountEditModal').then(/* module 提供账号编辑弹窗的具名导出。 */ module => ({ default: module.AccountEditModal })));
// OrderList 是按需加载的订单页面，避免首屏载入订单导入与刷新代码。
const OrderList = lazy(/* OrderList 页面按路由激活时加载。 */ () => import('../features/orders/pages/OrderList'));
// SalesStats 是按需加载的销售统计页面，避免首屏载入图表代码。
const SalesStats = lazy(/* SalesStats 页面按路由激活时加载。 */ () => import('../features/sales/pages/SalesStats'));
// ItemList 是按需加载的商品页面，避免首屏载入商品发布编辑器代码。
const ItemList = lazy(/* ItemList 页面按路由激活时加载。 */ () => import('../features/items/pages/ItemList'));
/** ItemEditorPage 在用户打开商品编辑时才加载，保留列表分片预算。 */
const ItemEditorPage = lazy(/* 商品编辑器仅由应用壳声明按需加载边界。 */ () => import('../features/items/components/ItemEditorPage'));
// PublishSpecsEditor 在商品页面中按需加载，保持规格编辑器与商品主分片解耦。
const PublishSpecsEditor = lazy(/* 规格编辑器随商品页面路由加载。 */ () => import('../../shared/ui/publish/PublishSpecsEditor').then(/* module 提供规格编辑器的具名导出。 */ module => ({ default: module.PublishSpecsEditor })));
// PublishImagesEditor 在商品页面中按需加载，避免图片编辑交互增大商品主分片。
const PublishImagesEditor = lazy(/* 图片编辑器随商品页面路由加载。 */ () => import('../features/items/components/PublishImagesEditor').then(/* module 提供图片编辑器的具名导出。 */ module => ({ default: module.PublishImagesEditor })));
// ItemAISettingsModal 在商品页面中按需加载，保持商品主分片在预算内。
const ItemAISettingsModal = lazy(/* 商品 AI 弹窗随商品页面路由加载。 */ () => import('../features/items/components/ItemAISettingsModal').then(/* module 提供商品 AI 弹窗的具名导出。 */ module => ({ default: module.ItemAISettingsModal })));
// LibraryImagePicker 供商品页单品发布按需使用，图片库代码仅在打开选择器时加载。
const LibraryImagePicker = lazy(/* 图片库选择器随商品页面路由按需加载。 */ () => import('../features/library/components/LibraryImagePicker'));
// ResourceLibrary 是按需加载的本地资源库页面（商品模板与图片库）。
// LibraryImageChooser 供规则、卡密、发货模板和聊天页单选图片库图片，仅在打开选择器时加载。
const LibraryImageChooser = lazy(/* 图片库单选器随使用它的页面按需加载。 */ () => import('../features/library/components/LibraryImageChooser'));

// PublishLocationField 与 PublishCategoryField 是商品管理发布使用的定位/手动选点与类目推荐字段，经应用壳注入资源库以避免特性之间互相导入。
// PublishLocationField 是按需加载的发货地字段。
const PublishLocationField = lazy(/* 发货地字段随资源库发布弹窗按需加载。 */ () => import('../features/items/components/PublishLocationField'));
// PublishCategoryField 是按需加载的类目字段。
const PublishCategoryField = lazy(/* 类目字段随资源库模板编辑器按需加载。 */ () => import('../features/items/components/PublishCategoryField'));
// ProductCollector 是按需加载的全站商品采集工作台页面。
const ProductCollector = lazy(/* ProductCollector 页面按路由激活时加载。 */ () => import('../features/collector/pages/ProductCollector'));
const ResourceLibrary = lazy(/* ResourceLibrary 页面按路由激活时加载。 */ () => import('../features/library/pages/ResourceLibrary'));
// Settings 是按需加载的系统设置页面，仅在管理员访问时加载。
const Settings = lazy(/* Settings 页面按路由激活时加载。 */ () => import('../features/settings/pages/Settings'));
// Rules 是按需加载的自动化规则页面，避免首屏载入规则编辑器代码。
const Rules = lazy(/* Rules 页面按路由激活时加载。 */ () => import('../features/rules/pages/Rules'));
// AutomationAuditPanel 是规则日志面板，仅在规则页打开“规则日志”页签时才下载，避免撑大规则页分片。
const AutomationAuditPanel = lazy(/* 规则日志面板随规则页签按需加载。 */ () => import('../features/rules/components/AutomationAuditPanel'));
// SupportCenter 是独立的 AI 客服中心分片，仅打开该页签时下载。
const SupportCenter = lazy(/* 客服中心面板按需加载。 */ () => import('../features/rules/components/SupportCenter'));
// DeliveryTemplates 是按需加载的发货模板管理页面。
const DeliveryTemplates = lazy(/* DeliveryTemplates 页面按路由激活时加载。 */ () => import('../features/delivery-templates/pages/DeliveryTemplates'));
// Notifications 是按需加载的通知页面，避免首屏载入通知配置代码。
const Notifications = lazy(/* Notifications 页面按路由激活时加载。 */ () => import('../features/notifications/pages/Notifications'));
// Chat 是按需加载的聊天页面，避免未访问时载入聊天历史和 WebSocket 视图。
const Chat = lazy(/* Chat 页面按路由激活时加载。 */ () => import('../features/chat/pages/Chat'));
// RuntimeLogs 是按需加载的运行日志页面，仅在管理员访问时加载，避免普通用户下载诊断代码。
const RuntimeLogs = lazy(/* RuntimeLogs 页面按路由激活时加载。 */ () => import('../features/logs/pages/RuntimeLogs'));

// PageLoading 展示路由页面代码加载期间的统一占位状态。
const PageLoading: React.FC = () => (
  <div className="flex min-h-[24rem] items-center justify-center" role="status" aria-label="正在加载页面">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand/20 border-t-brand" />
  </div>
);

// AppContentProps 描述页面组合器接收的路由和跨页面联动状态。
export interface AppContentProps {
  // activeTab 表示当前需要渲染的业务页面标识。
  activeTab: string;
  // isAdmin 表示当前会话是否允许访问管理员页面。
  isAdmin: boolean;
  // deliveryRuleTarget 表示商品页传递给规则页的目标信息。
  deliveryRuleTarget?: DeliveryRuleTarget;
  // onConfigureDelivery 负责接收商品页面发起的规则配置目标。
  onConfigureDelivery: (target: DeliveryRuleTarget) => void;
  // onDeliveryTargetHandled 负责确认规则页已经消费跳转目标。
  onDeliveryTargetHandled: () => void;
  // onNavigateToItems 在模板批次启动后跳转到商品页查看批量铺货进度。
  onNavigateToItems?: () => void;
  // onNavigateToLibrary 在采集转存完成后跳转到本地资源库页面。
  onNavigateToLibrary?: () => void;
  // onNavigate 在仪表盘快捷入口中切换到其他业务页面。
  onNavigate?: (tab: string) => void;
}

// AppContent 按当前导航标识选择业务页面，并隔离页面代码的动态加载边界。
export const AppContent: React.FC<AppContentProps> = ({
  activeTab,
  isAdmin,
  deliveryRuleTarget,
  onConfigureDelivery,
  onDeliveryTargetHandled,
  onNavigateToItems,
  onNavigateToLibrary,
  onNavigate,
}) => {
  // handleConfigureDelivery 将商品页面对象和触发时机转换成路由壳使用的最小联动载荷。
  const handleConfigureDelivery = (item /* item 表示用户选择的商品。 */: Item, trigger /* trigger 表示付款或拍下触发。 */: 'order_paid' | 'order_created' = 'order_paid') => {
    onConfigureDelivery({
      cookieId: item.cookie_id,
      itemId: item.item_id,
      trigger,
      requestId: Date.now(),
    });
  };

  // renderPage 根据当前页面标识选择唯一的业务页面组件。
  const renderPage = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard onNavigate={onNavigate} />;
      case 'accounts': return <AccountList accountEditModal={AccountEditModal} />;
      case 'chat': return <Chat libraryImageChooser={LibraryImageChooser} />;
      case 'orders': return <OrderList />;
      case 'sales': return <SalesStats />;
      case 'items': return <ItemList onConfigureDelivery={handleConfigureDelivery} publishSpecsEditor={PublishSpecsEditor} publishImagesEditor={PublishImagesEditor} itemAISettingsModal={ItemAISettingsModal} itemEditorPage={ItemEditorPage} libraryImagePicker={LibraryImagePicker} />;
      case 'rules': return <Rules
        initialDeliveryTarget={deliveryRuleTarget}
        onDeliveryTargetHandled={onDeliveryTargetHandled}
        auditPanel={AutomationAuditPanel}
        supportPanel={SupportCenter}
        libraryImageChooser={LibraryImageChooser}
      />;
      case 'delivery-templates': return <DeliveryTemplates libraryImageChooser={LibraryImageChooser} />;
      case 'collector': return <ProductCollector onNavigateToLibrary={onNavigateToLibrary} />;
      case 'library': return <ResourceLibrary onBatchStarted={onNavigateToItems} locationField={PublishLocationField} categoryField={PublishCategoryField} />;
      case 'notifications': return <Notifications isAdmin={isAdmin} />;
      case 'logs': return isAdmin ? <RuntimeLogs /> : <Dashboard />;
      case 'settings': return isAdmin ? <Settings /> : <Dashboard />;
      default: return <Dashboard />;
    }
  };

  return (
    <Suspense fallback={<PageLoading />}>
      {renderPage()}
    </Suspense>
  );
};

// AuthenticatedShell 组合认证后的侧边栏、主内容区域和页面动态加载边界。
const AuthenticatedShell: React.FC<AuthenticatedShellProps> = ({
  activeTab,
  isAdmin,
  collapsed,
  deliveryRuleTarget,
  onToggleCollapsed,
  onNavigate,
  onLogout,
  onConfigureDelivery,
  onDeliveryTargetHandled,
}) => {
  // buildInfo 保存壳层加载的公开构建版本，侧边栏保持为无请求的共享展示组件。
  const [buildInfo, setBuildInfo] = useState<BuildInfo>({ version: 'dev', commit: 'unknown' });
  // mobileNavigationOpen 只控制窄屏侧边抽屉，不改变桌面端已保存的折叠偏好。
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  // hasUnreadChatMessage 保存侧边栏在线聊天入口的服务端/实时聚合未读状态，不因导航动作改变。
  const { hasUnreadChatMessage } = useChatTitleNotification();

  useEffect(/* effect 在壳层挂载时读取版本信息，并在卸载时中止尚未完成的请求。 */ () => {
    // controller 取消壳层卸载后不再需要的健康检查请求。
    const controller = new AbortController();
    getHealth({ signal: controller.signal })
      .then(/* response 是健康接口返回的公开构建标识。 */ response => setBuildInfo({
        version: String(response.version || 'dev'),
        commit: String(response.commit || 'unknown'),
      }))
      .catch(/* error 是健康检查失败原因，取消请求不需要改变默认展示版本。 */ error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });
    return /* cleanup 在壳层卸载时释放健康检查请求。 */ () => controller.abort();
  }, []);

  useEffect(/* 当用户按 Escape 时关闭窄屏导航，避免遮罩长期阻挡主内容。 */ () => {
    if (!mobileNavigationOpen) return;
    // closeOnEscape 仅响应退出抽屉的键盘操作。
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavigationOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return /* 移除移动菜单键盘监听以免重复注册。 */ () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileNavigationOpen]);

  useEffect(/* 当窗口从手机宽度恢复到桌面宽度时关闭抽屉，保留原桌面折叠状态。 */ () => {
    if (typeof window.matchMedia !== 'function') return;
    // desktopBreakpoint 与 Tailwind 的 md: 断点相同，避免放大窗口后抽屉仍占用遮罩状态。
    const desktopBreakpoint = window.matchMedia('(min-width: 768px)');
    // closeOnDesktop 在跨越断点时还原由桌面 collapsed 偏好控制的导航。
    const closeOnDesktop = () => {
      if (desktopBreakpoint.matches) setMobileNavigationOpen(false);
    };
    desktopBreakpoint.addEventListener('change', closeOnDesktop);
    return /* 释放浏览器宽度切换监听。 */ () => desktopBreakpoint.removeEventListener('change', closeOnDesktop);
  }, []);

  // navigateFromSidebar 确保选择页面后关闭移动导航，桌面导航行为保持不变。
  const navigateFromSidebar = (tab: string) => {
    setMobileNavigationOpen(false);
    onNavigate(tab);
  };

  return (
    <div className={`console-shell ${collapsed ? 'is-collapsed' : ''}`}>
    {mobileNavigationOpen && (
      <button
        type="button"
        aria-label="关闭导航菜单"
        onClick={/* 在主区域上方关闭移动端抽屉。 */ () => setMobileNavigationOpen(false)}
        className="console-navigation-scrim"
      />
    )}
    <Sidebar
      activeTab={activeTab}
      isAdmin={isAdmin}
      collapsed={collapsed && !mobileNavigationOpen}
      mobileOpen={mobileNavigationOpen}
      onToggleCollapsed={/* 移动端折叠操作关闭抽屉，桌面端保留原折叠行为。 */ () => mobileNavigationOpen ? setMobileNavigationOpen(false) : onToggleCollapsed()}
      onNavigate={navigateFromSidebar}
      onLogout={/* 注销前关闭移动端导航。 */ () => { setMobileNavigationOpen(false); onLogout(); }}
      buildInfo={buildInfo}
      hasUnreadChatMessage={hasUnreadChatMessage}
    />

    <div className="console-workspace">
      <ConsoleTopbar
        activeTab={activeTab}
        isAdmin={isAdmin}
        mobileNavigationOpen={mobileNavigationOpen}
        onToggleNavigation={/* 桌面端折叠侧栏，窄屏端打开导航抽屉；无 matchMedia 的测试环境按窄屏处理。 */ () => {
          if (mobileNavigationOpen) {
            setMobileNavigationOpen(false);
            return;
          }
          // mobileViewport 在缺少 matchMedia 的 jsdom 中默认按移动端处理，保证抽屉行为可测。
          const mobileViewport = typeof window.matchMedia !== 'function' || window.matchMedia('(max-width: 767px)').matches;
          if (mobileViewport) setMobileNavigationOpen(true); else onToggleCollapsed();
        }}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />

      <main className={`console-main ${activeTab === 'chat' ? 'console-main-chat' : ''}`}>
        <div className={activeTab === 'chat' ? 'console-content console-content-chat' : 'console-content'}>
        <AppContent
          activeTab={activeTab}
          isAdmin={isAdmin}
          deliveryRuleTarget={deliveryRuleTarget}
          onConfigureDelivery={onConfigureDelivery}
          onDeliveryTargetHandled={onDeliveryTargetHandled}
          onNavigateToItems={/* 批次启动后进入商品页查看进度。 */ () => onNavigate('items')}
          onNavigateToLibrary={/* 转存模板完成后进入本地资源库准备多店上架。 */ () => onNavigate('library')}
          onNavigate={onNavigate}
        />
        </div>
      </main>
    </div>
    </div>
  );
};

export default AuthenticatedShell;
