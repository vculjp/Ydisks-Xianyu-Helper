import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Box,
  FileStack,
  LayoutDashboard,
  Library,
  MessageCircleMore,
  Radar,
  ScrollText,
  Settings,
  ShoppingBag,
  Store,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';

/** ConsoleNavEntry 描述控制台侧栏和面包屑共享的单个业务入口。 */
export interface ConsoleNavEntry {
  /** id 是路由表使用的稳定业务标识，不允许与页面地址重复定义。 */
  id: string;
  /** label 是侧栏与面包屑展示的中文名称。 */
  label: string;
  /** description 是页面用途说明，供面包屑辅助文本和可访问性标签使用。 */
  description: string;
  /** icon 是该入口在侧栏中使用的 Lucide 图标组件。 */
  icon: LucideIcon;
  /** adminOnly 表示该入口只对管理员会话可见。 */
  adminOnly?: boolean;
}

/** ConsoleNavGroup 描述参考原型中的可折叠菜单分组。 */
export interface ConsoleNavGroup {
  /** key 是分组展开状态使用的稳定标识。 */
  key: string;
  /** label 是分组标题。 */
  label: string;
  /** icon 是分组标题前的图标组件。 */
  icon: LucideIcon;
  /** items 是分组内按业务顺序排列的页面入口。 */
  items: readonly ConsoleNavEntry[];
}

/** consoleHomeEntry 是独立于折叠分组的首页入口。 */
export const consoleHomeEntry: ConsoleNavEntry = {
  id: 'dashboard',
  label: '主页',
  description: '查看店铺运营概览与常用入口。',
  icon: LayoutDashboard,
};

/** consoleNavigationGroups 是控制台唯一菜单源，侧栏与顶栏面包屑都从这里读取。 */
export const consoleNavigationGroups: readonly ConsoleNavGroup[] = [
  {
    key: 'products',
    label: '商品',
    icon: Box,
    items: [
      { id: 'items', label: '商品管理', description: '同步、发布并管理所有账号下的闲鱼商品。', icon: Box },
      { id: 'collector', label: '商品采集', description: '从全站商品、同行店铺与爆款雷达采集素材。', icon: Radar },
      { id: 'library', label: '本地资源库', description: '保存商品模板和图片，批量发布到多个账号。', icon: Library },
    ],
  },
  {
    key: 'orders',
    label: '订单',
    icon: ShoppingBag,
    items: [
      { id: 'orders', label: '订单管理', description: '查看交易记录、同步订单并执行发货。', icon: ShoppingBag },
    ],
  },
  {
    key: 'stores',
    label: '店铺',
    icon: Store,
    items: [
      { id: 'accounts', label: '账号管理', description: '管理闲鱼账号授权、运行状态和自动化开关。', icon: Users },
    ],
  },
  {
    key: 'service',
    label: '客服',
    icon: MessageCircleMore,
    items: [
      { id: 'chat', label: '在线聊天', description: '查看实时买家会话并发送文字、图片和商品卡片。', icon: MessageCircleMore },
    ],
  },
  {
    key: 'analytics',
    label: '统计',
    icon: TrendingUp,
    items: [
      { id: 'sales', label: '销售统计', description: '按日期范围查看销售额、已收货款和退货货款。', icon: TrendingUp },
    ],
  },
  {
    key: 'configuration',
    label: '配置',
    icon: Settings,
    items: [
      { id: 'delivery-templates', label: '发货模板', description: '组合可复用的文字、图片和变量消息。', icon: FileStack },
      { id: 'rules', label: '自动化规则', description: '配置交易自动化、关键词回复和 AI 客服。', icon: Zap },
      { id: 'notifications', label: '通知管理', description: '配置账号异常和自动化结果通知渠道。', icon: Bell },
      { id: 'logs', label: '运行日志', description: '查看接口、平台与后台子系统的运行日志。', icon: ScrollText, adminOnly: true },
      { id: 'settings', label: '系统设置', description: '维护日志、AI 模型、安全与通知参数。', icon: Settings, adminOnly: true },
    ],
  },
];

/** ConsoleRouteMeta 描述顶栏当前页面所需的分组、标题和说明。 */
export interface ConsoleRouteMeta {
  /** group 是页面所属菜单分组名称。 */
  group: string;
  /** label 是页面标题。 */
  label: string;
  /** description 是页面用途说明。 */
  description: string;
}

/** isConsoleEntryVisible 判断当前会话是否允许看到该导航入口。 */
export const isConsoleEntryVisible = (entry: ConsoleNavEntry, isAdmin: boolean): boolean => !entry.adminOnly || isAdmin;

/** visibleConsoleGroups 返回当前权限下可渲染的分组，并保留入口原始顺序。 */
export const visibleConsoleGroups = (isAdmin: boolean): ConsoleNavGroup[] => consoleNavigationGroups
  .map(/* group 是当前待过滤的菜单分组。 */ group => ({
    ...group,
    items: group.items.filter(/* entry 是分组内的单个页面入口。 */ entry => isConsoleEntryVisible(entry, isAdmin)),
  }))
  .filter(/* group 只保留至少有一个可见入口的分组。 */ group => group.items.length > 0);

/** findConsoleEntry 在可见导航中查找页面入口，未知标识返回首页。 */
export const findConsoleEntry = (activeTab: string, isAdmin: boolean): ConsoleNavEntry => {
  // allEntries 是首页与当前权限下所有分组的页面入口集合。
  const allEntries = [consoleHomeEntry, ...visibleConsoleGroups(isAdmin).flatMap(/* group 取分组内入口。 */ group => group.items)];
  return allEntries.find(/* entry 按路由标识匹配当前页面。 */ entry => entry.id === activeTab) ?? consoleHomeEntry;
};

/** findConsoleRouteMeta 返回顶栏面包屑使用的分组、标题和说明。 */
export const findConsoleRouteMeta = (activeTab: string, isAdmin: boolean): ConsoleRouteMeta => {
  // entry 是当前页面对应的导航入口。
  const entry = findConsoleEntry(activeTab, isAdmin);
  if (entry.id === consoleHomeEntry.id) {
    return { group: '主页', label: entry.label, description: entry.description };
  }
  // group 是包含当前入口的可见菜单分组。
  const group = visibleConsoleGroups(isAdmin).find(/* candidate 检查分组是否包含当前入口。 */ candidate =>
    candidate.items.some(/* item 按路由标识匹配当前页面。 */ item => item.id === entry.id),
  );
  return { group: group?.label ?? '主页', label: entry.label, description: entry.description };
};
