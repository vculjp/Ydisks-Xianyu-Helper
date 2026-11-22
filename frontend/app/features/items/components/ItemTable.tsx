import { Copy,MoreHorizontal,ShoppingBag } from 'lucide-react';
import React,{ useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import type { Item,ItemAIOverride,ShippingRule } from '../api';
import { notify } from '../../../../shared/ui/feedback';
import { countTriggerRules } from '../ruleCoverage';
import { itemShelfState } from '../itemShelfState';
import { itemBargainEnabled } from '../itemBargainState';
import type { ItemRuleTrigger } from '../types';

/** itemSelectionKey 生成勾选状态使用的商品唯一键，避免不同账号存在相同商品 ID 时互相覆盖。 */
export const itemSelectionKey = (item: Pick<Item, 'cookie_id' | 'item_id'>): string => `${item.cookie_id}:${item.item_id}`;

/** formatItemMetric 展示平台返回的非负整数，真实零保留为 0，缺失或无效统计显示参考页的占位符。 */
const formatItemMetric = (value?: number): string => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '—';

/** itemMetricAvailable 判断统计值是否可用于高亮展示，避免把缺失值渲染成真实数据。 */
const itemMetricAvailable = (value?: number): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** formatItemTime 只格式化数据库中明确返回的时间，缺失或无效时间统一显示占位符。 */
const formatItemTime = (value?: string): string => {
  // raw 是去掉首尾空白后的数据库时间文本。
  const raw = String(value || '').trim();
  if (!raw) return '—';
  // normalized 兼容 SQLite 的 "YYYY-MM-DD HH:MM:SS" 与 ISO 的 "T" 分隔符。
  const normalized = raw.replace('T', ' ');
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized;
};

/** ItemTableProps 描述商品列表视图需要的数据与回调。 */
export interface ItemTableProps {
  /** items 是当前页要展示的商品行。 */
  items: Item[];
  /** rules 是全部自动化规则，用于计算每个商品的规则覆盖情况。 */
  rules: ShippingRule[];
  /** accountNickname 把账号标识转换为展示昵称。 */
  accountNickname: (cookieId: string) => string;
  /** formatPrice 把商品价格转换为展示文本。 */
  formatPrice: (price?: string) => string;
  /** aiStatusText 是商品级 AI 三态对应的展示文本。 */
  aiStatusText: Record<ItemAIOverride, string>;
  /** selectedKeys 保存当前勾选的商品唯一键。 */
  selectedKeys: ReadonlySet<string>;
  /** onToggleSelection 切换单行商品的勾选状态。 */
  onToggleSelection: (item: Item) => void;
  /** allPageSelected 表示当前页所有商品均已勾选。 */
  allPageSelected: boolean;
  /** onToggleAll 切换当前页全部商品的勾选状态。 */
  onToggleAll: () => void;
  /** onConfigureDelivery 打开该商品的发货规则配置。 */
  onConfigureDelivery: (item: Item, trigger?: ItemRuleTrigger) => void;
  /** onOpenAISettings 打开该商品的 AI 客服配置。 */
  onOpenAISettings: (item: Item) => void;
  /** onEdit 打开商品编辑页。 */
  onEdit: (item: Item) => void;
  /** onSetShelf 在用户确认后请求单件商品上下架。 */
  onSetShelf: (item: Item) => void;
  /** onToggleBargain 在用户确认后请求切换单件商品的“2 人小刀”。 */
  onToggleBargain: (item: Item, enabled: boolean) => void;
  /** onRefreshMetrics 由用户显式读取单件商品的最新浏览和想要统计。 */
  onRefreshMetrics: (item: Item) => void;
  /** remoteItemBusy 指示当前平台正在处理的商品，避免重复操作。 */
  remoteItemBusy: string | null;
  /** onDelete 删除商品。 */
  onDelete: (item: Item) => void;
  /** emptyText 是没有商品时的提示文案。 */
  emptyText: string;
}

/** ProductSwitch 渲染参考商品页的开关外观，禁用态用于明确尚未接入的后端能力。 */
const ProductSwitch: React.FC<{
  /** on 表示开关是否处于开启状态。 */
  on: boolean;
  /** label 是开关右侧的状态文案。 */
  label: string;
  /** disabled 表示当前开关不可操作。 */
  disabled?: boolean;
  /** title 是不可操作时向用户解释原因。 */
  title?: string;
  /** onClick 是可用开关的点击回调。 */
  onClick?: () => void;
  /** ariaLabel 是屏幕阅读器使用的操作名称。 */
  ariaLabel?: string;
}> = ({ on, label, disabled = false, title, onClick, ariaLabel }) => (
  <span className={`product-switch ${on ? 'is-on' : ''} ${disabled ? 'is-disabled' : ''}`} title={title}>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel || label}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onClick}
      className="product-switch-control"
    >
      <span className="product-switch-track" aria-hidden="true" />
    </button>
    <span>{label}</span>
  </span>
);

/** RowMenuState 保存“更多”浮层的锚点位置，浮层通过 portal 渲染避免被表格滚动容器裁切。 */
interface RowMenuState {
  /** item 是当前浮层对应的商品。 */
  item: Item;
  /** left 是浮层相对视口的左偏移。 */
  left: number;
  /** top 是浮层相对视口的上偏移。 */
  top: number;
}

/** MENU_WIDTH 是参考页“更多”浮层的固定宽度。 */
const MENU_WIDTH = 152;
/** MENU_HEIGHT 是浮层大致高度，用于判断向下或向上展开。 */
const MENU_HEIGHT = 300;

/** ItemTable 以参考商家后台的列结构展示商品，并保留现有真实操作入口。 */
const ItemTable: React.FC<ItemTableProps> = ({
  items, rules, accountNickname, formatPrice, aiStatusText, selectedKeys, onToggleSelection, allPageSelected, onToggleAll,
  onConfigureDelivery, onOpenAISettings, onEdit, onSetShelf, onToggleBargain, onRefreshMetrics, remoteItemBusy, onDelete, emptyText,
}) => {
  /** headerCheckboxRef 指向表头复选框，用于展示跨行勾选的半选状态。 */
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  /** menuRef 指向已打开的“更多”浮层，用于判断点击是否发生在浮层外部。 */
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** rowMenu 保存当前打开的“更多”浮层；null 表示没有浮层。 */
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  /** somePageSelected 表示当前页至少有一件商品被勾选。 */
  const somePageSelected = items.some(/* item 判断是否命中当前勾选集合。 */ item => selectedKeys.has(itemSelectionKey(item)));

  useEffect(/* 当前副作用同步表头复选框的 indeterminate 视觉状态。 */ () => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = somePageSelected && !allPageSelected;
  }, [somePageSelected, allPageSelected]);

  useEffect(/* 页码或筛选变化导致行集合变化时关闭旧浮层，避免浮层指向已不存在的行。 */ () => {
    setRowMenu(null);
  }, [items]);

  useEffect(/* 浮层打开后监听外部点击、Esc、滚动和窗口缩放，保持与参考页一致的关闭行为。 */ () => {
    if (!rowMenu) return;
    /** closeOnPointerDown 关闭点击浮层外部触发的菜单。 */
    const closeOnPointerDown = (event: PointerEvent) => {
      // target 是本次点击的真实 DOM 节点。
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-row-menu-trigger]')) return;
      setRowMenu(null);
    };
    /** closeOnKeyDown 支持按 Esc 关闭浮层。 */
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRowMenu(null);
    };
    /** closeOnViewportChange 在滚动或缩放后关闭浮层，避免浮层与触发行错位。 */
    const closeOnViewportChange = () => setRowMenu(null);
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnKeyDown);
    window.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);
    menuRef.current?.querySelector('button')?.focus({ preventScroll: true });
    return /* 浮层关闭后释放全部全局监听。 */ () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnKeyDown);
      window.removeEventListener('scroll', closeOnViewportChange, true);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [rowMenu]);

  /** copyItemId 把商品 ID 写入剪贴板，方便用户到闲鱼后台核对同一件商品。 */
  const copyItemId = async (item: Item): Promise<void> => {
    try {
      await navigator.clipboard.writeText(item.item_id);
      notify('success', `商品 ID ${item.item_id} 已复制`);
    } catch {
      notify('error', '复制失败，请检查浏览器剪贴板权限');
    }
  };

  /** openRowMenu 以触发行按钮的位置计算浮层坐标，空间不足时向上展开。 */
  const openRowMenu = (item: Item, anchor: HTMLButtonElement) => {
    // rect 是“更多”按钮当前的视口矩形。
    const rect = anchor.getBoundingClientRect();
    // left 是浮层左偏移，始终保持在视口内。
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    // top 是浮层上偏移，优先向下展开。
    const top = rect.bottom + 6 + MENU_HEIGHT <= window.innerHeight
      ? rect.bottom + 6
      : Math.max(8, rect.top - MENU_HEIGHT - 6);
    setRowMenu({ item, left, top });
  };

  /** runRowAction 执行浮层中的一项操作，并先关闭浮层再交给既有业务回调。 */
  const runRowAction = (action: () => void) => {
    setRowMenu(null);
    action();
  };

  if (items.length === 0) return <div className="product-table-empty"><ShoppingBag aria-hidden="true" /><strong>{emptyText}</strong><span>可切换店铺、标签页或清空搜索条件后重试。</span></div>;

  return (
    <div className="product-table-wrap">
      <table className="product-table">
        <thead>
          <tr>
            <th className="is-check">
              <input
                ref={headerCheckboxRef}
                type="checkbox"
                className="product-checkbox"
                aria-label="选择本页全部商品"
                checked={allPageSelected}
                onChange={onToggleAll}
              />
            </th>
            <th>ID</th>
            <th>店铺</th>
            <th>商品信息</th>
            <th className="is-center">商品售价</th>
            <th className="is-center" title="详情刷新不提供曝光；仅列表同步可能缓存平台明确返回值，缺失时请到闲鱼卖家后台查看">曝光</th>
            <th className="is-center">浏览</th>
            <th className="is-center">想要</th>
            <th className="is-center">自动发货</th>
            <th className="is-center">售罄自动上架</th>
            <th className="is-center">2 人小刀</th>
            <th className="is-center" title="本地首次同步该商品的时间，不是闲鱼平台发布时间">发布日期</th>
            <th className="is-center" title="本地最近一次同步或修改该商品的时间">更新时间</th>
            <th className="is-center">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map(/* item 是当前行对应的商品。 */ item => {
            /** deliveryCount 是该商品生效的付款后自动发货规则条数。 */
            const deliveryCount = countTriggerRules(item, 'order_paid', rules);
            /** bargainEnabled 是该商品在闲鱼平台是否已开启“2 人小刀”。 */
            const bargainEnabled = itemBargainEnabled(item);
            /** shelfState 只使用平台已确认的上下架回执，未知状态不猜测。 */
            const shelfState = itemShelfState(item);
            /** menuOpen 表示当前行的“更多”浮层处于打开状态。 */
            const menuOpen = rowMenu !== null && itemSelectionKey(rowMenu.item) === itemSelectionKey(item);
            return (
              <tr key={itemSelectionKey(item)} className={selectedKeys.has(itemSelectionKey(item)) ? 'is-selected' : ''}>
                <td className="is-check">
                  <input
                    type="checkbox"
                    className="product-checkbox"
                    aria-label={`选择商品：${item.item_title || item.item_id}`}
                    checked={selectedKeys.has(itemSelectionKey(item))}
                    onChange={/* 当前回调切换该行商品的批量操作勾选状态。 */ () => onToggleSelection(item)}
                  />
                </td>
                <td className="product-id-cell" title={item.item_id}>{item.item_id}</td>
                <td className="product-store-cell" title={accountNickname(item.cookie_id)}>{accountNickname(item.cookie_id)}</td>
                <td>
                  <div className="product-info-cell">
                    <span className="product-thumb">
                      {item.item_image
                        ? <img src={item.item_image} alt="" loading="lazy" />
                        : <ShoppingBag aria-hidden="true" />}
                    </span>
                    <span className="product-info-text">
                      <button
                        type="button"
                        className="product-title product-title-button"
                        title={item.item_title}
                        onClick={/* 参考页商品标题可直接进入编辑页。 */ () => onEdit(item)}
                      >
                        {item.item_title || '未命名商品'}
                      </button>
                      <span className="product-subline">
                        商品ID {item.item_id}
                        <button type="button" onClick={/* 复制商品 ID 便于到闲鱼后台核对。 */ () => void copyItemId(item)} className="product-copy-id" aria-label={`复制商品 ID：${item.item_title || item.item_id}`}>
                          <Copy aria-hidden="true" />
                        </button>
                      </span>
                      <span className={`product-shelf-note ${shelfState === 'off' ? 'is-off' : ''}`}>
                        {shelfState === 'off' ? '已下架（平台确认）' : shelfState === 'on' ? '已上架（平台确认）' : '货架状态未核实'}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="is-center">
                  <span className="product-price">{formatPrice(item.item_price)}</span>
                  {bargainEnabled && <small className="product-bargain-price">已开启 2 人小刀</small>}
                </td>
                <td className="is-center"><span className={`product-metric ${itemMetricAvailable(item.exposure_count) ? 'has-value' : ''}`} title={item.exposure_count === undefined ? '详情刷新不提供曝光；仅列表同步可能缓存平台明确返回值，缺失时请到闲鱼卖家后台查看' : '最近一次列表同步缓存的曝光数量，非实时数据'}>{formatItemMetric(item.exposure_count)}</span></td>
                <td className="is-center"><span className={`product-metric ${itemMetricAvailable(item.browse_count) ? 'has-value' : ''}`} title={item.browse_count === undefined ? '尚未读取浏览数据，可点击“更多”中的“刷新指标”' : '最近一次读取的浏览数量，非实时数据'}>{formatItemMetric(item.browse_count)}</span></td>
                <td className="is-center"><span className={`product-metric ${itemMetricAvailable(item.want_count) ? 'has-value' : ''}`} title={item.want_count === undefined ? '尚未读取想要人数，可点击“更多”中的“刷新指标”' : '最近一次读取的想要人数，非实时数据'}>{formatItemMetric(item.want_count)}</span></td>
                <td className="is-center">
                  <ProductSwitch
                    on={deliveryCount > 0}
                    label={deliveryCount > 0 ? '开启' : '关闭'}
                    onClick={/* 点击自动发货开关进入付款后发货规则。 */ () => onConfigureDelivery(item, 'order_paid')}
                    ariaLabel={`配置发货规则：${item.item_title || item.item_id}`}
                  />
                </td>
                <td className="is-center">
                  <ProductSwitch on={false} label="未接入" disabled title="当前后端未提供售罄自动上架能力" ariaLabel={`售罄自动上架：${item.item_title || item.item_id}`} />
                </td>
                <td className="is-center">
                  <ProductSwitch
                    on={bargainEnabled}
                    label={bargainEnabled ? '开启' : '关闭'}
                    disabled={remoteItemBusy !== null}
                    title={bargainEnabled ? '点击关闭该商品在闲鱼的 2 人小刀' : '点击开启该商品在闲鱼的 2 人小刀'}
                    onClick={/* 切换小刀开关，先由页面层弹窗确认。 */ () => onToggleBargain(item, !bargainEnabled)}
                    ariaLabel={`2 人小刀状态：${item.item_title || item.item_id}`}
                  />
                </td>
                <td className="is-center"><span className="product-time">{formatItemTime(item.created_at)}</span></td>
                <td className="is-center"><span className="product-time">{formatItemTime(item.updated_at)}</span></td>
                <td className="is-center">
                  <button
                    type="button"
                    className={`product-more-button ${menuOpen ? 'is-open' : ''}`}
                    data-row-menu-trigger
                    aria-label={`更多操作：${item.item_title || item.item_id}`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={/* 以当前按钮为锚点打开与参考页一致的行操作浮层。 */ event => openRowMenu(item, event.currentTarget)}
                  >
                    更多<MoreHorizontal aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rowMenu && createPortal(
        <div
          ref={menuRef}
          className="product-actions-pop"
          role="menu"
          aria-label={`商品操作：${rowMenu.item.item_title || rowMenu.item.item_id}`}
          style={{ left: rowMenu.left, top: rowMenu.top }}
        >
          <button type="button" role="menuitem" onClick={/* 行菜单的配置发货固定进入付款后发货规则。 */ () => runRowAction(() => onConfigureDelivery(rowMenu.item, 'order_paid'))} aria-label={`配置发货规则：${rowMenu.item.item_title || rowMenu.item.item_id}`}>配置发货</button>
          <button
            type="button"
            role="menuitem"
            disabled={remoteItemBusy !== null}
            onClick={/* 由用户显式读取该商品最新浏览和想要人数，只请求当前一行。 */ () => runRowAction(() => onRefreshMetrics(rowMenu.item))}
            aria-label={`刷新商品指标：${rowMenu.item.item_title || rowMenu.item.item_id}`}
          >
            刷新指标
          </button>
          <button type="button" role="menuitem" onClick={/* 打开商品编辑页。 */ () => runRowAction(() => onEdit(rowMenu.item))} aria-label="编辑">编辑商品</button>
          <button type="button" role="menuitem" onClick={/* 打开该商品的 AI 客服配置。 */ () => runRowAction(() => onOpenAISettings(rowMenu.item))} aria-label={`配置商品 AI 客服：${rowMenu.item.item_title || rowMenu.item.item_id}`}>
            AI 客服（{aiStatusText[rowMenu.item.ai_override || 'inherit']}）
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={remoteItemBusy !== null}
            onClick={/* 要求用户确认当前商品上下架。 */ () => runRowAction(() => onSetShelf(rowMenu.item))}
            aria-label={`${itemShelfState(rowMenu.item) === 'off' ? '上架' : '下架'}商品：${rowMenu.item.item_title || rowMenu.item.item_id}`}
          >
            {itemShelfState(rowMenu.item) === 'off' ? '上架宝贝' : '下架宝贝'}
          </button>
          <button type="button" role="menuitem" onClick={/* 复制商品 ID。 */ () => runRowAction(() => void copyItemId(rowMenu.item))} aria-label={`复制商品 ID：${rowMenu.item.item_title || rowMenu.item.item_id}`}>复制商品 ID</button>
          <button type="button" role="menuitem" className="is-danger" onClick={/* 删除商品。 */ () => runRowAction(() => onDelete(rowMenu.item))} aria-label="删除">删除商品</button>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default ItemTable;
