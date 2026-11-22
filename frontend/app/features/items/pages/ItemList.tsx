import { ArrowRight,Bot,Box,CheckCircle2,CircleDashed,Edit,Link2,LocateFixed,PackagePlus,Plus,RefreshCw,Search,ShoppingBag,Trash2,UploadCloud,User,X } from 'lucide-react';
import React,{ Suspense,useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import type { AccountDetail,Item,ItemAIOverride,ItemAISettings,PublishLocation,ShippingRule } from '../api';
import {
deleteItem,
getAccountDetails,
getItemPublishBatches,
getItems,
getShippingRules,
refreshItemMetrics,
} from '../api';
import { batchStatusClass,batchStatusText,toBatchFallbackCategory } from '../batchState';
import { BatchPhaseIndicator } from '../components/BatchPhaseIndicator';
import { CategoryCandidatePicker } from '../components/CategoryCandidatePicker';
import ItemTable,{ itemSelectionKey } from '../components/ItemTable';
import { ManualLocationPicker } from '../components/ManualLocationPicker';
import { consumeSelectedFile } from '../../../../shared/browser/fileInput';
import { saveLastPublishLocation } from '../../../../shared/browser/publishLocationPreference';
import { useItemPublishBatch } from '../hooks';
import { useItemActions } from '../itemActions';
import { itemShelfState } from '../itemShelfState';
import { readItemAccountPreference, saveItemAccountPreference, validItemAccountPreference } from '../accountSelectionPreference';
import { itemHasTrigger,matchesRuleCoverageFilter,paginateItems,TRADE_AUTOMATION_TRIGGERS,type RuleCoverageFilter } from '../ruleCoverage';
import type { ItemListProps } from '../types';
import { AsyncStateView,confirmAction,notify } from '../../../../shared/ui/feedback';

// formatItemPrice 将商品价格转换为本地化展示文本。
const formatItemPrice = (price?: string) => {
  // value 值。
  const value = String(price || '').trim();
  if (!value) return '-';
  return /^[¥￥]/.test(value) ? value : `¥${value}`;
};

// publishLocationText 将已确认的高德省市区与可选地点合并显示，避免多个发布入口重复拼接。
const publishLocationText = (location: PublishLocation): string => [location.province, location.city, location.area, location.poi_name].filter(Boolean).join(' ');

// ITEM_VIEW_MODE_KEY 是浏览器本地保存商品页视图偏好的存储键，只属于当前浏览器，不写入服务端。
const ITEM_VIEW_MODE_KEY = 'ydisks.items.view_mode';
// AUTO_SYNC_STORAGE_PREFIX 记录每个账号最近一次自动列表同步时间，避免每次打开页面都请求闲鱼。
const AUTO_SYNC_STORAGE_PREFIX = 'ydisks.items.auto_sync.';
// AUTO_METRICS_STORAGE_PREFIX 记录每个账号最近一次自动指标刷新时间，避免重复扇出详情请求。
const AUTO_METRICS_STORAGE_PREFIX = 'ydisks.items.auto_metrics.';
// AUTO_SYNC_INTERVAL_MS 是打开商品页时自动同步列表的最小间隔。
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
// AUTO_METRICS_INTERVAL_MS 是打开商品页时自动刷新本页指标的最小间隔。
const AUTO_METRICS_INTERVAL_MS = 10 * 60 * 1000;
// AUTO_METRICS_MAX_ITEMS 限制一次自动刷新最多读取的商品数，避免大页尺寸触发过多平台详情请求。
const AUTO_METRICS_MAX_ITEMS = 20;

// ItemViewMode 是商品页的两种展示模式：卡片或列表。
type ItemViewMode = 'card' | 'list';

// ItemStatusTab 在参考商品状态标签外保留全部商品入口，未知货架状态不推断为在售。
type ItemStatusTab = 'all' | 'active' | 'hidden' | 'sold' | 'configured' | 'unconfigured' | 'scheduled';

// ITEM_STATUS_TABS 保留参考状态标签，并提供原有全部商品视图。
const ITEM_STATUS_TABS: ReadonlyArray<{
  /** key 是标签页的稳定状态标识。 */
  key: ItemStatusTab;
  /** label 是标签页展示的中文文案。 */
  label: string;
}> = [
  { key: 'all', label: '全部商品' },
  { key: 'active', label: '出售中的商品' },
  { key: 'hidden', label: '已下架的商品' },
  { key: 'sold', label: '已经售罄商品' },
  { key: 'configured', label: '已配置发货' },
  { key: 'unconfigured', label: '未配置发货' },
  { key: 'scheduled', label: '定时上架商品' },
];

// itemMatchesStatusTab 将标签页映射到现有真实字段；缺失指标的状态返回空列表而不伪造数据。
const itemMatchesStatusTab = (item: Item, tab: ItemStatusTab, rules: ShippingRule[]): boolean => {
  if (tab === 'all') return true;
  if (tab === 'active') return itemShelfState(item) === 'on';
  if (tab === 'hidden') return itemShelfState(item) === 'off';
  if (tab === 'sold' || tab === 'scheduled') return false;
  // configured 只统计付款后发货，评价赠品或拍下改价不代表已配置自动发货。
  const configured = itemHasTrigger(item, 'order_paid', rules);
  return tab === 'configured' ? configured : !configured;
};

// readItemViewMode 读取上次选择的视图模式；存储不可用或没有偏好时默认使用参考控制台的列表模式。
const readItemViewMode = (): ItemViewMode => {
  try {
    return window.localStorage.getItem(ITEM_VIEW_MODE_KEY) === 'card' ? 'card' : 'list';
  } catch {
    return 'list';
  }
};

// itemAIStatusText 将商品级 AI 三态转换为卡片中的简短状态文本。
const itemAIStatusText: Record<ItemAIOverride, string> = {
  inherit: '继承账号',
  enabled: '已启用',
  disabled: '已停用',
};

// itemAIStatusClass 将商品级 AI 三态转换为卡片入口的颜色样式。
const itemAIStatusClass: Record<ItemAIOverride, string> = {
  inherit: 'bg-gray-100 text-gray-600 hover:bg-gray-200',
  enabled: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  disabled: 'bg-red-50 text-red-700 hover:bg-red-100',
};

// ItemList 渲染商品列表组件。
const ItemList: React.FC<ItemListProps> = ({ onConfigureDelivery, publishImagesEditor: ImagesEditor, publishSpecsEditor: SpecsEditor, itemAISettingsModal: ItemAISettingsModal, itemEditorPage: ItemEditorPage, libraryImagePicker: LibraryPicker }) => {
  // libraryPickerOpen 表示单品发布的图片库选择器是否打开，属于瞬时 UI 状态。
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  // [items, 解构得到当前 Hook 返回的状态和操作函数。
  const [items, setItems] = useState<Item[]>([]);
  // initialLoading 表示商品、账号、规则首屏数据是否仍在读取。
  const [initialLoading, setInitialLoading] = useState(true);
  // loadError 保存首屏核心数据读取失败的可见说明；空字符串表示最近一次读取成功。
  const [loadError, setLoadError] = useState('');
  // retryGeneration 是用户点击重试时递增的首屏读取代次。
  const [retryGeneration, setRetryGeneration] = useState(0);
  // [shippingRules, 解构得到当前 Hook 返回的状态和操作函数。
  const [shippingRules, setShippingRules] = useState<ShippingRule[]>([]);
  // [accounts, 解构得到当前 Hook 返回的状态和操作函数。
  const [accounts, setAccounts] = useState<AccountDetail[]>([]);
  // selectedAccount 是筛选、同步和发布共用的账号；初值恢复当前浏览器的上次选择。
  const [selectedAccount, setSelectedAccount] = useState<string>(readItemAccountPreference);
  // accountsReady 标记账号列表已经成功加载，用于校验是否存在过期的记忆账号。
  const [accountsReady, setAccountsReady] = useState(false);
  // ruleFilter 保存用户选择的交易自动化覆盖筛选，空串表示不筛选；可见商品由它与规则列表推导，不存副本。
  const [ruleFilter, setRuleFilter] = useState<RuleCoverageFilter>('');
  // viewMode 是用户选择的商品展示模式，初值读取本地偏好。
  const [viewMode, setViewMode] = useState<ItemViewMode>(readItemViewMode);
  // listPage 是列表模式的请求页码，渲染时会修正到合法范围；筛选变化时回到第一页。
  const [listPage, setListPage] = useState(1);
  // listPageSize 是参考页的每页条数，默认 15，可由底部分页器切换。
  const [listPageSize, setListPageSize] = useState(15);
  // pageJumpDraft 是分页器“前往 N 页”输入框的瞬时文本。
  const [pageJumpDraft, setPageJumpDraft] = useState('');
  // moreMenuOpen 控制批量操作条右侧“更多操作”菜单，收纳同步、发布等次级入口。
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // moreMenuRef 指向“更多操作”菜单容器，用于点击外部时收起菜单。
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  // searchDraft 是搜索框里的即时文本，点击查询或回车后才写入生效搜索词。
  const [searchDraft, setSearchDraft] = useState('');
  // appliedSearch 是当前列表真正用于匹配标题和商品 ID 的搜索词。
  const [appliedSearch, setAppliedSearch] = useState('');
  // itemStatusTab 默认展示全部商品，避免未核实货架状态的历史商品从首屏消失。
  const [itemStatusTab, setItemStatusTab] = useState<ItemStatusTab>('all');
  // selectedKeys 按账号与商品 ID 的复合键保存批量操作勾选，避免同名商品互相覆盖。
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  // bulkBusy 表示批量上下架或批量删除正在串行请求平台，期间禁止重复提交。
  const [bulkBusy, setBulkBusy] = useState(false);
  // metricsRefreshLabel 保存“已完成/总数”的本页指标刷新进度；null 表示当前没有刷新任务。
  const [metricsRefreshLabel, setMetricsRefreshLabel] = useState<string | null>(null);
  // metricsRefreshBusyRef 在 React 渲染前同步拦截重复点击，避免同一页并发读取平台详情。
  const metricsRefreshBusyRef = useRef(false);
  // autoSyncBusyRef 阻止自动同步与手动同步并发执行。
  const autoSyncBusyRef = useRef(false);
  // [itemAISettingsTarget, setItemAISettingsTarget] 保存当前打开商品级 AI 配置的商品。
  const [itemAISettingsTarget, setItemAISettingsTarget] = useState<Item | null>(null);
  // itemsRequestGeneration 标识商品列表最新一次读取，旧响应不得覆盖较新的同步或刷新结果。
  const itemsRequestGeneration = useRef(0);
  // shippingRulesRequestGeneration 标识发货规则最新一次读取，旧响应不得覆盖较新的规则配置。
  const shippingRulesRequestGeneration = useRef(0);
  // loadItems 刷新商品列表，供普通操作和批量任务完成后复用。
  const loadItems = useCallback(/* 当前回调封装可复用的交互处理逻辑。 */ async () => {
    // requestGeneration 是本次商品刷新请求的单调递增代次。
    const requestGeneration = ++itemsRequestGeneration.current;
    // itemsList 商品列表列表，负责当前功能中的对应处理。
    const itemsList = await getItems();
    if (requestGeneration === itemsRequestGeneration.current) setItems(itemsList);
  }, []);

  // loadShippingRules 刷新商品关联的自动化规则。
  const loadShippingRules = useCallback(/* 当前回调封装可复用的交互处理逻辑。 */ async () => {
    // requestGeneration 是本次规则刷新请求的单调递增代次。
    const requestGeneration = ++shippingRulesRequestGeneration.current;
    // rules 是当前规则读取返回的非敏感自动化规则集合。
    const rules = await getShippingRules();
    if (requestGeneration === shippingRulesRequestGeneration.current) setShippingRules(rules);
  }, []);

  // batchState 是 ItemList feature 提供的批量铺货状态和动作边界。
  const batchState = useItemPublishBatch({ selectedAccount, loadItems, loadShippingRules });
  // 解构数据 解构得到当前 Hook 返回的状态和操作函数。
  const {
    showBatchModal,
    batchLoading,
    batchPhase,
    batchFile,
    setBatchFile,
    batchImagesZip,
    setBatchImagesZip,
    batchCategoryKeyword,
    setBatchCategoryKeyword,
    batchCategoryLoading,
    batchCategoryCandidates,
    batchFallbackCategory,
    setBatchFallbackCategory,
    batchPreview,
    batchDetail,
    recentBatch,
    setRecentBatch,
    batchLocations,
    batchLocation,
    batchPublishIntervalSeconds,
    setBatchPublishIntervalSeconds,
    setBatchLocations,
    setBatchLocation,
    openBatchModal,
    handleRecommendBatchCategory,
    openRecentBatchResult,
    handlePreviewBatch,
    handleStartBatch,
    handleCancelBatch,
    abandonBatchPreview,
    closeBatchModal,
    handleRetryBatchFailed,
  } = batchState;

  // itemActions 商品 feature 提供普通商品操作、发布表单和定位动作。
  const itemActions = useItemActions({
    selectedAccount,
    setSelectedAccount,
    setItems,
    loadItems,
    loadShippingRules,
    onConfigureDelivery,
    setBatchLocations,
    setBatchLocation,
  });
  // 解构商品动作，保持页面 JSX 只负责布局和表单字段组合。
  const {
    loading,
    publishing,
    showEditModal,
    setShowEditModal,
    showAddModal,
    setShowAddModal,
    showPublishModal,
    setShowPublishModal,
    locationLoading,
    publishLocations,
    setPublishLocations,
    publishLocation,
    setPublishLocation,
    publishCategoryKeyword,
    setPublishCategoryKeyword,
    publishCategoryLoading,
    publishCategoryCandidates,
    publishCategory,
    setPublishCategory,
    selectedItem,
    editForm,
    setEditForm,
    addForm,
    setAddForm,
    publishForm,
    setPublishForm,
    publishImagePreviews,
    handleSync,
    handleEdit,
    handleSaveEdit,
    handleSaveRemoteEdit,
    handleRefreshItemMetrics,
    remoteItemBusy,
    handleSetShelf,
    handleToggleBargain,
    handleDelete,
    handleAddItem,
    handlePublishItem,
    handleRecommendPublishCategory,
    downloadPublishTemplate,
    openAddModal,
    openPublishModal,
    locateForPublish,
  } = itemActions;

  // ManualLocationTarget 表示手动地点选择完成后要回填的发布流程。
  type ManualLocationTarget = 'publish' | 'batch';
  // manualLocationTarget 保存当前手动地点弹窗服务的发布场景。
  const [manualLocationTarget, setManualLocationTarget] = useState<ManualLocationTarget | null>(null);
  // confirmManualLocation 把区县中心或可选 POI 写回发布表单并记住上次选择。
  const confirmManualLocation = useCallback(/* confirmManualLocationCallback 将已确认的高德发货地写入对应发布场景。 */ (location: PublishLocation) => {
    if (manualLocationTarget === 'publish') {
      setPublishLocations([location]);
      setPublishLocation(location);
    } else if (manualLocationTarget === 'batch') {
      setBatchLocations([location]);
      setBatchLocation(location);
    }
    saveLastPublishLocation(location);
    setManualLocationTarget(null);
  }, [manualLocationTarget, setBatchLocation, setBatchLocations, setPublishLocation, setPublishLocations]);

  useEffect(/* 当前回调同步 React 副作用和资源生命周期。 */ () => {
    // controller 取消组件卸载前仍在执行的首屏并行请求。
    const controller = new AbortController();
    // initialItemsGeneration、initialRulesGeneration 分别记录首屏请求对应的列表与规则代次。
    const initialItemsGeneration = ++itemsRequestGeneration.current;
    const initialRulesGeneration = ++shippingRulesRequestGeneration.current;
    // active 标识当前组件实例是否仍接受首屏响应。
    let active = true;
    setInitialLoading(true);
    setLoadError('');
    Promise.allSettled([
      getAccountDetails({ signal: controller.signal }),
      getItems(undefined, { signal: controller.signal }),
      getShippingRules({ signal: controller.signal }),
      getItemPublishBatches(20, { signal: controller.signal }),
    ]).then(/* 首屏并行请求完成后分别处理核心数据和可选批次结果。 */ results => {
      if (!active || controller.signal.aborted || initialItemsGeneration !== itemsRequestGeneration.current || initialRulesGeneration !== shippingRulesRequestGeneration.current) return;
      // accountResult、itemResult、ruleResult、batchResult 分别对应四个互不依赖的首屏请求。
      const [accountResult, itemResult, ruleResult, batchResult] = results;
      // failureMessages 保存核心数据失败时可展示的脱敏说明，不包含请求细节。
      const failureMessages: string[] = [];
      if (accountResult.status === 'fulfilled') {
        setAccounts(accountResult.value);
        setAccountsReady(true);
      } else {
        console.error('加载商品账号失败:', accountResult.reason);
        failureMessages.push('账号列表读取失败');
      }
      if (itemResult.status === 'fulfilled') {
        setItems(itemResult.value);
      } else {
        console.error('加载商品列表失败:', itemResult.reason);
        failureMessages.push(itemResult.reason instanceof Error && itemResult.reason.message ? itemResult.reason.message : '商品列表读取失败');
      }
      if (ruleResult.status === 'fulfilled') {
        setShippingRules(ruleResult.value);
      } else {
        console.error('加载发货规则失败:', ruleResult.reason);
        failureMessages.push('发货规则读取失败，商品仍可查看但规则覆盖状态可能不准确');
      }
      if (batchResult.status === 'fulfilled') {
        // recoverable 是可继续查看或恢复的最近批量任务。
        const recoverable = batchResult.value.find(/* 当前回调处理集合中的单个元素。 */ batch => ['running', 'canceling'].includes(batch.status))
          || batchResult.value.find(/* 当前回调处理集合中的单个元素。 */ batch => batch.status !== 'preview');
        setRecentBatch(recoverable || null);
      } else {
        console.error('加载最近批量任务失败:', batchResult.reason);
      }
      if (failureMessages.length > 0) setLoadError(failureMessages.join('；'));
    }).catch(/* 首屏聚合异常只转换为可见错误，不阻断页面生命周期。 */ error => {
      if (!active || controller.signal.aborted) return;
      console.error('加载商品配置失败:', error);
      setLoadError(error instanceof Error && error.message ? error.message : '商品配置加载失败，请稍后重试');
    }).finally(/* 首屏请求全部完成后结束加载占位。 */ () => {
      if (active && !controller.signal.aborted) setInitialLoading(false);
    });
    return /* 首屏请求清理回调在卸载时取消请求并阻止状态回写。 */ () => {
      active = false;
      controller.abort();
    };
  }, [retryGeneration]);

  // 选择账号时记住偏好，并回到商品列表第一页；自动同步由下方节流副作用统一执行。
  useEffect(/* persistAccountEffect 持久化唯一账号选择。 */ () => {
    saveItemAccountPreference(selectedAccount);
    setListPage(1);
  }, [selectedAccount]);

  // 首屏账号加载后校验记忆账号是否仍然存在；失效时回退到“全部账号（仅查看）”。
  useEffect(/* validateAccountEffect 清理已删除账号的旧偏好。 */ () => {
    if (!accountsReady) return;
    // validAccount 是当前账户列表中仍然有效的选择。
    const validAccount = validItemAccountPreference(selectedAccount, accounts.map(/* account 是可选账号。 */ account => account.id));
    if (validAccount !== selectedAccount) setSelectedAccount(validAccount);
  }, [accounts, accountsReady, selectedAccount]);

  // rulesForItem 规则列表For商品，负责当前功能中的对应处理。
  const rulesForItem = (item: Item) => shippingRules.filter(/* 当前回调处理集合中的单个元素。 */ rule =>
    rule.cookie_id === item.cookie_id && rule.item_id === item.item_id
  ).length > 0
    ? shippingRules.filter(/* 当前回调处理集合中的单个元素。 */ rule => rule.cookie_id === item.cookie_id && rule.item_id === item.item_id)
    : shippingRules.filter(/* 当前回调处理集合中的单个元素。 */ rule => rule.cookie_id === item.cookie_id && !rule.item_id);

  // accountMap 账号索引。
  const accountMap = useMemo(
    /* 当前回调处理集合中的单个元素。 */ () => new Map(accounts.map(/* 当前回调处理集合中的单个元素。 */ account => [account.id, account])),
    [accounts],
  );
  // visibleItems 同时应用店铺、规则、搜索词和顶部状态标签，所有筛选都基于真实列表数据。
  const visibleItems = useMemo(/* 统一计算店铺、规则、搜索和状态标签后的可见商品。 */ () => {
    // keyword 是归一化后的搜索词，只匹配商品标题和商品 ID。
    const keyword = appliedSearch.trim().toLowerCase();
    return items.filter(/* item 是待判断的商品。 */ item => {
      if (selectedAccount && item.cookie_id !== selectedAccount) return false;
      if (!matchesRuleCoverageFilter(item, ruleFilter, shippingRules)) return false;
      if (!itemMatchesStatusTab(item, itemStatusTab, shippingRules)) return false;
      if (!keyword) return true;
      return `${item.item_title || ''} ${item.item_id}`.toLowerCase().includes(keyword);
    });
  }, [appliedSearch, itemStatusTab, items, ruleFilter, selectedAccount, shippingRules]);
  // pagedItems 是列表模式当前页的分页结果，由可见商品与页码推导。
  const pagedItems = useMemo(/* 按请求页码和每页条数切分可见商品。 */ () => paginateItems(visibleItems, listPage, listPageSize), [visibleItems, listPage, listPageSize]);
  // 每页条数变化后回到第一页，避免停留在切换前的空页。
  useEffect(/* 当前副作用在分页大小变化时重置页码。 */ () => {
    setListPage(1);
  }, [listPageSize]);
  // “更多操作”菜单打开时监听外部点击和 Esc，点击菜单内按钮后立即收起。
  useEffect(/* 当前副作用管理批量操作条右上角菜单的关闭行为。 */ () => {
    if (!moreMenuOpen) return;
    /** closeMoreOnPointerDown 收起点击菜单外部触发的次级菜单。 */
    const closeMoreOnPointerDown = (event: PointerEvent) => {
      // target 是本次点击的真实 DOM 节点。
      const target = event.target as Node | null;
      if (target && moreMenuRef.current?.contains(target)) return;
      setMoreMenuOpen(false);
    };
    /** closeMoreOnKeyDown 支持按 Esc 收起次级菜单。 */
    const closeMoreOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeMoreOnPointerDown);
    window.addEventListener('keydown', closeMoreOnKeyDown);
    return /* 菜单关闭后释放全局监听。 */ () => {
      window.removeEventListener('pointerdown', closeMoreOnPointerDown);
      window.removeEventListener('keydown', closeMoreOnKeyDown);
    };
  }, [moreMenuOpen]);
  // selectedItems 只保留当前筛选结果中仍可见的勾选商品，批量操作不会影响被筛选隐藏的行。
  const selectedItems = useMemo(/* 按当前勾选键过滤可见商品。 */ () => visibleItems.filter(/* item 检查是否被勾选。 */ item => selectedKeys.has(itemSelectionKey(item))), [visibleItems, selectedKeys]);
  // allPageSelected 表示当前页所有商品都已勾选，供表头复选框和批量按钮使用。
  const allPageSelected = pagedItems.rows.length > 0 && pagedItems.rows.every(/* item 检查当前页每一行是否已勾选。 */ item => selectedKeys.has(itemSelectionKey(item)));

  // refreshVisibleMetrics 按当前页顺序读取浏览和想要统计；all 为 true 时刷新整页，否则只补齐缺失项。
  const refreshVisibleMetrics = useCallback(/* 当前回调串行刷新本页指标，失败立即停止。 */ async (options?: { all?: boolean }) => {
    if (metricsRefreshBusyRef.current) return;
    if (remoteItemBusy || loading || bulkBusy) {
      notify('info', '当前有商品操作正在进行，请稍后再刷新指标');
      return;
    }
    // targets 在自动模式下受最大商品数限制，手动模式只包含缺少浏览或想要数据的当前页商品。
    const targets = options?.all
      ? pagedItems.rows.slice(0, AUTO_METRICS_MAX_ITEMS)
      : pagedItems.rows.filter(/* item 判断是否仍缺少至少一项可读取指标。 */ item =>
        item.browse_count === undefined || item.want_count === undefined);
    if (targets.length === 0) {
      if (!options?.all) notify('info', '本页商品已有浏览和想要数据');
      return;
    }
    metricsRefreshBusyRef.current = true;
    setMetricsRefreshLabel(`0/${targets.length}`);
    // updated 记录本次已经成功写回列表的商品数，失败提示会给出准确进度。
    let updated = 0;
    try {
      for (let /* index 是当前串行刷新的商品下标，保证每次只触发一次平台请求。 */ index = 0; index < targets.length; index += 1) {
        // refreshed 是本次单件详情读取并保存后返回的完整商品行。
        const refreshed = await refreshItemMetrics(targets[index].cookie_id, targets[index].item_id);
        setItems(/* current 是当前商品列表。 */ current => current.map(/* currentItem 是待比较的列表商品。 */ currentItem =>
          currentItem.cookie_id === refreshed.cookie_id && currentItem.item_id === refreshed.item_id
            ? { ...currentItem, ...refreshed } : currentItem,
        ));
        updated += 1;
        setMetricsRefreshLabel(`${updated}/${targets.length}`);
        if (index < targets.length - 1) {
          await new Promise(/* 页面内也保留至少 2.2 秒间隔，与服务端账号节流一致。 */ resolve => {
            window.setTimeout(resolve, 2200);
          });
        }
      }
      notify('success', `已更新 ${updated} 件商品的浏览和想要数据；曝光需在闲鱼卖家后台查看`);
    } catch (/* error 是平台拒绝、会话失效或本地保存失败的原因，不自动重试后续商品。 */ error: unknown) {
      notify('error', `指标刷新在 ${updated}/${targets.length} 件后停止：${error instanceof Error && error.message ? error.message : '请检查账号状态后重试'}`);
    } finally {
      metricsRefreshBusyRef.current = false;
      setMetricsRefreshLabel(null);
    }
  }, [bulkBusy, loading, pagedItems.rows, remoteItemBusy, setItems]);

  // 打开商品页时自动同步当前账号列表；每个账号五分钟内最多一次，避免普通浏览触发重复平台请求。
  useEffect(/* autoSyncOnOpen 在首屏账号就绪后执行一次受节流保护的列表同步。 */ () => {
    if (initialLoading || !accountsReady || !selectedAccount || autoSyncBusyRef.current) return;
    if (!accounts.some(/* account 检查记忆账号是否仍然存在。 */ account => account.id === selectedAccount)) return;
    // storageKey 是当前账号最近一次自动同步时间，浏览器禁写时按未同步处理。
    const storageKey = `${AUTO_SYNC_STORAGE_PREFIX}${selectedAccount}`;
    // lastSyncAt 是本地记录的毫秒时间戳，非法值按零处理。
    let lastSyncAt = 0;
    try {
      lastSyncAt = Number(window.localStorage.getItem(storageKey) || 0);
    } catch {
      lastSyncAt = 0;
    }
    if (Number.isFinite(lastSyncAt) && Date.now() - lastSyncAt < AUTO_SYNC_INTERVAL_MS) return;
    autoSyncBusyRef.current = true;
    try {
      window.localStorage.setItem(storageKey, String(Date.now()));
    } catch {
      // 隐私模式无法持久化节流时间时仍允许本次同步，下次打开会重新尝试。
    }
    // syncTask 可能是测试替身或同步包装返回的空值，只有真实 Promise 才注册完成回调。
    const syncTask = handleSync({ silent: true }) as Promise<void> | undefined;
    if (syncTask instanceof Promise) {
      void syncTask.finally(/* 自动同步结束后释放并发锁。 */ () => {
        autoSyncBusyRef.current = false;
      });
    } else {
      autoSyncBusyRef.current = false;
    }
  }, [accounts, accountsReady, handleSync, initialLoading, selectedAccount]);

  // 列表就绪后自动刷新当前页指标；每个账号十分钟内最多一次，仍按服务端节流串行读取详情。
  useEffect(/* autoMetricsOnOpen 在自动同步结束后补齐本页真实浏览和想要数据。 */ () => {
    if (initialLoading || loading || autoSyncBusyRef.current || metricsRefreshBusyRef.current) return;
    if (!selectedAccount || pagedItems.rows.length === 0) return;
    if (!accounts.some(/* account 检查当前账号仍属于已加载账号列表。 */ account => account.id === selectedAccount)) return;
    // storageKey 是当前账号最近一次自动指标刷新时间。
    const storageKey = `${AUTO_METRICS_STORAGE_PREFIX}${selectedAccount}`;
    // lastRefreshAt 是本地记录的毫秒时间戳，非法值按零处理。
    let lastRefreshAt = 0;
    try {
      lastRefreshAt = Number(window.localStorage.getItem(storageKey) || 0);
    } catch {
      lastRefreshAt = 0;
    }
    if (Number.isFinite(lastRefreshAt) && Date.now() - lastRefreshAt < AUTO_METRICS_INTERVAL_MS) return;
    try {
      window.localStorage.setItem(storageKey, String(Date.now()));
    } catch {
      // 节流记录失败不阻止用户显式等待的本次真实数据读取。
    }
    void refreshVisibleMetrics({ all: true });
  }, [accounts, initialLoading, loading, pagedItems.rows, refreshVisibleMetrics, selectedAccount]);

  // 切换店铺、规则、搜索词或状态标签后清理旧勾选，避免批量操作误伤已隐藏商品。
  useEffect(/* 当前副作用在筛选条件变化时清空批量勾选。 */ () => {
    setSelectedKeys(new Set());
  }, [selectedAccount, ruleFilter, appliedSearch, itemStatusTab]);

  // toggleItemSelection 切换单行商品的批量勾选状态。
  const toggleItemSelection = useCallback(/* 当前回调更新单个商品的勾选集合。 */ (item: Item) => {
    // key 是当前行的复合唯一键。
    const key = itemSelectionKey(item);
    setSelectedKeys(/* previous 是切换前的勾选集合。 */ previous => {
      // next 复制旧集合，避免直接修改 React 状态。
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // togglePageSelection 勾选或取消当前页全部商品。
  const togglePageSelection = useCallback(/* 当前回调批量更新当前页勾选状态。 */ () => {
    setSelectedKeys(/* previous 是切换前的勾选集合。 */ previous => {
      // next 复制旧集合并根据当前页是否全选决定增删。
      const next = new Set(previous);
      pagedItems.rows.forEach(/* item 是当前页的一件商品。 */ item => {
        // key 是当前行的复合唯一键。
        const key = itemSelectionKey(item);
        if (allPageSelected) next.delete(key); else next.add(key);
      });
      return next;
    });
  }, [allPageSelected, pagedItems.rows]);

  // applySearch 把搜索框文本写入生效条件，并回到第一页。
  const applySearch = useCallback(/* 当前回调应用商品标题或 ID 搜索。 */ () => {
    setAppliedSearch(searchDraft.trim());
    setListPage(1);
  }, [searchDraft]);

  // handleBulkDelete 经一次确认后逐件删除选中商品，并汇总失败数量。
  const handleBulkDelete = useCallback(/* 当前回调执行经确认的批量删除。 */ async () => {
    if (selectedItems.length === 0) return notify('info', '请先勾选需要删除的商品');
    if (!(await confirmAction({ title: '删除本地商品及关联规则', message: `确认删除选中的 ${selectedItems.length} 件本地商品及其关联自动化规则吗？闲鱼商品不会下架或删除，商品级自动发货配置将失效，请先核对发货安排。`, confirmText: '确认删除本地记录', danger: true }))) return;
    setBulkBusy(true);
    // successCount 记录本地删除成功的商品数量。
    let successCount = 0;
    // failedCount 记录本地删除失败的商品数量。
    let failedCount = 0;
    for (const /* item 是当前待删除的选中商品。 */ item of selectedItems) {
      try {
        await deleteItem(item.cookie_id, item.item_id);
        successCount += 1;
      } catch {
        failedCount += 1;
      }
    }
    setBulkBusy(false);
    setSelectedKeys(new Set());
    try {
      await loadItems();
      notify(failedCount > 0 ? 'warning' : 'success', `批量删除完成：成功 ${successCount} 件${failedCount > 0 ? `，失败 ${failedCount} 件` : ''}`);
    } catch {
      notify('warning', `删除结果：成功 ${successCount} 件，失败 ${failedCount} 件；列表刷新失败，请重新加载页面核对。`);
    }
  }, [loadItems, selectedItems]);

  // handleBulkCopy 把选中商品 ID 按行复制到剪贴板。
  const handleBulkCopy = useCallback(/* 当前回调复制选中商品 ID 列表。 */ async () => {
    if (selectedItems.length === 0) return notify('info', '请先勾选需要复制的商品');
    try {
      await navigator.clipboard.writeText(selectedItems.map(/* item 取商品 ID。 */ item => item.item_id).join('\n'));
      notify('success', `已复制 ${selectedItems.length} 个商品 ID`);
    } catch {
      notify('error', '复制失败，请检查浏览器剪贴板权限');
    }
  }, [selectedItems]);

  // changeViewMode 切换展示模式并尽力保存偏好；存储失败不影响本次切换。
  const changeViewMode = (mode: ItemViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(ITEM_VIEW_MODE_KEY, mode);
    } catch {
      // 隐私模式禁止写入本地存储时，仅本次页面生命周期使用该模式。
    }
  };
  // accountName 账号名称。
  const accountName = (cookieId: string) => {
    // account 账号。
    const account = accountMap.get(cookieId);
    // name 名称。
    const name = account?.remark || account?.nickname;
    return name ? `${name} · ${cookieId.slice(0, 6)}` : `账号 ${cookieId.slice(0, 8)}`;
  };
  // accountNickname 账号昵称。
  const accountNickname = (cookieId: string) => {
    // account 账号。
    const account = accountMap.get(cookieId);
    return account?.remark || account?.nickname || '未命名账号';
  };

  // handleItemAISettingsSaved 将已保存的覆盖状态同步回列表，避免额外刷新或逐商品请求。
  const handleItemAISettingsSaved = useCallback(/* itemAISettingsSavedCallback 更新当前商品卡片的 AI 状态。 */ (settings: ItemAISettings) => {
    if (!itemAISettingsTarget) return;
    setItems(/* currentItems 是保存前的商品列表快照。 */ currentItems => currentItems.map(/* itemMapper 只更新当前配置商品的列表摘要状态。 */ item => (
      item.cookie_id === itemAISettingsTarget.cookie_id && item.item_id === itemAISettingsTarget.item_id
        ? { ...item, ai_override: settings.ai_override }
        : item
    )));
  }, [itemAISettingsTarget]);

  if (showEditModal && selectedItem && ItemEditorPage) {
    return (
      <Suspense fallback={<div role="status" className="product-filter-panel">正在加载商品编辑页…</div>}>
        <ItemEditorPage
          key={itemSelectionKey(selectedItem)}
          item={selectedItem}
          draft={editForm}
          accountName={accountNickname(selectedItem.cookie_id)}
          busy={remoteItemBusy !== null}
          onChange={setEditForm}
          onBack={/* 返回商品列表，保留原来的筛选和分页状态。 */ () => setShowEditModal(false)}
          onSaveLocal={handleSaveEdit}
          onSaveRemote={handleSaveRemoteEdit}
        />
      </Suspense>
    );
  }

  if ((initialLoading || loadError) && items.length === 0) {
    return (
      <div className="products-view min-w-0 animate-fade-in">
        <section className="product-filter-panel product-loading-panel">
          <div className="product-source-info"><span>正在读取商品、店铺与自动化规则，请稍候。</span></div>
          <AsyncStateView
            loading={initialLoading}
            error={loadError}
            empty={false}
            onRetry={/* 首屏失败后重新并行读取商品、账号和规则。 */ () => setRetryGeneration(/* 当前值仅用于触发新的首屏读取代次。 */ current => current + 1)}
            loadingText="正在加载商品数据"
          />
        </section>
      </div>
    );
  }

  // emptyText 根据当前标签、搜索和店铺条件给出准确空态，避免把所有空列表都解释成“暂无数据”。
  const emptyText = itemStatusTab === 'sold'
    ? '当前接口未返回库存或售罄字段，暂时无法展示已售罄商品'
    : itemStatusTab === 'scheduled'
      ? '当前接口未返回定时上架字段，暂时无法展示定时上架商品'
      : appliedSearch
        ? '没有找到匹配搜索词的商品'
        : ruleFilter
          ? '没有符合该规则筛选条件的商品'
          : itemStatusTab === 'active'
            ? '暂无经平台确认上架的商品；货架状态未核实的商品请在“全部商品”中查看'
            : itemStatusTab === 'hidden'
              ? '暂无经平台确认下架的商品'
              : selectedAccount
            ? '该店铺暂无商品数据'
            : '暂无商品数据，请选择店铺进行同步';

  return (
    <div className="products-view min-w-0 animate-fade-in">
      {loadError && items.length > 0 && (
        <div role="alert" className="product-error-bar">
          <span>{loadError}。当前展示的是上一次成功读取的数据。</span>
          <button type="button" className="console-link-button" onClick={/* 读取部分失败时允许用户重试并保留现有数据。 */ () => setRetryGeneration(/* 当前值仅用于触发新的首屏读取代次。 */ current => current + 1)}>重新加载</button>
        </div>
      )}

      <section className="product-filter-panel">
        <div className="product-source-info">
          <span>配置好发货内容后，请在 <strong>店铺 → 账号管理</strong> 中检查自动发货开关，并在 <strong>配置 → 自动化规则</strong> 中启用付款后发货规则。</span>
        </div>
        <div className="product-filter-toolbar">
          <form role="search" aria-label="商品筛选" className="product-filter-row" onSubmit={/* 提交查询时阻止页面跳转，只应用本地筛选。 */ event => { event.preventDefault(); applySearch(); }}>
            <label htmlFor="item-current-account" className="product-filter-field">
              <span>店铺：</span>
              <select
                id="item-current-account"
                aria-label="当前账号"
                value={selectedAccount}
                onChange={/* 账号切换立即更新本地视图，闲鱼同步由节流副作用在打开页面后执行。 */ e => setSelectedAccount(e.target.value)}
              >
                <option value="">全部</option>
                {accounts.map(/* 当前回调处理集合中的单个元素。 */ acc => (
                  <option key={acc.id} value={acc.id}>{accountName(acc.id)}</option>
                ))}
              </select>
            </label>
            <label htmlFor="item-search" className="product-filter-field is-search">
              <span>搜索：</span>
              <input
                id="item-search"
                type="search"
                value={searchDraft}
                placeholder="请输入需要查询的内容"
                onChange={/* 搜索框只更新草稿，点击查询后才生效。 */ event => setSearchDraft(event.target.value)}
              />
            </label>
            <button type="submit" className="product-query-button">查询</button>
          </form>
        </div>
      </section>

      <section className="product-list-panel">
        <div className="product-tabs" role="tablist" aria-label="商品状态">
          {ITEM_STATUS_TABS.map(/* tab 是一个商品状态标签。 */ tab => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={itemStatusTab === tab.key}
              className={`product-tab ${itemStatusTab === tab.key ? 'is-active' : ''}`}
              onClick={/* 切换标签页时回到第一页并清理旧勾选。 */ () => { setItemStatusTab(tab.key); setListPage(1); }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="product-strip">
          <div className="product-strip-left">
            <button type="button" className="product-btn is-primary" onClick={openAddModal} disabled={!selectedAccount || !accountMap.has(selectedAccount)}>添加商品</button>
            <span title="当前后端未提供批量设置接口，请使用商品编辑或自动化规则"><button type="button" className="product-btn is-green" disabled>批量设置</button></span>
            <span title="当前未接入批量上下架，请使用行内上架或下架操作"><button type="button" className="product-btn is-white" disabled>批量上下架</button></span>
            <button type="button" className="product-btn is-red" onClick={/* 执行经确认的批量删除。 */ () => void handleBulkDelete()} disabled={bulkBusy || selectedItems.length === 0}>批量删除</button>
            <button type="button" className="product-btn is-orange" onClick={/* 复制选中商品的 ID 列表。 */ () => void handleBulkCopy()} disabled={bulkBusy || selectedItems.length === 0}>批量复制</button>
            {selectedItems.length > 0 && <span className="product-selected-count">已选 {selectedItems.length} 件</span>}
          </div>
          <div className="product-strip-right">
            <div className="product-strip-filter" role="group" aria-label="商品规则筛选">
              <label htmlFor="item-rule-filter">
                <span>规则：</span>
                <select
                  id="item-rule-filter"
                  aria-label="按交易自动化规则筛选商品列表"
                  value={ruleFilter}
                  onChange={/* event 是规则筛选下拉框的选择事件；切换后回到列表第一页。 */ event => { setRuleFilter(event.target.value as RuleCoverageFilter); setListPage(1); }}
                >
                  <option value="">全部</option>
                  <option value="any">未配置任何交易自动化</option>
                  {TRADE_AUTOMATION_TRIGGERS.map(/* entry 是一类可筛选的交易自动化触发器。 */ entry => (
                    <option key={entry.trigger} value={entry.trigger}>未配置{entry.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="product-tools" ref={moreMenuRef}>
              <button
                type="button"
                className={`product-btn is-white product-more-toggle ${moreMenuOpen ? 'is-open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                onClick={/* 展开或收起收纳同步、发布、批量铺货等次级入口的菜单。 */ () => setMoreMenuOpen(/* previous 是菜单切换前的展开状态。 */ previous => !previous)}
              >
                更多操作
              </button>
              {moreMenuOpen && (
                <div className="product-tools-menu" role="menu" aria-label="商品列表工具">
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="同步商品"
                    onClick={/* 收起菜单后执行既有的平台商品同步。 */ () => { setMoreMenuOpen(false); handleSync(); }}
                    disabled={loading || !selectedAccount || !accountMap.has(selectedAccount)}
                  >
                    <RefreshCw className={loading ? 'animate-spin' : ''} aria-hidden="true" />
                    同步商品
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="发布商品"
                    onClick={/* 收起菜单后打开既有单品发布表单。 */ () => { setMoreMenuOpen(false); openPublishModal(); }}
                    disabled={!selectedAccount || !accountMap.has(selectedAccount)}
                  >
                    <PackagePlus aria-hidden="true" />
                    发布商品
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={/* 收起菜单后打开既有批量铺货流程。 */ () => { setMoreMenuOpen(false); void openBatchModal(); }}
                    disabled={!selectedAccount || !accountMap.has(selectedAccount)}
                  >
                    <UploadCloud aria-hidden="true" />
                    {recentBatch && ['running', 'canceling'].includes(recentBatch.status) ? '继续批量任务' : '批量铺货'}
                  </button>
                  {recentBatch && !['running', 'canceling'].includes(recentBatch.status) && (
                    <button type="button" role="menuitem" onClick={/* 收起菜单后查看最近一次批量铺货结果。 */ () => { setMoreMenuOpen(false); void openRecentBatchResult(); }}>
                      最近批次结果
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={/* 收起菜单后串行刷新当前页缺失的浏览和想要数据。 */ () => { setMoreMenuOpen(false); void refreshVisibleMetrics(); }}
                    disabled={metricsRefreshLabel !== null || remoteItemBusy !== null || loading || bulkBusy}
                    title="按当前页逐件读取浏览和想要数据，曝光需在闲鱼卖家后台查看"
                  >
                    <RefreshCw className={metricsRefreshLabel ? 'animate-spin' : ''} aria-hidden="true" />
                    {metricsRefreshLabel ? `刷新中 ${metricsRefreshLabel}` : '刷新指标'}
                  </button>
                  <div className="product-tools-divider" role="separator" />
                  <div role="group" aria-label="商品展示方式" className="product-view-toggle">
                    {(['card', 'list'] as const).map(/* mode 是一种展示模式按钮。 */ mode => (
                      <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={/* 点击切换到该展示模式并收起菜单。 */ () => { changeViewMode(mode); setMoreMenuOpen(false); }} className={viewMode === mode ? 'is-active' : ''}>
                        {mode === 'card' ? '卡片视图' : '列表视图'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      {viewMode === 'list' ? (
        <div className="product-table-region">
          <div className="product-metric-note">
            <span>打开商品页会按账号节流自动同步列表并补齐本页浏览/想要；曝光接口未公开，仅列表明确返回时缓存，缺失显示“—”。</span>
            <button
              type="button"
              className="product-metric-refresh-link"
              onClick={/* 串行刷新当前页缺失的浏览和想要数据。 */ () => void refreshVisibleMetrics()}
              disabled={metricsRefreshLabel !== null || remoteItemBusy !== null || loading || bulkBusy}
            >
              {metricsRefreshLabel ? `刷新中 ${metricsRefreshLabel}` : '刷新本页缺失指标'}
            </button>
          </div>
          <ItemTable
            items={pagedItems.rows}
            rules={shippingRules}
            accountNickname={accountNickname}
            formatPrice={formatItemPrice}
            aiStatusText={itemAIStatusText}
            selectedKeys={selectedKeys}
            onToggleSelection={toggleItemSelection}
            allPageSelected={allPageSelected}
            onToggleAll={togglePageSelection}
            onConfigureDelivery={onConfigureDelivery}
            onOpenAISettings={setItemAISettingsTarget}
            onEdit={handleEdit}
            onSetShelf={handleSetShelf}
            onToggleBargain={/* 由表格行内小刀开关触发的平台开关切换。 */ (item, enabled) => void handleToggleBargain(item, enabled)}
            onRefreshMetrics={/* 由表格行末按钮触发的单件指标刷新。 */ handleRefreshItemMetrics}
            remoteItemBusy={remoteItemBusy}
            onDelete={handleDelete}
            emptyText={emptyText}
          />
          <div className="product-pager">
            <span className="product-pager-summary">共 {visibleItems.length} 件商品 · 第 {pagedItems.page} / {pagedItems.totalPages} 页</span>
            <form
              className="product-pager-actions"
              onSubmit={/* 分页器跳转表单只接受合法页码，提交后回到最近的有效页。 */ event => {
                event.preventDefault();
                // target 是从输入框读取的页码；空值或非法值不改变当前页。
                const target = Number.parseInt(pageJumpDraft, 10);
                if (Number.isFinite(target)) setListPage(Math.min(Math.max(1, target), pagedItems.totalPages));
                setPageJumpDraft('');
              }}
            >
              <label className="product-pager-size">
                每页
                <select
                  aria-label="每页条数"
                  value={listPageSize}
                  onChange={/* 切换每页条数后由独立副作用回到第一页。 */ event => setListPageSize(Number(event.target.value))}
                >
                  {[15, 30, 50].map(/* size 是参考页支持的每页条数。 */ size => <option key={size} value={size}>{size} 条/页</option>)}
                </select>
              </label>
              <button type="button" disabled={pagedItems.page <= 1} onClick={/* 跳转到上一页。 */ () => setListPage(pagedItems.page - 1)}>上一页</button>
              {Array.from({ length: pagedItems.totalPages }, /* 生成当前页数对应的页码按钮。 */ (_, index) => index + 1).filter(/* page 是参考页策略下需要展示的页码。 */ page => page === 1 || page === pagedItems.totalPages || Math.abs(page - pagedItems.page) < 3).map(/* page 是可直接跳转的页码。 */ page => (
                <button
                  key={page}
                  type="button"
                  className={page === pagedItems.page ? 'is-current' : ''}
                  aria-current={page === pagedItems.page ? 'page' : undefined}
                  onClick={/* 跳转到指定页码。 */ () => setListPage(page)}
                >
                  {page}
                </button>
              ))}
              <button type="button" disabled={pagedItems.page >= pagedItems.totalPages} onClick={/* 跳转到下一页。 */ () => setListPage(pagedItems.page + 1)}>下一页</button>
              <label className="product-pager-jump">
                前往
                <input
                  aria-label="页码"
                  type="number"
                  min={1}
                  max={pagedItems.totalPages}
                  value={pageJumpDraft}
                  placeholder={String(pagedItems.page)}
                  onChange={/* 输入框只保存草稿，点击跳转后才改变页码。 */ event => setPageJumpDraft(event.target.value)}
                />
                页
              </label>
              <button type="submit">跳转</button>
            </form>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {visibleItems.map(/* 当前回调处理集合中的单个元素。 */ item => {
            // linkedRules 关联规则列表。
            const linkedRules = rulesForItem(item);
            // hasRule 是否存在规则。
            const hasRule = linkedRules.length > 0;
            // deliveryRuleCount 是该商品生效范围内的付款后自动发货规则条数，用于按钮文案。
            const deliveryRuleCount = linkedRules.filter(/* rule 是关联规则。 */ rule => rule.trigger_type === 'order_paid').length;
            // aiOverride 是列表 DTO 提供的商品级 AI 摘要状态，缺省时按继承账号处理。
            const aiOverride = item.ai_override || 'inherit';
            // shelfState 是经平台确认的上/下架状态，历史未知状态不直接猜测。
            const shelfState = itemShelfState(item);
            return (
              <div key={`${item.cookie_id}-${item.item_id}`} className="ios-card p-3 rounded-2xl hover:shadow-lg transition-all group relative flex flex-col">
                  <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                      <button
                        onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleEdit(item)}
                        className="p-1.5 bg-white/90 backdrop-blur rounded-lg shadow-md text-gray-600 hover:bg-brand hover:text-white transition-colors"
                        title="编辑"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleDelete(item)}
                        className="p-1.5 bg-white/90 backdrop-blur rounded-lg shadow-md hover:bg-red-100 text-red-500 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                  </div>
                  <div className="aspect-square bg-gray-100 rounded-xl mb-2.5 overflow-hidden relative">
                      {item.item_image ? (
                          <img src={item.item_image} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300">
                              <Box className="w-8 h-8" />
                          </div>
                      )}
                      <div className="absolute top-1.5 left-1.5 bg-black/50 backdrop-blur-md text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                          {formatItemPrice(item.item_price)}
                      </div>
                  </div>
                  <h3 className="font-bold text-gray-900 line-clamp-2 text-xs mb-1.5 h-8 leading-4">{item.item_title}</h3>
                  <span className={`mb-2 text-[10px] font-bold ${shelfState === 'off' ? 'text-amber-700' : 'text-gray-400'}`}>{shelfState === 'off' ? '已下架（平台确认）' : shelfState === 'on' ? '已上架（平台确认）' : '货架状态未核实'}</span>
                  <div className="mb-2 inline-flex min-w-0 max-w-full items-center gap-1 self-start rounded-md bg-blue-50 px-2 py-1 text-[10px] font-extrabold text-blue-700" title={accountNickname(item.cookie_id)}>
                    <User className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 truncate whitespace-nowrap">{accountNickname(item.cookie_id)}</span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-gray-500 mb-2">
                      <span className="bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[80px]">ID: {item.item_id}</span>
                      <span className={`inline-flex items-center gap-1 font-bold ${hasRule ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {hasRule ? <CheckCircle2 className="w-3 h-3" /> : <CircleDashed className="w-3 h-3" />}
                        {hasRule ? `${linkedRules.length} 规则` : '未配置'}
                      </span>
                  </div>
                  <div className="space-y-2 mt-auto">
                      <button type="button" disabled={remoteItemBusy !== null} onClick={/* 点击上架或下架时要求二次确认。 */ () => void handleSetShelf(item)} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40" aria-label={`${shelfState === 'off' ? '上架' : '下架'}商品：${item.item_title}`}>
                        {remoteItemBusy === `${item.cookie_id}:${item.item_id}` ? '平台处理中…' : shelfState === 'off' ? '重新上架到闲鱼' : '下架闲鱼商品'}
                      </button>
                      <button
                        type="button"
                        onClick={/* itemAISettingsOpenHandler 仅在用户点击时打开弹窗并触发详情读取。 */ () => setItemAISettingsTarget(item)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[11px] font-extrabold transition-colors ${itemAIStatusClass[aiOverride]}`}
                        aria-label={`配置商品 AI 客服：${item.item_title || item.item_id}`}
                        title="商品 AI 客服配置"
                      >
                        <span className="flex min-w-0 items-center gap-1.5"><Bot className="h-3.5 w-3.5 shrink-0" /><span className="truncate">AI 客服</span></span>
                        <span className="shrink-0">{itemAIStatusText[aiOverride]}</span>
                      </button>
                      <button
                        onClick={/* 移动卡片的发货规则入口固定进入付款后发货规则。 */ () => onConfigureDelivery(item, 'order_paid')}
                        className={`w-full flex items-center justify-between gap-1 px-2.5 py-2 rounded-lg text-[11px] font-extrabold transition-all ${hasRule ? 'bg-gray-900 text-white hover:bg-black' : 'bg-brand text-white hover:bg-brand-highlight shadow-md shadow-blue-100'}`}
                      >
                        <span className="flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" />{deliveryRuleCount > 0 ? `${deliveryRuleCount} 条发货规则` : hasRule ? '查看发货规则' : '关联发货规则'}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                  </div>
              </div>
            );
          })}
          {visibleItems.length === 0 && (
             <div className="col-span-full py-20 text-center text-gray-400">
                 <ShoppingBag className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  {emptyText}
             </div>
          )}
      </div>
      )}
      </section>

      {showAddModal && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container" style={{maxWidth: '720px'}}>
            <div className="modal-header flex items-center justify-between">
              <div>
                <h3 className="text-xl font-extrabold text-gray-900">添加商品</h3>
                <p className="text-xs text-gray-500 mt-1">手动建立商品与自动发货规则的关联</p>
              </div>
              <button onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setShowAddModal(false)} className="p-2 rounded-xl hover:bg-gray-100 transition-colors" title="关闭">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="modal-body space-y-5">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-700">所属账号</label>
                <div className="w-full ios-input px-4 py-3 rounded-xl bg-gray-50 text-gray-700" aria-label="商品所属账号">{accountName(selectedAccount)}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-700">商品 ID</label>
                  <input className="w-full ios-input px-4 py-3 rounded-xl" placeholder="输入闲鱼商品 ID" value={addForm.item_id} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setAddForm({...addForm, item_id: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-700">商品价格</label>
                  <input className="w-full ios-input px-4 py-3 rounded-xl" placeholder="例如 99.00" value={addForm.item_price} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setAddForm({...addForm, item_price: e.target.value})} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-700">商品标题</label>
                <input className="w-full ios-input px-4 py-3 rounded-xl" placeholder="输入商品标题" value={addForm.item_title} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setAddForm({...addForm, item_title: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-700">图片 URL</label>
                <input className="w-full ios-input px-4 py-3 rounded-xl" placeholder="https://..." value={addForm.item_image} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setAddForm({...addForm, item_image: e.target.value})} />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={handleAddItem} className="w-full ios-btn-primary px-6 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" />
                添加商品
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {showPublishModal && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container" style={{maxWidth: '820px'}}>
            <div className="modal-header flex items-center justify-between">
              <div>
                <h3 className="text-xl font-extrabold text-gray-900">发布商品到闲鱼</h3>
                <p className="text-xs text-gray-500 mt-1">支持单规格和多规格；多规格按组合维护价格与库存。</p>
              </div>
              <button onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setShowPublishModal(false)} className="p-2 rounded-xl hover:bg-gray-100 transition-colors" title="关闭">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="modal-body space-y-5">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 leading-6">
                单规格填写总库存；多规格在组合表逐行填写价格和库存。库存权限不足时会返回明确提示。
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-700">发布账号</label>
                <div className="w-full ios-input px-4 py-3 rounded-xl bg-gray-50 text-gray-700" aria-label="商品发布账号">{accountName(selectedAccount)}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-700">商品标题</label>
                  <input className="w-full ios-input px-4 py-3 rounded-xl" placeholder="例如：会员月卡自动发货" value={publishForm.title} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setPublishForm({...publishForm, title: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-700">库存数量</label>
                  {publishForm.specs.length === 0 ? <input className="w-full ios-input px-4 py-3 rounded-xl" type="number" min="1" placeholder="必须大于 0" value={publishForm.quantity} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setPublishForm({...publishForm, quantity: e.target.value})} /> : <div className="text-sm text-slate-500">库存由下方 SKU 组合汇总</div>}
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-700">商品描述</label>
                <textarea className="w-full ios-input px-4 py-3 rounded-xl h-28 resize-none" placeholder="描述会用于自动识别类目；留空时使用标题" value={publishForm.description} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setPublishForm({...publishForm, description: e.target.value})} />
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <div>
                  <div className="text-sm font-extrabold text-gray-900">发布类目（可选）</div>
                  <p className="mt-1 text-xs leading-5 text-amber-800">填写关键词获取准确类目；留空时由闲鱼自动识别，识别不到时默认使用“电子资料”兜底。</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input className="w-full ios-input rounded-xl bg-white px-4 py-3" placeholder="例如：课程资料、电子书" value={publishCategoryKeyword} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => { setPublishCategoryKeyword(e.target.value); setPublishCategory(null); }} onKeyDown={/* 当前回调处理用户交互或异步状态变化。 */ e => { if (e.key === 'Enter') { e.preventDefault(); void handleRecommendPublishCategory(); } }} />
                  <button type="button" disabled={publishCategoryLoading || !publishForm.cookie_id || !publishCategoryKeyword.trim()} onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => void handleRecommendPublishCategory()} className="shrink-0 rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50">
                    {publishCategoryLoading ? '匹配中...' : '获取类目'}
                  </button>
                </div>
                <CategoryCandidatePicker candidates={publishCategoryCandidates} selectedCatId={publishCategory?.cat_id} onSelect={setPublishCategory} />
                {publishCategory ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm">
                    <div><span className="font-bold text-gray-900">{publishCategory.cat_name}</span><span className="ml-2 font-mono text-xs text-gray-500">{publishCategory.cat_id} · 频道 {publishCategory.channel_cat_id}</span></div>
                    <button type="button" className="text-xs font-bold text-gray-500 hover:text-red-600" onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setPublishCategory(null)}>清除，使用自动识别</button>
                  </div>
                ) : <div className="text-xs text-gray-500">当前未指定类目，最终识别失败时会使用电子资料兜底。</div>}
              </div>
              {SpecsEditor && <SpecsEditor specs={publishForm.specs} skuRows={publishForm.skuRows} onChange={/* publishSpecsChangeAction 将规格编辑器的结构变化写回发布草稿。 */ (next) => setPublishForm(/* previous 保存上一次发布草稿状态。 */ previous => ({ ...previous, specs: next.specs, skuRows: next.skuRows }))} />}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {publishForm.specs.length === 0 && <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-700">售价</label>
                  <input className="w-full ios-input px-4 py-3 rounded-xl" placeholder="99.00" value={publishForm.price} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setPublishForm({...publishForm, price: e.target.value})} />
                </div>}
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-700">原价（可选）</label>
                  <input className="w-full ios-input px-4 py-3 rounded-xl" placeholder="129.00" value={publishForm.original_price} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setPublishForm({...publishForm, original_price: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-700">运费方式</label>
                  <select className="w-full ios-input px-4 py-3 rounded-xl" value={publishForm.postage_mode} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setPublishForm({...publishForm, postage_mode: e.target.value})}>
                    <option value="free">包邮</option>
                    <option value="distance">按距离计费</option>
                    <option value="fixed">一口价邮费</option>
                    <option value="none">无需邮寄</option>
                  </select>
                </div>
              </div>
              {publishForm.postage_mode === 'fixed' && (
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-700">一口价邮费</label>
                  <input className="w-full ios-input px-4 py-3 rounded-xl" placeholder="例如 8.00" value={publishForm.postage} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setPublishForm({...publishForm, postage: e.target.value})} />
                </div>
              )}
			  <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 space-y-3">
				<div className="flex items-center justify-between gap-3">
				  <div><div className="text-sm font-extrabold text-gray-900">发货地（可选）</div><p className="mt-1 text-xs text-sky-800">记住上次地址，选到区即可；详细地点选填。</p></div>
					<div className="flex flex-wrap justify-end gap-2">
					  <button type="button" disabled={locationLoading || !publishForm.cookie_id} onClick={/* currentLocationClickAction 获取设备当前位置附近的高德发货地。 */ () => void locateForPublish(false)} className="ios-btn-primary flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50">
					    <LocateFixed className="h-4 w-4" />{locationLoading ? '定位中...' : '获取当前位置'}
					  </button>
					  <button type="button" disabled={locationLoading || !publishForm.cookie_id} onClick={/* manualLocationClickAction 打开普通发布的高德手动选点弹窗。 */ () => setManualLocationTarget('publish')} className="flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-bold text-sky-700 transition-colors hover:bg-sky-50 disabled:opacity-50">
					    <Search className="h-4 w-4" />手动选择
					  </button>
					</div>
				</div>
				{publishLocations.length > 1 && <select className="w-full ios-input rounded-xl bg-white px-4 py-3" value={String(Math.max(0, publishLocations.indexOf(publishLocation!)))} onChange={/* 用户改选附近发货地后更新浏览器偏好。 */ e => {
                  // location 是本次用户改选的发货地。
                  const location = publishLocations[Number(e.target.value)] || null;
                  setPublishLocation(location);
                  saveLastPublishLocation(location);
                }}>
				  {publishLocations.map(/* 当前回调处理集合中的单个元素。 */ (item, index) => <option key={`${item.division_id}-${item.poi_id}-${index}`} value={String(index)}>{publishLocationText(item)}</option>)}
				</select>}
				{publishLocation && <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs text-sky-800"><span>当前发货地：{publishLocationText(publishLocation)}</span><button type="button" onClick={/* 清除当前及上次记忆的地址。 */ () => { setPublishLocation(null); setPublishLocations([]); saveLastPublishLocation(null); }} className="shrink-0 font-bold text-red-600">清除</button></div>}
			  </div>
              {ImagesEditor && <ImagesEditor images={publishForm.images} previews={publishImagePreviews} onPickFromLibrary={LibraryPicker ? /* 打开图片库选择器。 */ () => setLibraryPickerOpen(true) : undefined} onChange={/* publishImagesChangeAction 将图片追加、删除或排序后的列表写回发布草稿。 */ (images) => setPublishForm(/* previous 保存上一次发布草稿状态。 */ previous => ({ ...previous, images }))} />}
              {LibraryPicker && <LibraryPicker open={libraryPickerOpen} maxSelect={Math.max(1, 9 - publishForm.images.length)} onClose={/* 关闭图片库选择器。 */ () => setLibraryPickerOpen(false)} onPick={/* 图片库文件追加到发布草稿，最多 9 张。 */ files => { setPublishForm(/* previous 是追加前的发布草稿。 */ previous => ({ ...previous, images: [...previous.images, ...files].slice(0, 9) })); setLibraryPickerOpen(false); }} />}
            </div>
            <div className="modal-footer">
              <button disabled={publishing} onClick={handlePublishItem} className="w-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 px-6 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2">
                <PackagePlus className="w-4 h-4" />
                {publishing ? '正在发布...' : '发布到闲鱼'}
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {showBatchModal && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container" style={{maxWidth: '980px'}}>
            <div className="modal-header flex items-center justify-between">
              <div>
                <h3 className="text-xl font-extrabold text-gray-900">批量铺货</h3>
                <p className="text-xs text-gray-500 mt-1">上传商品表格和图片 zip，先预检，再逐条发布到闲鱼。</p>
              </div>
              <button onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => void closeBatchModal()} className="p-2 rounded-xl hover:bg-gray-100 transition-colors" title="关闭">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="modal-body space-y-5">
              <BatchPhaseIndicator phase={batchPhase} />

              {batchPhase === 'upload' && (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900 leading-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <div className="font-extrabold">先下载模板，再按字段填写。</div>
                        <div>图片字段写 zip 内相对路径，多个图片用英文分号分隔，例如 <span className="font-mono font-bold">images/a.jpg;images/b.jpg</span>。也支持直接填写图片 URL。</div>
                      </div>
                      <button
                        type="button"
                        onClick={downloadPublishTemplate}
                        className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-blue-700"
                      >
                        下载CSV模板
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-bold text-gray-700">默认发布账号</label>
                    <div className="w-full ios-input px-4 py-3 rounded-xl bg-gray-50 text-gray-700" aria-label="批量发布账号">{accountName(selectedAccount)}</div>
                    <p className="text-xs text-gray-500">表格中“账号ID”为空时，默认使用顶部选择的账号；明确填写的账号 ID 仍按表格处理。</p>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
                    <div>
                      <div className="text-sm font-extrabold text-gray-900">默认类目 <span className="font-medium text-gray-500">（可为空）</span></div>
                      <p className="mt-1 text-xs leading-5 text-amber-800">填写后优先使用该类目；留空时由闲鱼根据每件商品自动识别。仍无法识别时，系统最终使用“电子资料”兜底。</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <label className="relative flex-1">
                        <span className="sr-only">类目关键词</span>
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                          className="w-full ios-input rounded-xl bg-white py-2.5 pl-10 pr-3"
                          placeholder="输入关键词，例如：课程资料、设计素材"
                          value={batchCategoryKeyword}
                          onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setBatchCategoryKeyword(e.target.value)}
                          onKeyDown={/* 当前回调处理用户交互或异步状态变化。 */ e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleRecommendBatchCategory();
                            }
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!selectedAccount || !batchCategoryKeyword.trim() || batchCategoryLoading}
                        onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => void handleRecommendBatchCategory()}
                        className="ios-btn-primary flex min-h-[42px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold disabled:opacity-50"
                      >
                        <Search className="h-4 w-4" />
                        {batchCategoryLoading ? '匹配中...' : '获取类目'}
                      </button>
                    </div>
                    <CategoryCandidatePicker
                      candidates={batchCategoryCandidates}
                      selectedCatId={batchFallbackCategory.catId}
                      onSelect={/* 把点选的候选类目写回批量默认类目。 */ candidate => setBatchFallbackCategory(toBatchFallbackCategory(candidate))}
                    />
                    {batchFallbackCategory.catId ? (
                      <div className="flex min-h-[46px] items-center justify-between gap-3 border-t border-amber-200 pt-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                            <span className="truncate">{batchFallbackCategory.catName}</span>
                          </div>
                          <div className="mt-1 font-mono text-xs text-gray-500">类目 {batchFallbackCategory.catId} · 频道 {batchFallbackCategory.channelCatId}</div>
                        </div>
                        <button
                          type="button"
                          title="清除默认类目"
                          onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setBatchFallbackCategory({ catId: '', catName: '', channelCatId: '', tbCatId: '' })}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-white hover:text-gray-900"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                  </div>

				  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 space-y-3">
					<div className="flex items-center justify-between gap-3">
					  <div><div className="text-sm font-extrabold text-gray-900">批次发货地（可选）</div><p className="mt-1 text-xs text-sky-800">沿用上次地址，选到区即可；详细地点选填。</p></div>
					<div className="flex flex-wrap justify-end gap-2">
					  <button type="button" disabled={locationLoading || !selectedAccount} onClick={/* currentBatchLocationClickAction 获取批量发布使用的设备当前位置。 */ () => void locateForPublish(true)} className="ios-btn-primary flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50">
						<LocateFixed className="h-4 w-4" />{locationLoading ? '定位中...' : '获取当前位置'}
					  </button>
					  <button type="button" disabled={locationLoading || !selectedAccount} onClick={/* manualBatchLocationClickAction 打开批量发布的高德手动选点弹窗。 */ () => setManualLocationTarget('batch')} className="flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-bold text-sky-700 transition-colors hover:bg-sky-50 disabled:opacity-50">
						<Search className="h-4 w-4" />手动选择
					  </button>
					</div>
					</div>
					{batchLocations.length > 1 && <select className="w-full ios-input rounded-xl bg-white px-4 py-3" value={String(Math.max(0, batchLocations.indexOf(batchLocation!)))} onChange={/* 用户改选批次发货地后更新浏览器偏好。 */ e => {
                      // location 是用户改选的批次发货地。
                      const location = batchLocations[Number(e.target.value)] || null;
                      setBatchLocation(location);
                      saveLastPublishLocation(location);
                    }}>
					  {batchLocations.map(/* 当前回调处理集合中的单个元素。 */ (item, index) => <option key={`${item.division_id}-${item.poi_id}-${index}`} value={String(index)}>{publishLocationText(item)}</option>)}
					</select>}
					{batchLocation && <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs text-sky-800"><span>当前发货地：{publishLocationText(batchLocation)}</span><button type="button" onClick={/* 清除批次发货地和浏览器历史选择。 */ () => { setBatchLocation(null); setBatchLocations([]); saveLastPublishLocation(null); }} className="shrink-0 font-bold text-red-600">清除</button></div>}
					  </div>

					  <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-2">
						<label className="flex items-center justify-between gap-4" htmlFor="batch-publish-interval">
						  <span className="min-w-0"><span className="block text-sm font-extrabold text-gray-900">商品发布强制间隔</span><span className="mt-1 block text-xs text-violet-800">图片会提前上传，只有最终发布请求之间至少等待该时间。</span></span>
						  <span className="flex shrink-0 items-center gap-2"><input id="batch-publish-interval" type="number" min={1} max={3600} step={1} inputMode="numeric" className="ios-input w-24 rounded-xl bg-white px-3 py-2 text-right" value={batchPublishIntervalSeconds} onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setBatchPublishIntervalSeconds(Math.min(3600, Math.max(1, Number(e.target.value) || 1)))} /><span className="text-sm font-bold text-violet-900">秒</span></span>
						</label>
					  </div>

	                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center hover:border-blue-300 hover:bg-blue-50 transition-colors">
                      <UploadCloud className="w-9 h-9 text-blue-600 mb-3" />
                      <span className="text-sm font-extrabold text-gray-900">上传商品表格</span>
                      <span className="text-xs text-gray-500 mt-1">{batchFile ? batchFile.name : '支持 .xlsx / .csv / .tsv'}</span>
                      <input
                        className="hidden"
                        type="file"
                        accept=".xlsx,.csv,.tsv"
                        onChange={/* 当前回调读取本次文件快照并重置原生控件，以便同一路径文件修改后可再次选择。 */ event => setBatchFile(consumeSelectedFile(event.currentTarget))}
                      />
                    </label>
                    <label className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center hover:border-emerald-300 hover:bg-emerald-50 transition-colors">
                      <UploadCloud className="w-9 h-9 text-emerald-600 mb-3" />
                      <span className="text-sm font-extrabold text-gray-900">上传图片 zip（可选）</span>
                      <span className="text-xs text-gray-500 mt-1">{batchImagesZip ? batchImagesZip.name : '表格图片字段使用 zip 内相对路径'}</span>
                      <input
                        className="hidden"
                        type="file"
                        accept=".zip"
                        onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setBatchImagesZip(e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>

                  <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4 space-y-3">
                    <div>
                      <div className="text-sm font-extrabold text-gray-900">字段说明</div>
                      <p className="text-xs text-gray-500 mt-1">照着下面的“什么时候填写”处理即可。预检发现问题时，会指出具体哪一行需要修改。</p>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="px-3 py-2">字段</th>
                            <th className="px-3 py-2">什么时候填写</th>
                            <th className="px-3 py-2">填写方法</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-gray-700">
                          {[
                            ['账号ID', '需要覆盖默认账号时填写', '上方默认发布账号为必选；本列留空时使用默认账号，填写后仅覆盖当前行'],
                            ['标题', '每个商品都要填', '填写买家能看到的商品标题'],
                            ['描述', '可以留空', '留空时会使用商品标题作为描述'],
                            ['价格', '每个商品都要填', '只填数字，例如 19.90'],
                            ['原价', '可以留空', '需要展示划线原价时填写，例如 29.90'],
                            ['库存', '可以留空', '留空按 1 件处理；填写时必须大于 0'],
                            ['邮费模式', '可以留空', '留空表示包邮。包邮填 free（或“包邮”）；网盘、虚拟资源等无需邮寄填 none（或“无需邮寄”）；按距离计费填 distance；固定邮费填 fixed'],
                            ['邮费', '邮费模式填 fixed 时填写', '只填数字，例如 8.00'],
                            ['图片', '每个商品都要填', '填写 zip 内图片路径或图片网址；多张图片用英文分号隔开'],
                            ['类目ID', '需要指定当前行默认类目时填写', '必须和“类目名称、频道类目ID”同时填写；优先于自动识别'],
                            ['类目名称', '填写了“类目ID”时必填', '填写该 ID 对应的准确类目名称'],
                            ['频道类目ID', '覆盖类目时必填', '必须填写闲鱼返回的准确频道类目 ID'],
                            ['淘宝类目ID', '按闲鱼返回填写', '“电子资料”无淘宝类目 ID，保持为空'],
                            ['付款发货启用', '需要付款后自动发货时填写', '填“是”表示开启；不需要时填“否”或留空'],
                            ['付款发货内容', '“付款发货启用”填“是”时填写', '填写发货模板 T模板ID（如 T1、T1:30），每个商品的不同链接填写在“变量.xxx”列'],
                            ['评价赠品启用', '需要评价赠品时填写', '填“是”表示开启；不需要时填“否”或留空'],
                            ['评价赠品内容', '“评价赠品启用”填“是”时填写', '格式和付款发货内容相同，填写 T模板ID'],
                            ['变量.xxx', '使用的发货模板含 {{custom.xxx}} 时填写', '表头写“变量.”加变量名，例如 变量.link；每行填本商品的取值，如网盘链接，可包含冒号和分号'],
                            ['求评价启用', '需要自动求评价时填写', '填“是”表示开启；不需要时填“否”或留空'],
                            ['求评价等待小时', '“求评价启用”填“是”时填写', '填写等待小时数；留空按 72 小时处理'],
                            ['求评价文案', '“求评价启用”填“是”时填写', '填写要发送给买家的求评价消息'],
                            ['求评价最多次数', '可以留空', '留空只提醒 1 次'],
                          ].map(/* 当前回调处理用户交互或异步状态变化。 */ ([name, when, desc]) => (
                            <tr key={name}>
                              <td className="px-3 py-2 font-bold text-gray-900 whitespace-nowrap">{name}</td>
                              <td className={`px-3 py-2 min-w-[210px] font-bold ${when === '每个商品都要填' ? 'text-red-600' : when === '可以留空' ? 'text-gray-500' : 'text-amber-700'}`}>{when}</td>
                              <td className="px-3 py-2 min-w-[260px]">{desc}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {batchPhase === 'preview' && batchPreview && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-2xl bg-gray-50 p-4 border border-gray-100">
                      <div className="text-xs font-bold text-gray-500">总行数</div>
                      <div className="text-2xl font-extrabold text-gray-900 mt-1">{batchPreview.total}</div>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-4 border border-emerald-100">
                      <div className="text-xs font-bold text-emerald-700">可发布</div>
                      <div className="text-2xl font-extrabold text-emerald-700 mt-1">{batchPreview.valid}</div>
                    </div>
                    <div className="rounded-2xl bg-red-50 p-4 border border-red-100">
                      <div className="text-xs font-bold text-red-700">有问题</div>
                      <div className="text-2xl font-extrabold text-red-700 mt-1">{batchPreview.invalid}</div>
                    </div>
                  </div>

                  <div className="max-h-[380px] overflow-y-auto rounded-2xl border border-gray-100">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-white text-xs text-gray-400 border-b border-gray-100">
                        <tr>
                          <th className="px-4 py-3">行号</th>
                          <th className="px-4 py-3">状态</th>
                          <th className="px-4 py-3">标题</th>
                          <th className="px-4 py-3">价格/库存</th>
                          <th className="px-4 py-3">类目策略</th>
                          <th className="px-4 py-3">图片</th>
                          <th className="px-4 py-3">问题</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {batchPreview.rows.map(/* 当前回调处理集合中的单个元素。 */ row => (
                          <tr key={row.row_no} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-mono text-xs">{row.row_no}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex px-2 py-1 rounded-lg border text-xs font-extrabold ${row.valid ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                {row.valid ? '可发布' : '需修正'}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-bold text-gray-900 max-w-[240px] truncate">{row.title || '-'}</td>
                            <td className="px-4 py-3 text-gray-600">¥{row.price || '-'} / {row.quantity || 1}</td>
                            <td className="px-4 py-3 text-xs text-gray-600 min-w-[150px]">
                              <div className="font-bold text-gray-800">{row.category?.cat_name || '自动识别'}</div>
                              <div className="font-mono text-gray-400">{row.category?.cat_id || '失败后使用电子资料'}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-600">{row.images?.length || 0} 张</td>
                            <td className="px-4 py-3 text-red-600 text-xs max-w-[280px]">{row.errors?.join('；') || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(batchPhase === 'running' || batchPhase === 'done') && batchDetail && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className={`rounded-2xl p-4 border ${batchStatusClass(batchDetail.status)}`}>
                      <div className="text-xs font-bold opacity-70">任务状态</div>
                      <div className="text-xl font-extrabold mt-1">{batchStatusText(batchDetail.status)}</div>
                    </div>
                    <div className="rounded-2xl bg-gray-50 p-4 border border-gray-100">
                      <div className="text-xs font-bold text-gray-500">总数</div>
                      <div className="text-xl font-extrabold text-gray-900 mt-1">{batchDetail.total}</div>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-4 border border-emerald-100">
                      <div className="text-xs font-bold text-emerald-700">成功</div>
                      <div className="text-xl font-extrabold text-emerald-700 mt-1">{batchDetail.success}</div>
                    </div>
                    <div className="rounded-2xl bg-red-50 p-4 border border-red-100">
                      <div className="text-xs font-bold text-red-700">失败</div>
                      <div className="text-xl font-extrabold text-red-700 mt-1">{batchDetail.failed}</div>
                    </div>
                    <div className="rounded-2xl bg-blue-50 p-4 border border-blue-100">
                      <div className="text-xs font-bold text-blue-700">等待</div>
                      <div className="text-xl font-extrabold text-blue-700 mt-1">{batchDetail.pending}</div>
                    </div>
                  </div>

                  <div className="max-h-[420px] overflow-y-auto rounded-2xl border border-gray-100">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-white text-xs text-gray-400 border-b border-gray-100">
                        <tr>
                          <th className="px-4 py-3">行号</th>
                          <th className="px-4 py-3">状态</th>
                          <th className="px-4 py-3">标题</th>
                          <th className="px-4 py-3">类目策略</th>
                          <th className="px-4 py-3">商品ID</th>
                          <th className="px-4 py-3">错误原因</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {batchDetail.rows.map(/* 当前回调处理集合中的单个元素。 */ row => (
                          <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-mono text-xs">{row.row_no}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex px-2 py-1 rounded-lg border text-xs font-extrabold ${batchStatusClass(row.status)}`}>
                                {batchStatusText(row.status)}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-bold text-gray-900 max-w-[260px] truncate">{row.title}</td>
                            <td className="px-4 py-3 text-xs text-gray-600 min-w-[150px]">
                              <div className="font-bold text-gray-800">{row.category?.cat_name || '自动识别'}</div>
                              <div className="font-mono text-gray-400">{row.category?.cat_id || '失败后使用电子资料'}</div>
                            </td>
                            <td className="px-4 py-3 text-xs font-mono">
                              {row.item_url ? <a href={row.item_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{row.item_id}</a> : (row.item_id || '-')}
                            </td>
                            <td className="px-4 py-3 text-red-600 text-xs max-w-[340px]">{row.error_message || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              {batchPhase === 'upload' && (
                <button disabled={batchLoading || !batchFile || !selectedAccount} onClick={handlePreviewBatch} className="w-full ios-btn-primary px-6 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                  <RefreshCw className={`w-4 h-4 ${batchLoading ? 'animate-spin' : ''}`} />
                  {batchLoading ? '正在预检...' : '开始预检'}
                </button>
              )}
              {batchPhase === 'preview' && batchPreview && (
                <div className="flex gap-3 w-full">
                  <button disabled={batchLoading} onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => void abandonBatchPreview()} className="flex-1 px-6 py-3.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold">
                    返回修改
                  </button>
                  <button disabled={batchLoading || batchPreview.valid <= 0} onClick={handleStartBatch} className="flex-1 ios-btn-primary px-6 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                    <PackagePlus className="w-4 h-4" />
                    {batchLoading ? '启动中...' : `确认发布 ${batchPreview.valid} 个商品`}
                  </button>
                </div>
              )}
              {(batchPhase === 'running' || batchPhase === 'done') && batchDetail && (
                <div className="flex gap-3 w-full">
                  {batchDetail.status === 'running' ? (
                    <button disabled={batchLoading} onClick={handleCancelBatch} className="flex-1 px-6 py-3.5 rounded-xl bg-gray-900 text-white hover:bg-black font-bold">
                      取消任务
                    </button>
                  ) : batchDetail.status === 'canceling' ? (
                    <button disabled className="flex-1 px-6 py-3.5 rounded-xl bg-amber-100 text-amber-800 font-bold">
                      正在保存远端结果并安全取消…
                    </button>
                  ) : (
                    <button onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => window.open(`/api/v1/items/publish-batches/${batchDetail.id}/result.csv`, '_blank')} className="flex-1 px-6 py-3.5 rounded-xl bg-gray-900 text-white hover:bg-black font-bold">
                      下载结果
                    </button>
                  )}
                  {batchDetail.retryable > 0 && !['running', 'canceling'].includes(batchDetail.status) && (
                    <button disabled={batchLoading} onClick={handleRetryBatchFailed} className="flex-1 ios-btn-primary px-6 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2">
                      <RefreshCw className={`w-4 h-4 ${batchLoading ? 'animate-spin' : ''}`} />
                      重试失败项
                    </button>
                  )}
                  {!['running', 'canceling'].includes(batchDetail.status) && (
                    <button onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => { void closeBatchModal(); void loadItems(); void loadShippingRules(); }} className="flex-1 px-6 py-3.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold">
                      完成
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      , document.body)}

      <ManualLocationPicker
        open={manualLocationTarget !== null}
        onClose={/* manualLocationCloseAction 关闭手动地点弹窗并释放高德查询。 */ () => setManualLocationTarget(null)}
        onConfirm={confirmManualLocation}
      />
      {ItemAISettingsModal && itemAISettingsTarget && (
        <Suspense fallback={null}>
          <ItemAISettingsModal
            item={itemAISettingsTarget}
            open
            onClose={/* itemAISettingsCloseHandler 关闭商品级 AI 配置弹窗。 */ () => setItemAISettingsTarget(null)}
            onSaved={handleItemAISettingsSaved}
          />
        </Suspense>
      )}
    </div>
  );
};

export default ItemList;
