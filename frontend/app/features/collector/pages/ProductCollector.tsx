import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Flame,
  FolderPlus,
  Link2,
  MonitorUp,
  Radar,
  Search,
  Sparkles,
  Store,
  X,
} from 'lucide-react';
import { PageHeader } from '../../../../shared/ui/PageHeader';
import {
  cancelManualVerifyWindow,
  collectProductDetails,
  collectorErrorMessage,
  collectSellerProducts,
  completeManualVerifyWindow,
  listCollectorAccounts,
  listCollectorDeliveryTemplates,
  openManualVerifyWindow,
  searchMarketProducts,
} from '../api';
import { CollectorItemModal } from '../components/CollectorItemModal';
import { SaveTemplatesModal } from '../components/SaveTemplatesModal';
import { RadarPanel } from '../components/RadarPanel';
import { exportLibraryImportCsv, exportSelectionCsv } from '../csvExport';
import type {
  CollectedProduct,
  CollectorAccountOption,
  CollectorDeliveryTemplateOption,
  CollectorSortMode,
  CollectorTab,
} from '../types';

/** ProductCollectorProps 描述全站商品采集页面接收的跨路由跳转回调。 */
export interface ProductCollectorProps {
  /** onNavigateToLibrary 在模板转存成功后跳转到本地资源库页面。 */
  onNavigateToLibrary?: () => void;
}

/** ProductCollector 提供关键词全站挖品、单品链接精准提取、同行整店采集及一键转存商品模板工作台。 */
const ProductCollector: React.FC<ProductCollectorProps> = ({ onNavigateToLibrary }) => {
  // accounts 与 setAccounts 保存可用于执行采集的闲鱼账号选项。
  const [accounts, setAccounts] = useState<CollectorAccountOption[]>([]);
  // selectedCookieId 与 setSelectedCookieId 保存用户显式指定的采集账号 ID。
  const [selectedCookieId, setSelectedCookieId] = useState('');
  // deliveryTemplates 与 setDeliveryTemplates 保存转存弹窗可选绑定的发货模板选项。
  const [deliveryTemplates, setDeliveryTemplates] = useState<CollectorDeliveryTemplateOption[]>([]);

  // activeTab 与 setActiveTab 控制当前激活的采集模式页签。
  const [activeTab, setActiveTab] = useState<CollectorTab>('search');
  // keyword 与 setKeyword 保存全站关键词搜索词。
  const [keyword, setKeyword] = useState('');
  // sortMode 与 setSortMode 保存搜索排序策略（默认优先展示想要数爆款降序）。
  const [sortMode, setSortMode] = useState<CollectorSortMode>('want_desc');
  // minPrice 与 setMinPrice 保存可选最低价过滤文本。
  const [minPrice, setMinPrice] = useState('');
  // maxPrice 与 setMaxPrice 保存可选最高价过滤文本。
  const [maxPrice, setMaxPrice] = useState('');
  // publishDays 与 setPublishDays 保存发布时间过滤天数（0 表示不限）。
  const [publishDays, setPublishDays] = useState(0);
  // minWantCount 与 setMinWantCount 保存最低想要人数过滤阈值。
  const [minWantCount, setMinWantCount] = useState(0);
  // pageNumber 与 setPageNumber 保存关键词搜索当前页码。
  const [pageNumber, setPageNumber] = useState(1);
  // hasMore 与 setHasMore 表示当前搜索是否仍有下一页。
  const [hasMore, setHasMore] = useState(false);

  // detailInputText 与 setDetailInputText 保存单品精准采集的多行链接或商品 ID 文本。
  const [detailInputText, setDetailInputText] = useState('');
  // sellerInput 与 setSellerInput 保存对标同行主页链接或卖家 ID。
  const [sellerInput, setSellerInput] = useState('');
  // sellerMaxPages 与 setSellerMaxPages 保存单次采集同行店铺的最大页数（1–5）。
  const [sellerMaxPages, setSellerMaxPages] = useState(1);

  // items 与 setItems 保存当前采集结果表格中的商品集合。
  const [items, setItems] = useState<CollectedProduct[]>([]);
  // selectedIds 与 setSelectedIds 保存表格中已勾选的商品 ID 集合。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // loading 与 setLoading 表示是否正在请求闲鱼采集接口。
  const [loading, setLoading] = useState(false);
  // banner 与 setBanner 展示错误告警、风控熔断提醒或采集完成摘要。
  const [banner, setBanner] = useState<{ /** tone 区分消息等级颜色。 */ tone: 'info' | 'warn' | 'err'; /** text 是提示正文。 */ text: string } | null>(null);

  // editingItem 与 setEditingItem 控制单品详情补抓与 AI 改写弹窗。
  const [editingItem, setEditingItem] = useState<CollectedProduct | null>(null);
  // saveModalItems 与 setSaveModalItems 控制批量转存模板弹窗及其待入库商品切片。
  const [saveModalItems, setSaveModalItems] = useState<CollectedProduct[]>([]);
  // verifyWindowOpen 与 setVerifyWindowOpen 标记桌面可见闲鱼过验证窗口是否已弹出等待用户确认。
  const [verifyWindowOpen, setVerifyWindowOpen] = useState(false);
  // verifyBusy 与 setVerifyBusy 控制弹出或同步验证窗口期间的按钮防重复点击状态。
  const [verifyBusy, setVerifyBusy] = useState(false);
  // requestSeqRef 隔离连续点击或切页产生的过期响应。
  const requestSeqRef = useRef(0);
  // requestAbortRef 持有普通采集的当前请求，切换账号、模式或卸载时取消。
  const requestAbortRef = useRef<AbortController | null>(null);

  useEffect(/* collectUnmountEffect 使卸载前发起的采集请求失效并释放网络请求。 */ () => () => {
    ++requestSeqRef.current;
    requestAbortRef.current?.abort();
  }, []);

  /** beginRequest 取消旧请求并返回新一轮采集的代次及信号。 */
  const beginRequest = () => {
    requestAbortRef.current?.abort();
    // controller 拥有此次采集的取消信号。
    const controller = new AbortController();
    requestAbortRef.current = controller;
    return { seq: ++requestSeqRef.current, signal: controller.signal };
  };

  /** resetResults 在切换用户选中的账号或采集类型时阻止旧响应污染新的结果。 */
  const resetResults = (): void => {
    ++requestSeqRef.current;
    requestAbortRef.current?.abort();
    setLoading(false);
    setItems([]);
    setSelectedIds(new Set());
    setPageNumber(1);
    setHasMore(false);
    setBanner(null);
    setEditingItem(null);
    setSaveModalItems([]);
  };

  /** effect 在进入采集工作台时并行加载可选采集账号与发货模板列表。 */
  useEffect(/* initCollectorOptionsEffect 初始化账号与发货模板下拉数据并在卸载时取消请求。 */ () => {
    // controller 在页面卸载时取消未完成的初始化请求。
    const controller = new AbortController();
    Promise.all([
      listCollectorAccounts({ signal: controller.signal }),
      listCollectorDeliveryTemplates({ signal: controller.signal }),
    ])
      .then(/* ([loadedAccounts, loadedTemplates]) 写入初始选项并默认选中第一个在线账号。 */ ([loadedAccounts, loadedTemplates]) => {
        setAccounts(loadedAccounts);
        setDeliveryTemplates(loadedTemplates);
        if (loadedAccounts.length > 0) {
          // preferred 优先挑选在线账号作为初始采集号。
          const preferred = loadedAccounts.find(/* acc 判断账号是否在线。 */ acc => acc.online) ?? loadedAccounts[0];
          setSelectedCookieId(/* prev 若已选择有效账号则保持不变。 */ prev => prev || preferred.id);
        }
      })
      .catch(/* err 忽略组件卸载导致的主动取消，其余异常展示提示。 */ err => {
        if (controller.signal.aborted) return;
        setBanner({ tone: 'err', text: collectorErrorMessage(err, '加载采集账号列表失败') });
      });
    return /* cleanup 卸载时终止初始化请求。 */ () => controller.abort();
  }, []);

  /** runKeywordSearch 执行指定页码的全站关键词搜索采集。 */
  const runKeywordSearch = async (targetPage: number): Promise<void> => {
    if (!selectedCookieId) {
      setBanner({ tone: 'err', text: '请先在顶部选择一个已登录的闲鱼采集账号' });
      return;
    }
    if (!keyword.trim()) {
      setBanner({ tone: 'err', text: '请输入要搜索采集的商品关键词（如：电子资料、简历模板、Excel表格）' });
      return;
    }
    // seq、signal 分别隔离过期响应和取消旧采集请求。
    const { seq, signal } = beginRequest();
    setLoading(true);
    setBanner(null);
    try {
      // res 是全站搜索返回的单页商品结果。
      const res = await searchMarketProducts({
        cookieId: selectedCookieId,
        keyword: keyword.trim(),
        pageNumber: targetPage,
        rowsPerPage: 30,
        sortMode,
        minPrice: minPrice.trim(),
        maxPrice: maxPrice.trim(),
        publishDays,
        minWantCount,
      }, { signal });
      if (seq !== requestSeqRef.current) return;
      setItems(res.items);
      setPageNumber(res.pageNumber);
      setHasMore(res.hasMore);
      setSelectedIds(new Set());
      setBanner({
        tone: 'info',
        text: `第 ${res.pageNumber} 页采集完成，共获取 ${res.items.length} 件符合条件的商品`,
      });
    } catch (failure /* failure 是关键词搜索请求失败原因。 */) {
      if (seq !== requestSeqRef.current) return;
      setBanner({ tone: 'err', text: collectorErrorMessage(failure, '全站商品搜索采集失败') });
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  /** runDetailCollect 按多行商品链接或 ID 抓取完整详情与全部高清主图。 */
  const runDetailCollect = async (): Promise<void> => {
    if (!selectedCookieId) {
      setBanner({ tone: 'err', text: '请先在顶部选择一个已登录的闲鱼采集账号' });
      return;
    }
    if (!detailInputText.trim()) {
      setBanner({ tone: 'err', text: '请粘贴至少一条闲鱼商品链接、分享口令或纯数字商品 ID' });
      return;
    }
    // seq 标记请求代次。
    const { seq, signal } = beginRequest();
    setLoading(true);
    setBanner(null);
    try {
      // res 是精准详情批量采集结果。
      const res = await collectProductDetails(selectedCookieId, [detailInputText], { signal });
      if (seq !== requestSeqRef.current) return;
      setItems(res.items);
      setHasMore(false);
      setSelectedIds(new Set(res.items.map(/* it 默认自动全选刚精准采集成功的商品。 */ it => it.itemId)));
      if (res.abortedByRisk) {
        setBanner({ tone: 'warn', text: `触发平台风控保护已安全熔断：成功获取 ${res.items.length} 件，失败 ${res.errors.length} 件（${res.errors[0]?.message ?? ''}）` });
      } else if (res.errors.length > 0) {
        setBanner({ tone: 'warn', text: `采集完成：成功 ${res.items.length} 件，失败 ${res.errors.length} 件（${res.errors.map(/* e 格式化单条失败提示。 */ e => `${e.itemId}: ${e.message}`).join('；')}）` });
      } else {
        setBanner({ tone: 'info', text: `精准采集完成：已完整提取 ${res.items.length} 件商品的详情文案与高清多图` });
      }
    } catch (failure /* failure 是详情采集请求失败原因。 */) {
      if (seq !== requestSeqRef.current) return;
      setBanner({ tone: 'err', text: collectorErrorMessage(failure, '单品详情采集失败') });
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  /** runSellerCollect 按同行主页链接或卖家 ID 抓取对标店铺在售商品。 */
  const runSellerCollect = async (overrideSellerInput?: string): Promise<void> => {
    // targetSeller 优先使用快捷按钮传入的卖家 ID，否则读取输入框文本。
    const targetSeller = (overrideSellerInput ?? sellerInput).trim();
    if (!selectedCookieId) {
      setBanner({ tone: 'err', text: '请先在顶部选择一个已登录的闲鱼采集账号' });
      return;
    }
    if (!targetSeller) {
      setBanner({ tone: 'err', text: '请输入对标同行主页链接（含 userId=...）或卖家数字 ID' });
      return;
    }
    // seq 标记请求代次。
    const { seq, signal } = beginRequest();
    setLoading(true);
    setBanner(null);
    try {
      // res 是同行店铺分页采集结果。
      const res = await collectSellerProducts(selectedCookieId, targetSeller, sellerMaxPages, { signal });
      if (seq !== requestSeqRef.current) return;
      setItems(res.items);
      setHasMore(res.hasMore);
      setSelectedIds(new Set());
      if (res.warning) {
        setBanner({ tone: 'warn', text: res.warning });
      } else {
        setBanner({ tone: 'info', text: `同行店铺采集完成：共获取 ${res.items.length} 件在售商品` });
      }
    } catch (failure /* failure 是店铺采集失败原因。 */) {
      if (seq !== requestSeqRef.current) return;
      setBanner({ tone: 'err', text: collectorErrorMessage(failure, '同行店铺商品采集失败') });
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  /** handleJumpCollectSeller 从结果卡片一键切入同行店铺采集模式并立即拉取该卖家全店商品。 */
  const handleJumpCollectSeller = (sellerId: string): void => {
    resetResults();
    setActiveTab('seller');
    setSellerInput(sellerId);
    void runSellerCollect(sellerId);
  };

  /** toggleSelectItem 切换单个商品的勾选状态。 */
  const toggleSelectItem = (itemId: string): void => {
    setSelectedIds(/* prev 是变更前的勾选集合。 */ prev => {
      // next 复制集合以触发不可变更新。
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  /** toggleSelectAll 全选或清空当前结果列表。 */
  const toggleSelectAll = (): void => {
    if (selectedIds.size === items.length && items.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(/* it 提取当前列表全部商品 ID。 */ it => it.itemId)));
    }
  };

  /** updateItemInList 将弹窗中编辑或 AI 改写后的商品写回当前结果列表。 */
  const updateItemInList = (updated: CollectedProduct): void => {
    setItems(/* prev 是当前列表商品数组。 */ prev => prev.map(/* it 替换同 ID 条目。 */ it => (it.itemId === updated.itemId ? updated : it)));
  };

  /** handleOpenManualVerify 一键在电脑桌面弹出带登录态的闲鱼窗口供用户手动滑过滑块（免 F12 抓包）。 */
  const handleOpenManualVerify = async (): Promise<void> => {
    if (!selectedCookieId) {
      setBanner({ tone: 'err', text: '请先在顶部选择一个需要过验证的闲鱼账号' });
      return;
    }
    setVerifyBusy(true);
    try {
      // targetInput 根据当前页签传递商品链接或卖家 ID，以便直接打开对应闲鱼页面触发精确路径的 x5sec。
      const targetInput = activeTab === 'detail' ? detailInputText.trim() : sellerInput.trim();
      // opened 返回已在桌面浏览器打开的闲鱼网址。
      const opened = await openManualVerifyWindow(selectedCookieId, activeTab, keyword.trim(), targetInput);
      setVerifyWindowOpen(true);
      setBanner({
        tone: 'warn',
        text: `已在你电脑桌面弹出闲鱼窗口（${opened.targetUrl}）！请切到该窗口用鼠标滑过滑块（滑完前先不要手动关闭该窗口），待页面正常显示商品后点击「我已滑完，一键同步恢复」即可。`,
      });
    } catch (failure /* failure 是打开桌面验证窗口失败原因。 */) {
      setBanner({ tone: 'err', text: collectorErrorMessage(failure, '弹出闲鱼验证窗口失败') });
    } finally {
      setVerifyBusy(false);
    }
  };

  /** handleCompleteManualVerify 读取用户滑完验证后的完整浏览器 Cookie Jar 快照自动落库并关闭窗口。 */
  const handleCompleteManualVerify = async (): Promise<void> => {
    if (!selectedCookieId) return;
    setVerifyBusy(true);
    try {
      // synced 返回自动同步保存的完整 Cookie 与安全票据条目数。
      const synced = await completeManualVerifyWindow(selectedCookieId);
      setVerifyWindowOpen(false);
      setBanner({
        tone: 'info',
        text: `验证解除成功！已免 F12 自动提取并同步 ${synced.syncedCount} 项最新 Cookie 与安全票据，现在可直接点击开始采集。`,
      });
    } catch (failure /* failure 是同步验证窗口 Cookie 失败原因。 */) {
      setBanner({ tone: 'err', text: collectorErrorMessage(failure, '同步验证窗口 Cookie 失败') });
    } finally {
      setVerifyBusy(false);
    }
  };

  /** handleCancelManualVerify 主动关闭打开中的桌面验证窗口而不覆盖原登录态。 */
  const handleCancelManualVerify = async (): Promise<void> => {
    if (!selectedCookieId) {
      setVerifyWindowOpen(false);
      return;
    }
    setVerifyBusy(true);
    try {
      await cancelManualVerifyWindow(selectedCookieId);
      setVerifyWindowOpen(false);
      setBanner({ tone: 'info', text: '已关闭桌面验证窗口' });
    } catch (failure /* failure 是关闭验证窗口失败原因。 */) {
      setBanner({ tone: 'err', text: collectorErrorMessage(failure, '关闭验证窗口失败') });
    } finally {
      setVerifyBusy(false);
    }
  };

  // isRiskBanner 判断当前提示条是否属于滑块/安全验证风控提示，若是则在提示条内直接渲染一键过滑块按钮。
  const isRiskBanner = Boolean(
    banner && (
      verifyWindowOpen ||
      banner.text.includes('RGV587') ||
      banner.text.includes('滑块') ||
      banner.text.includes('安全验证') ||
      banner.text.includes('USER_VALIDATE')
    ),
  );

  // selectedProducts 计算已勾选的商品切片；未勾选时导出操作可退回使用全部当前结果。
  const selectedProducts = items.filter(/* it 过滤已勾选条目。 */ it => selectedIds.has(it.itemId));
  // exportTargetProducts 导出表格时优先导出勾选项，未勾选则导出当前页全部结果。
  const exportTargetProducts = selectedProducts.length > 0 ? selectedProducts : items;

  return (
    <div className="space-y-6">
      <PageHeader
        title="全站商品采集"
        description="支持全站关键词挖爆款、单品链接提取多图与对标同行整店采集，无缝衔接 AI 防重改写与本地资源库多店铺货。"
      />

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: 'search', label: '全站关键词挖爆款', icon: Search },
                { id: 'detail', label: '单品链接 / ID 精准提取', icon: Link2 },
                { id: 'seller', label: '对标同行整店采集', icon: Store },
                { id: 'radar', label: '爆款雷达', icon: Radar },
              ] as const
            ).map(/* tabItem 描述单个采集入口页签。 */ tabItem => {
              // TabIcon 渲染页签图标组件。
              const TabIcon = tabItem.icon;
              // active 判断是否为当前选中页签。
              const active = activeTab === tabItem.id;
              return (
                <button
                  key={tabItem.id}
                  type="button"
                  disabled={verifyBusy || verifyWindowOpen}
                  onClick={/* 切换当前采集模式并清除旧结果。 */ () => { if (activeTab !== tabItem.id) { resetResults(); setActiveTab(tabItem.id); } }}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition-colors ${
                    active ? 'bg-brand text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                  }`}
                >
                  <TabIcon className="h-4 w-4" />
                  {tabItem.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-bold text-slate-600">执行采集账号：</span>
            <select
              value={selectedCookieId}
              disabled={verifyBusy || verifyWindowOpen}
              onChange={/* event 切换指定执行采集的闲鱼账号并重置旧验证窗口标记。 */ event => {
                resetResults();
                setSelectedCookieId(event.target.value);
                setVerifyWindowOpen(false);
              }}
              aria-label="执行采集账号"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 focus:border-sky-500 focus:outline-hidden"
            >
              {accounts.length === 0 && <option value="">暂无已登录账号（请先去账号管理扫码）</option>}
              {accounts.map(/* acc 渲染可选闲鱼账号及在线标记。 */ acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.online ? '🟢 ' : '⚪ '}
                  {acc.label}
                </option>
              ))}
            </select>
            {!verifyWindowOpen ? (
              <button
                type="button"
                disabled={!selectedCookieId || verifyBusy || activeTab === 'radar'}
                onClick={/* 在桌面弹出闲鱼网页窗口供用户手动滑过滑块。 */ () => void handleOpenManualVerify()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-extrabold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                title="遇到 RGV587 滑块时无需按 F12 抓包：点此弹出闲鱼窗口手动滑一下，再点一键同步即可"
              >
                <MonitorUp className="h-3.5 w-3.5 text-amber-700" />
                {verifyBusy ? '正在弹出窗口...' : '弹出窗口过滑块（免 F12）'}
              </button>
            ) : (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={verifyBusy}
                  onClick={/* 确认已手动滑完验证并自动同步完整 Cookie 快照。 */ () => void handleCompleteManualVerify()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {verifyBusy ? '正在同步恢复...' : '我已滑完，一键同步恢复'}
                </button>
                <button
                  type="button"
                  disabled={verifyBusy}
                  onClick={/* 关闭桌面验证窗口。 */ () => void handleCancelManualVerify()}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  title="关闭验证窗口"
                >
                  <X className="h-3.5 w-3.5" />
                  关闭
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="pt-4">
          {activeTab === 'search' && (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 md:flex-row">
                <input
                  type="text"
                  value={keyword}
                  onChange={/* event 更新关键词输入。 */ event => setKeyword(event.target.value)}
                  onKeyDown={/* event 支持回车直接发起第 1 页搜索。 */ event => {
                    if (event.key === 'Enter') void runKeywordSearch(1);
                  }}
                  placeholder="输入选品关键词，例如：Excel函数模板、考公笔记、PPT模板、电子资料..."
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-hidden"
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={/* 发起第 1 页关键词搜索。 */ () => void runKeywordSearch(1)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-2.5 text-sm font-extrabold text-white hover:opacity-95 disabled:opacity-50"
                >
                  <Radar className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? '采集中...' : '开始全站采集'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-500">排序方式</label>
                  <select
                    value={sortMode}
                    onChange={/* event 切换搜索结果排序模式。 */ event => setSortMode(event.target.value as CollectorSortMode)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
                  >
                    <option value="want_desc">🔥 本页想要人数从高到低</option>
                    <option value="default">综合推荐排序</option>
                    <option value="newest">最新发布优先</option>
                    <option value="price_asc">价格从低到高</option>
                    <option value="price_desc">价格从高到低</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-500">最低想要人数（筛爆款）</label>
                  <input
                    type="number"
                    min={0}
                    value={minWantCount || ''}
                    onChange={/* event 更新最低想要数筛选值。 */ event => setMinWantCount(Math.max(0, Number(event.target.value) || 0))}
                    placeholder="如 20（不限留空）"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-500">最低价 (元)</label>
                  <input
                    type="text"
                    value={minPrice}
                    onChange={/* event 更新最低价格过滤文本。 */ event => setMinPrice(event.target.value)}
                    placeholder="如 1"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-500">最高价 (元)</label>
                  <input
                    type="text"
                    value={maxPrice}
                    onChange={/* event 更新最高价格过滤文本。 */ event => setMaxPrice(event.target.value)}
                    placeholder="如 50"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-500">发布时间范围</label>
                  <select
                    value={publishDays}
                    onChange={/* event 切换近 N 天发布过滤条件。 */ event => setPublishDays(Number(event.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
                  >
                    <option value={0}>不限发布时间</option>
                    <option value={1}>近 24 小时新发</option>
                    <option value={3}>近 3 天内发布</option>
                    <option value={7}>近 7 天内发布</option>
                    <option value={14}>近 14 天内发布</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'detail' && (
            <div className="space-y-3">
              <textarea
                rows={4}
                value={detailInputText}
                onChange={/* event 更新多行商品链接或商品 ID 文本。 */ event => setDetailInputText(event.target.value)}
                placeholder={'每行粘贴一条闲鱼商品网页链接、手机分享口令（含 id=...）或纯数字商品 ID（单次最多 10 条）：\nhttps://www.goofish.com/item?id=1099053019895'}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs leading-relaxed text-slate-900 focus:border-sky-500 focus:outline-hidden"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">直接提取目标商品的完整详情文案 + 全部 1–9 张高清原图（超过 1 条时自动启用 ≥5 秒慢速防风控节流）</span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={/* 执行单品或多链接精准详情提取。 */ () => void runDetailCollect()}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-xs font-extrabold text-white hover:opacity-95 disabled:opacity-50"
                >
                  <Link2 className="h-4 w-4" />
                  {loading ? '正在按序提取详情...' : '精准提取完整图文'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'seller' && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-bold text-slate-700">对标同行个人主页链接或卖家数字 ID</label>
                <input
                  type="text"
                  value={sellerInput}
                  onChange={/* event 更新同行主页链接或 userId 输入。 */ event => setSellerInput(event.target.value)}
                  placeholder="粘贴如 https://www.goofish.com/personal?userId=2177750131 或直接输入卖家数字 ID"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-hidden"
                />
              </div>
              <div className="w-full sm:w-40">
                <label className="mb-1 block text-xs font-bold text-slate-700">最多采集页数</label>
                <select
                  value={sellerMaxPages}
                  onChange={/* event 更新同行店铺采集页数上限。 */ event => setSellerMaxPages(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-800"
                >
                  <option value={1}>第 1 页 (约 20 件)</option>
                  <option value={2}>前 2 页 (约 40 件)</option>
                  <option value={3}>前 3 页 (约 60 件)</option>
                  <option value={5}>前 5 页 (约 100 件)</option>
                </select>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={/* 执行对标同行店铺商品采集。 */ () => void runSellerCollect()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-2.5 text-xs font-extrabold text-white hover:opacity-95 disabled:opacity-50"
              >
                <Store className="h-4 w-4" />
                {loading ? '正在拉取店铺商品...' : '采集同行在售商品'}
              </button>
            </div>
          )}
        </div>
      </div>

      {activeTab === 'radar' ? <RadarPanel cookieId={selectedCookieId} onInspect={/* id 是待用户确认采集的商品 ID。 */ id => { resetResults(); setDetailInputText(id); setActiveTab('detail'); }} /> : <>
      {banner && (
        <div
          className={`flex flex-col justify-between gap-3 rounded-2xl px-4 py-3.5 text-xs font-bold sm:flex-row sm:items-center ${
            banner.tone === 'err'
              ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
              : banner.tone === 'warn'
                ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                : 'bg-sky-50 text-sky-800 ring-1 ring-sky-200'
          }`}
        >
          <span className="leading-relaxed">{banner.text}</span>
          {isRiskBanner && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {!verifyWindowOpen ? (
                <button
                  type="button"
                  disabled={!selectedCookieId || verifyBusy}
                  onClick={/* 在风控提示条内一键弹出闲鱼桌面窗口过滑块。 */ () => void handleOpenManualVerify()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-amber-700 disabled:opacity-50"
                >
                  <MonitorUp className="h-4 w-4" />
                  {verifyBusy ? '正在弹出闲鱼窗口...' : '① 一键弹出闲鱼窗口过滑块（免 F12）'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={verifyBusy}
                    onClick={/* 在提示条内确认已滑完并一键同步恢复。 */ () => void handleCompleteManualVerify()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {verifyBusy ? '正在同步 Cookie...' : '② 我已滑完，一键同步恢复'}
                  </button>
                  <button
                    type="button"
                    disabled={verifyBusy}
                    onClick={/* 关闭打开中的桌面验证窗口。 */ () => void handleCancelManualVerify()}
                    className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    关闭窗口
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={items.length > 0 && selectedIds.size === items.length}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-slate-300 text-sky-600"
              />
              全选本页
            </label>
            <span className="text-xs text-slate-500">
              当前共 <strong className="text-slate-800">{items.length}</strong> 件 · 已勾选{' '}
              <strong className="text-sky-600">{selectedIds.size}</strong> 件
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={exportTargetProducts.length === 0}
              onClick={/* 导出选品分析 CSV 表格。 */ () => exportSelectionCsv(exportTargetProducts)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              导出选品分析表 (Excel/CSV)
            </button>
            <button
              type="button"
              disabled={exportTargetProducts.length === 0}
              onClick={/* 导出可直接导入本地资源库的铺货 CSV 模板表。 */ () => exportLibraryImportCsv(exportTargetProducts, deliveryTemplates[0]?.id)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              导出铺货导入模板表
            </button>
            <button
              type="button"
              disabled={selectedProducts.length === 0}
              onClick={/* 打开批量转存商品模板弹窗。 */ () => setSaveModalItems(selectedProducts)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              <FolderPlus className="h-4 w-4" />
              一键转存为商品模板 ({selectedProducts.length})
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Radar className="h-7 w-7" />
            </div>
            <div className="mt-3 text-sm font-bold text-slate-700">暂无采集结果</div>
            <p className="mt-1 max-w-md text-xs text-slate-400">
              在上方输入选品关键词、粘贴单品分享链接或输入对标同行卖家 ID，即可采集全站商品并一键转入本地商品模板库多店铺货。
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map(/* item 是当前结果行对应的采集商品对象。 */ item => {
              // checked 表示当前行是否已被勾选。
              const checked = selectedIds.has(item.itemId);
              return (
                <div key={item.itemId} className={`flex flex-col gap-4 p-4 transition-colors sm:flex-row sm:items-center ${checked ? 'bg-sky-50/40' : 'hover:bg-slate-50/70'}`}>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={/* 切换当前商品行的勾选状态。 */ () => toggleSelectItem(item.itemId)}
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-sky-600"
                    />
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                      {item.picUrl ? (
                        <img src={item.picUrl} alt={item.title} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[11px] text-slate-400">无主图</div>
                      )}
                      {item.imageUrls.length > 1 && (
                        <span className="absolute bottom-1 right-1 rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {item.imageUrls.length}图
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-extrabold text-slate-900">{item.title}</span>
                      {item.hasFullDetail && (
                        <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">完整详情</span>
                      )}
                      {item.isFreeShipping && (
                        <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">包邮</span>
                      )}
                    </div>

                    {item.description && item.description !== item.title && (
                      <p className="line-clamp-2 text-xs text-slate-500">{item.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="text-base font-black text-rose-600">¥{item.price}</span>
                      {item.originalPrice && <span className="text-slate-400 line-through">¥{item.originalPrice}</span>}
                      <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-0.5 font-bold text-orange-600">
                        <Flame className="h-3.5 w-3.5" /> {item.wantCount < 0 ? '想要人数未知' : `${item.wantCount} 人想要`}
                      </span>
                      {item.area && <span>📍 {item.area}</span>}
                      <span>👤 {item.sellerNick || item.sellerId || '匿名卖家'}</span>
                      <a href={item.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-sky-600 hover:underline">
                        原帖 <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {item.sellerId && (
                      <button
                        type="button"
                        onClick={/* 一键采集当前商品所属同行卖家的全部在售商品。 */ () => handleJumpCollectSeller(item.sellerId)}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                      >
                        <Store className="h-3.5 w-3.5 text-slate-500" /> 采同店
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={/* 打开单品详情补抓与 AI 防重改写弹窗。 */ () => setEditingItem(item)}
                      className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> 详情 / AI改写
                    </button>
                    <button
                      type="button"
                      onClick={/* 单独将当前商品直接打开转存模板窗口。 */ () => setSaveModalItems([item])}
                      className="inline-flex items-center gap-1 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700"
                    >
                      <FolderPlus className="h-3.5 w-3.5" /> 转存模板
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'search' && (items.length > 0 || hasMore || pageNumber > 1) && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
            <span className="text-xs font-bold text-slate-500">当前第 {pageNumber} 页</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loading || pageNumber <= 1}
                onClick={/* 翻到上一页搜索结果。 */ () => void runKeywordSearch(pageNumber - 1)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> 上一页
              </button>
              <button
                type="button"
                disabled={loading || !hasMore}
                onClick={/* 翻到下一页搜索结果。 */ () => void runKeywordSearch(pageNumber + 1)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                下一页 <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      </>}

      <CollectorItemModal
        item={editingItem}
        cookieId={selectedCookieId}
        onClose={/* 关闭编辑弹窗。 */ () => setEditingItem(null)}
        onSave={updateItemInList}
        onSaveAndOpenTemplate={/* 保存单品改动并直接打开转存弹窗。 */ updated => {
          updateItemInList(updated);
          setEditingItem(null);
          setSaveModalItems([updated]);
        }}
      />

      <SaveTemplatesModal
        open={saveModalItems.length > 0}
        items={saveModalItems}
        cookieId={selectedCookieId}
        deliveryTemplates={deliveryTemplates}
        onClose={/* 关闭批量转存弹窗。 */ () => setSaveModalItems([])}
        onNavigateToLibrary={onNavigateToLibrary}
      />
    </div>
  );
};

export default ProductCollector;
