import {
AlertCircle,
Bot,
CheckCircle2,
ChevronLeft,
ChevronRight,
CircleDollarSign,
Clock3,
Edit,
Gift,
Layers3,
MessageCircle,
Network,
Plus,
RefreshCw,
Save,
ScrollText,
Search,
SlidersHorizontal,
Trash2,
X,
Zap,
} from 'lucide-react';
import React,{ Suspense,useEffect,useMemo,useState } from 'react';
import { createPortal } from 'react-dom';
import AllItemsConfirmation from '../components/AllItemsConfirmation';
import { AutomationIssuePanel } from '../components/AutomationIssuePanel';
import TemplateVariantEditor from '../components/TemplateVariantEditor';
import ReplyRuleEditor from '../components/ReplyRuleEditor';
import AgentReplyPanel from '../components/AgentReplyPanel';
import ItemGreetingPanel from '../components/ItemGreetingPanel';
import SearchableSelect from '../../../../shared/ui/SearchableSelect';
import { useRulesData } from '../hooks';
import { filterAutomationIssues } from '../issueState';
import { ruleActionKey,useRuleActions } from '../ruleActions';
import type { AutomationTriggerType,ReplyRule,RulesProps,RulesTab } from '../types';
import { accentClasses,accountLabel,actionSummary,adjustPriceTarget,buildReviewConfig,reviewLookbackHours,cardActionsForTrigger,isDeliveryCardReady,isVisibleShippingVariant,needsAllItemsConfirmation,statusPill,triggerMeta,triggerOrder,withAllItemsConfirmation } from '../utils';
import { ImageSourceField } from '../../../../shared/ui/ImageSourceField';
import { PageHeader } from '../../../../shared/ui/PageHeader';
import { SHOW_CARD_UI } from '../../../../shared/ui/featureVisibility';
import { AsyncStateView } from '../../../../shared/ui/feedback';
import { DialogFrame,useDialogFocus } from '../../../../shared/ui/Dialog';

// RulesLoadNoticeProps 描述规则页加载失败或参考数据降级提示所需文案和重试动作。
interface RulesLoadNoticeProps {
  // message 是需要展示的失败或降级说明。
  message: string;
  // onRetry 是可选的重试回调；缺省时只展示提示。
  onRetry?: () => void;
  // warning 表示非阻断降级提示；false 时使用错误样式。
  warning?: boolean;
}

// RulesLoadNotice 展示规则页可恢复的加载错误或参考数据降级提示。
const RulesLoadNotice: React.FC<RulesLoadNoticeProps> = ({ message, onRetry, warning = false }) => (
  <div
    role="alert"
    className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between ${warning ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}
  >
    <span className="min-w-0 break-words">{message}</span>
    {onRetry && (
      <button
        type="button"
        onClick={/* 当前回调重新请求失败的数据。 */ onRetry}
        className="ios-btn-secondary shrink-0 self-start px-3 py-1.5 sm:self-auto"
      >
        重试
      </button>
    )}
  </div>
);

// Rules 是规则 feature 在旧页面目录下保留的兼容入口组件。
const Rules: React.FC<RulesProps> = ({ initialDeliveryTarget, onDeliveryTargetHandled, auditPanel: AuditPanel, supportPanel: SupportPanel, libraryImageChooser }) => {
  // [activeTab, 解构得到当前 Hook 返回的状态和操作函数。
  const [activeTab, setActiveTab] = useState<RulesTab>('automation');
  // [selectedAccountId, 解构得到当前 Hook 返回的状态和操作函数。
  const [selectedAccountId, setSelectedAccountId] = useState('');
  // [automationSearch, 解构得到当前 Hook 返回的状态和操作函数。
  const [automationSearch, setAutomationSearch] = useState('');
  // [debouncedAutomationSearch, 解构得到当前 Hook 返回的状态和操作函数。
  const [debouncedAutomationSearch, setDebouncedAutomationSearch] = useState('');
  // [automationTriggerFilter, 解构得到当前 Hook 返回的状态和操作函数。
  const [automationTriggerFilter, setAutomationTriggerFilter] = useState<AutomationTriggerType | ''>('');
  // [automationStatusFilter, 解构得到当前 Hook 返回的状态和操作函数。
  const [automationStatusFilter, setAutomationStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  // [automationPage, 解构得到当前 Hook 返回的状态和操作函数。
  const [automationPage, setAutomationPage] = useState(1);
  // [automationPageSize, 解构得到当前 Hook 返回的状态和操作函数。
  const [automationPageSize, setAutomationPageSize] = useState(10);

  // rulesData 规则列表数据，负责当前功能中的对应处理。
  const rulesData = useRulesData({
    activeTab,
    selectedAccountId,
    automationTriggerFilter,
    automationStatusFilter,
    debouncedAutomationSearch,
    automationPage,
    automationPageSize,
    setSelectedAccountId,
    onAutomationPageChange: setAutomationPage,
  });
  // 解构数据 解构得到当前 Hook 返回的状态和操作函数。
  const {
    automationRules,
    automationIssues,
    replyRules,
    defaultReplies,
    accounts,
    cards,
    items,
    deliveryTemplates,
    loading,
    referenceDataError,
    referenceDataWarning,
    automationError,
    replyError,
    defaultRepliesError,
    setLoading,
    automationTotal,
    automationTotalPages,
    automationTriggerCounts,
    setAutomationRules,
    setCards,
    setItems,
    loadReferenceData,
    loadAutomationRules,
    loadReplyRules,
    loadDefaultReplies,
    refresh,
  } = rulesData;

  // ruleActions 规则 feature 提供弹窗状态、编辑草稿和所有保存删除动作。
  const ruleActions = useRuleActions({
    selectedAccountId,
    setSelectedAccountId,
    setActiveTab,
    items,
    deliveryTemplates,
    setAutomationRules,
    setCards,
    setItems,
    setLoading,
    loadAutomationRules,
    loadReferenceData,
    loadReplyRules,
    loadDefaultReplies,
    initialDeliveryTarget,
    onDeliveryTargetHandled,
  });
  // 解构规则动作，保持旧页面 JSX 的字段名称和行为不变。
  const {
    showAutomationModal, setShowAutomationModal, showReplyModal, setShowReplyModal, showDefaultModal, setShowDefaultModal,
    editingAutomationRule, setEditingAutomationRule,
    editingReplyRule, setEditingReplyRule, defaultForm, setDefaultForm, selectedRuleItem, isMultiSpecRule, currentTrigger,
    currentMeta, reviewConfig, displayVariants, openAutomationRule, openNewAutomationRule, handleTriggerChange,
    handleAutomationItemChange, updateVariant, updateAdjustPriceTarget, updateAdjustPriceNotifyText, appendDeliveryContent, handleSaveAutomationRule, handleDeleteAutomation,
    handleToggleAutomation, handleResolveRunIssue, handleResolveDeferredIssue, handleAddReplyRule, handleSaveReplyRule,
    handleDeleteReply, openDefaultReplyModal, handleSaveDefaultReply, handleDeleteDefaultReply,
    handleClearDefaultReplyRecords, automationSaveError, replySaveError, defaultReplySaveError,
    defaultReplyLoading, defaultReplyLoadError, defaultReplyReady, isPending, retryDefaultReplyLoad,
  } = ruleActions;

  // automationSaving 表示自动化规则保存是否正在提交。
  const automationSaving = isPending(ruleActionKey.automationSave);
  // replySaving 表示当前关键词回复保存是否正在提交。
  const replySaving = isPending(ruleActionKey.replySave(editingReplyRule?.id));
  // defaultReplySaving 表示当前账号默认回复保存是否正在提交。
  const defaultReplySaving = isPending(ruleActionKey.defaultSave(defaultForm.cookie_id || 'none'));
  // automationDialogRef 统一管理自动化弹窗的 Escape、遮罩、滚动锁和焦点恢复。
  const automationDialogRef = useDialogFocus({
    open: showAutomationModal,
    onClose: /* 当前回调关闭自动化规则弹窗。 */ () => setShowAutomationModal(false),
    closeDisabled: automationSaving,
  });

  useEffect(/* 当前回调同步 React 副作用和资源生命周期。 */ () => {
	// timer 定时器。
	const timer = window.setTimeout(/* 当前回调处理用户交互或异步状态变化。 */ () => {
	  setAutomationPage(1);
	  setDebouncedAutomationSearch(automationSearch.trim());
	}, 300);
	return /* 当前回调处理用户交互或异步状态变化。 */ () => window.clearTimeout(timer);
  }, [automationSearch]);

  useEffect(/* 当前回调处理异步操作结果。 */ () => {
	void refresh();
  }, [refresh]);

  // visibleAutomationRules 可见数据自动化规则列表，负责当前功能中的对应处理。
  const visibleAutomationRules = useMemo(
    /* 当前回调处理集合中的单个元素。 */ () => automationRules.filter(/* 当前回调处理集合中的单个元素。 */ rule => !selectedAccountId || rule.cookie_id === selectedAccountId),
    [automationRules, selectedAccountId],
  );

  // visibleAutomationIssues 可见数据自动化Issues，负责当前功能中的对应处理。
  const visibleAutomationIssues = useMemo(
	/* 当前回调计算并缓存派生数据。 */ () => filterAutomationIssues(automationIssues, selectedAccountId),
	[automationIssues, selectedAccountId],
  );

  // visibleDefaultAccounts 可见数据默认账号列表，负责当前功能中的对应处理。
  const visibleDefaultAccounts = useMemo(
    /* 当前回调处理集合中的单个元素。 */ () => accounts.filter(/* 当前回调处理集合中的单个元素。 */ account => !selectedAccountId || account.id === selectedAccountId),
    [accounts, selectedAccountId],
  );

  // automationPageNumbers 自动化页码Numbers，负责当前功能中的对应处理。
  const automationPageNumbers = useMemo(/* 当前回调计算并缓存派生数据。 */ () => {
	if (automationTotalPages <= 1) return [];
	// first 首项。
	const first = Math.max(1, Math.min(automationPage - 2, automationTotalPages - 4));
	// last last，负责当前功能中的对应处理。
	const last = Math.min(automationTotalPages, first + 4);
	return Array.from({ length: last - first + 1 }, /* 当前回调处理用户交互或异步状态变化。 */ (_, index) => first + index);
  }, [automationPage, automationTotalPages]);

  // hasAutomationListFilters has自动化列表Filters，负责当前功能中的对应处理。
  const hasAutomationListFilters = Boolean(
	automationSearch.trim() || automationTriggerFilter || automationStatusFilter !== 'all',
  );

  // clearAutomationListFilters 清理自动化列表Filters，负责当前功能中的对应处理。
  const clearAutomationListFilters = () => {
	setAutomationSearch('');
	setDebouncedAutomationSearch('');
	setAutomationTriggerFilter('');
	setAutomationStatusFilter('all');
	setAutomationPage(1);
  };

  // modalAccountItems modal账号商品列表，负责当前功能中的对应处理。
  const modalAccountItems = useMemo(/* 当前回调计算并缓存派生数据。 */ () => {
    // cookieID 账号凭证标识。
    const cookieID = editingAutomationRule?.cookie_id || selectedAccountId;
    return items.filter(/* 当前回调处理集合中的单个元素。 */ item => item.cookie_id === cookieID);
  }, [editingAutomationRule?.cookie_id, items, selectedAccountId]);

  // replyModalItems 是回复规则弹窗可关联的本地商品候选。
  const replyModalItems = useMemo(
    /* 当前回调按当前账号过滤本地商品。 */ () => items.filter(/* 当前回调处理集合中的单个元素。 */ item => !selectedAccountId || item.cookie_id === selectedAccountId),
    [items, selectedAccountId],
  );

  // itemTitleIndex 保存当前账号商品标识到商品标题的映射，用于列表展示已关联商品。
  const itemTitleIndex = useMemo(/* 当前回调建立当前账号的商品标题索引。 */ () => {
    // index 是本次构建的商品标识到标题的映射。
    const index = new Map<string, string>();
    // item 表示当前待登记的商品。
    for (const /* item 是当前待登记商品标题的本地商品。 */ item of replyModalItems) {
      // itemID 是去除首尾空白后的商品标识。
      const itemID = item.item_id?.trim();
      if (itemID && !index.has(itemID)) index.set(itemID, item.item_title || itemID);
    }
    return index;
  }, [replyModalItems]);

  // replyRuleItemLabels 返回规则关联商品的可读标签集合，账号级规则返回空集合。
  const replyRuleItemLabels = (rule: ReplyRule): string[] => {
    // itemIDs 是规则关联的商品标识集合，优先使用多选集合并回退兼容单值。
    const itemIDs = rule.item_ids?.length ? rule.item_ids : (rule.item_id ? [rule.item_id] : []);
    return itemIDs.map(/* 当前回调把商品标识还原为可读标题。 */ (itemID: string) => itemTitleIndex.get(itemID) || itemID);
  };

  // auditAccountLabel 把规则日志中的账号标识转换为账号展示名，未知账号回退为原标识。
  const auditAccountLabel = (cookieId: string): string => {
    // account 是与日志账号标识匹配的账号摘要。
    const account = accounts.find(/* candidate 是当前比较的账号摘要。 */ candidate => candidate.id === cookieId);
    return account ? accountLabel(account) : cookieId;
  };

  // primaryActionLabel 主操作按钮文案。
  const primaryActionLabel = activeTab === 'automation'
    ? '新建自动化'
    : activeTab === 'reply'
      ? '新增关键词'
      : '编辑默认回复';

  // primaryActionDisabled 表示当前页签的主操作是否因缺少账号、默认回复错误或读取中而不可用。
  const primaryActionDisabled = !selectedAccountId
    || (activeTab === 'default' && (Boolean(defaultRepliesError) || isPending(ruleActionKey.defaultOpen(selectedAccountId))));


  return (
    <div className="min-w-0 space-y-8 animate-fade-in">
      <PageHeader title="自动化规则" description="系统通知卡片只进入自动化判断；买家消息进入关键词、默认或 AI 回复。">
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <select
            value={selectedAccountId}
            onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => {
			  setSelectedAccountId(event.target.value);
			  setAutomationPage(1);
			}}
            className="ios-input w-full px-4 py-3 rounded-2xl text-sm sm:w-64"
          >
            <option value="">全部账号</option>
            {accounts.map(/* 当前回调处理集合中的单个元素。 */ account => (
              <option key={account.id} value={account.id}>{accountLabel(account)}</option>
            ))}
          </select>
          <button
            onClick={refresh}
            className="px-4 py-3 rounded-2xl font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          {activeTab !== 'greeting' && activeTab !== 'agent' && activeTab !== 'support' && activeTab !== 'logs' && (
          <button
            onClick={activeTab === 'automation' ? /* 当前回调处理用户交互或异步状态变化。 */ () => openNewAutomationRule('order_paid') : activeTab === 'reply' ? handleAddReplyRule : /* 当前回调处理用户交互或异步状态变化。 */ () => void openDefaultReplyModal()}
            disabled={primaryActionDisabled}
            className="ios-btn-primary px-5 py-3 rounded-2xl text-sm font-extrabold flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {primaryActionLabel}
          </button>
          )}
        </div>
      </PageHeader>

      {referenceDataError && (
        <RulesLoadNotice message={`账号参考数据加载失败：${referenceDataError}`} onRetry={/* 当前回调重试规则页全部数据。 */ () => void refresh()} />
      )}
      {referenceDataWarning && (
        <RulesLoadNotice warning message={referenceDataWarning} onRetry={/* 当前回调重试参考数据。 */ () => void loadReferenceData()} />
      )}

      <div className="console-tabs" role="tablist" aria-label="自动化规则分类">
        {[
          { id: 'automation' as const, label: '交易自动化', icon: Zap },
          { id: 'reply' as const, label: '关键词回复', icon: MessageCircle },
          { id: 'default' as const, label: '账号默认回复', icon: Bot },
          { id: 'greeting' as const, label: '商品首次回复', icon: Gift },
          { id: 'agent' as const, label: 'Agent 回复', icon: Network },
          { id: 'support' as const, label: 'AI 客服中心', icon: Bot },
          { id: 'logs' as const, label: '规则日志', icon: ScrollText },
        ].map(/* 当前回调处理用户交互或异步状态变化。 */ tab => {
          // Icon 渲染Icon React 组件。
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setActiveTab(tab.id)}
              className={`console-tab inline-flex items-center gap-2 ${activeTab === tab.id ? 'is-active' : ''}`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

	  {activeTab === 'automation' && (visibleAutomationIssues.runs.length > 0 || visibleAutomationIssues.pending_tasks.length > 0) ? (
	    <AutomationIssuePanel
	      runs={visibleAutomationIssues.runs}
	      pendingTasks={visibleAutomationIssues.pending_tasks}
	      onResolveRun={/* 当前回调处理用户交互或异步状态变化。 */ (id, resolution) => void handleResolveRunIssue(id, resolution)}
	      onResolveDeferredTask={/* 当前回调处理用户交互或异步状态变化。 */ (id, resolution) => void handleResolveDeferredIssue(id, resolution)}
	      isRunPending={/* 当前回调查询运行异常恢复决策的提交状态。 */ (id, resolution) => isPending(ruleActionKey.issueRun(id, resolution))}
	      isDeferredPending={/* 当前回调查询延迟任务处理决策的提交状态。 */ (id, resolution) => isPending(ruleActionKey.issueDeferred(id, resolution))}
	    />
	  ) : null}

      {activeTab === 'automation' && (
        <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(270px,0.72fr)_minmax(0,1.28fr)]">
          <aside className="min-w-0 space-y-4">
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <h3 className="font-black text-gray-900 mb-1">新建规则</h3>
              <p className="text-sm text-gray-500 mb-4">先选自动化类型，再配置对应动作。</p>
              <div className="space-y-3">
                {triggerOrder.map(/* 当前回调处理集合中的单个元素。 */ trigger => {
                  // meta 元数据。
                  const meta = triggerMeta[trigger];
                  // Icon 渲染Icon React 组件。
                  const Icon = meta.icon;
                  return (
                    <button
                      key={trigger}
                      type="button"
                      onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => openNewAutomationRule(trigger)}
                      className={`w-full text-left rounded-2xl border p-4 transition-colors ${accentClasses(meta.accent)}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/80 flex items-center justify-center shrink-0">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-extrabold">{meta.label}</div>
                          <div className="text-xs opacity-75 mt-1 leading-5">{meta.description}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
				<h3 className="font-black text-gray-900">筛选结果构成</h3>
				<span className="text-xs font-bold text-gray-400">共 {automationTotal} 条</span>
			  </div>
              <div className="space-y-3">
                {triggerOrder.map(/* 当前回调处理集合中的单个元素。 */ trigger => {
                  // meta 元数据。
                  const meta = triggerMeta[trigger];
                  // Icon 渲染Icon React 组件。
                  const Icon = meta.icon;
                  return (
                    <div key={trigger} className="flex items-center justify-between rounded-2xl bg-gray-50 p-3">
                      <div className="flex items-center gap-3">
                        <Icon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-bold text-gray-700">{meta.shortLabel}</span>
                      </div>
                      <span className="text-sm font-black text-gray-900">{automationTriggerCounts[trigger] || 0}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

		  <section className="min-w-0 space-y-4">
			<div className="rounded-xl border border-gray-100 bg-surface-muted p-4 shadow-sm">
			  <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
				<div className="relative min-w-0 flex-1">
				  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
				  <input
					type="search"
					aria-label="搜索自动化规则"
					placeholder="搜索规则名、商品名或商品 ID..."
					value={automationSearch}
					onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => {
					  setAutomationSearch(event.target.value);
					  setAutomationPage(1);
					}}
					className="ios-input w-full rounded-xl border-none bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm"
				  />
				</div>
				<div className="relative xl:w-52">
				  <SlidersHorizontal className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
				  <select
					aria-label="按自动化类型筛选"
					value={automationTriggerFilter}
					onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => {
					  setAutomationTriggerFilter(event.target.value as AutomationTriggerType | '');
					  setAutomationPage(1);
					}}
					className="ios-input w-full rounded-xl border-none bg-white py-2.5 pl-10 pr-9 text-sm shadow-sm"
				  >
					<option value="">全部自动化类型</option>
					{triggerOrder.map(/* 当前回调处理集合中的单个元素。 */ trigger => <option key={trigger} value={trigger}>{triggerMeta[trigger].shortLabel}</option>)}
				  </select>
				</div>
				<select
				  aria-label="按启用状态筛选"
				  value={automationStatusFilter}
				  onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => {
					setAutomationStatusFilter(event.target.value as 'all' | 'enabled' | 'disabled');
					setAutomationPage(1);
				  }}
				  className="ios-input rounded-xl border-none bg-white px-4 py-2.5 text-sm shadow-sm xl:w-36"
				>
				  <option value="all">全部状态</option>
				  <option value="enabled">已启用</option>
				  <option value="disabled">已禁用</option>
				</select>
				{hasAutomationListFilters && (
				  <button
					type="button"
					onClick={clearAutomationListFilters}
					className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900"
					title="清除筛选"
					aria-label="清除筛选"
				  >
					<X className="h-4 w-4" />
				  </button>
				)}
			  </div>
			  <div className="mt-3 flex items-center justify-between text-xs font-bold text-gray-400">
				<span>找到 {automationTotal} 条规则</span>
				{loading && <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 animate-spin" />正在更新</span>}
			  </div>
			</div>

			{automationError && visibleAutomationRules.length > 0 && (
			  <RulesLoadNotice message={`自动化规则刷新失败：${automationError}`} onRetry={/* 当前回调重试自动化规则列表。 */ () => void refresh()} />
			)}
			<AsyncStateView
			  loading={loading && visibleAutomationRules.length === 0}
			  error={automationError && visibleAutomationRules.length === 0 ? automationError : undefined}
			  empty={!loading && !automationError && visibleAutomationRules.length === 0}
			  onRetry={/* 当前回调重试自动化规则列表。 */ () => void refresh()}
			  emptyTitle={hasAutomationListFilters ? '没有匹配的自动化规则' : '还没有自动化规则'}
			  emptyDescription={hasAutomationListFilters ? '调整或清除筛选条件后再试。' : '从左侧选择一个模板开始配置。'}
			  loadingText="正在加载规则"
			>
			  {visibleAutomationRules.length > 0 ? visibleAutomationRules.map(/* 当前回调处理集合中的单个元素。 */ rule => {
                // meta 元数据。
                const meta = triggerMeta[rule.trigger_type];
                // Icon 渲染Icon React 组件。
                const Icon = meta.icon;
                // togglePending 表示当前规则启停是否正在提交。
                const togglePending = isPending(ruleActionKey.automationToggle(rule.id));
                // deletePending 表示当前规则删除是否正在提交。
                const deletePending = isPending(ruleActionKey.automationDelete(rule.id));
                return (
                  <article key={rule.id} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-lg transition-all">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="flex items-start gap-4 min-w-0">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${accentClasses(meta.accent, true)}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h3 className="text-lg font-black text-gray-900 truncate">{rule.name}</h3>
                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${statusPill(rule.enabled)}`}>
                              {rule.enabled ? '已启用' : '已禁用'}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs font-bold">
                            <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600">{meta.label}</span>
                            <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600">{rule.item_title || rule.item_id || '账号级规则'}</span>
                            {needsAllItemsConfirmation(rule) && <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800">需确认适用于全部商品 · 暂不发货</span>}
                            <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700">{actionSummary(rule)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => openAutomationRule(rule)}
                          className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold flex items-center gap-2"
                        >
                          <Edit className="w-4 h-4" />
                          编辑
                        </button>
                        <button
                          onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleToggleAutomation(rule)}
                          disabled={togglePending || deletePending}
                          className={`px-4 py-2 rounded-xl text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${rule.enabled ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                        >
                          {togglePending ? '处理中…' : rule.enabled ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleDeleteAutomation(rule.id)}
                          disabled={deletePending || togglePending}
                          className="p-2.5 rounded-xl text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
			  }) : undefined}
			</AsyncStateView>

			{automationTotal > 0 && (
			  <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center gap-3 text-sm font-medium text-gray-500">
				  <span>第 {automationPage} / {Math.max(automationTotalPages, 1)} 页</span>
				  <span className="h-4 w-px bg-gray-200" />
				  <label className="flex items-center gap-2">
					<span className="sr-only">每页显示数量</span>
					<select
					  value={automationPageSize}
					  onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => {
						setAutomationPageSize(Number(event.target.value));
						setAutomationPage(1);
					  }}
					  className="ios-input rounded-lg border-none bg-gray-50 px-2.5 py-2 text-sm"
					>
					  {[10, 20, 50].map(/* 当前回调处理集合中的单个元素。 */ size => <option key={size} value={size}>{size} 条/页</option>)}
					</select>
				  </label>
				</div>
				<div className="flex items-center gap-1.5">
				  <button
					type="button"
					disabled={automationPage <= 1 || loading}
					onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setAutomationPage(/* 当前回调处理用户交互或异步状态变化。 */ page => Math.max(1, page - 1))}
					className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50 text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label="上一页"
					title="上一页"
				  >
					<ChevronLeft className="h-4 w-4" />
				  </button>
				  {automationPageNumbers.map(/* 当前回调处理集合中的单个元素。 */ pageNumber => (
					<button
					  key={pageNumber}
					  type="button"
					  disabled={loading}
					  onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setAutomationPage(pageNumber)}
					  className={`h-9 min-w-9 rounded-lg px-2 text-sm font-bold transition-colors ${pageNumber === automationPage ? 'bg-brand text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'} disabled:cursor-not-allowed disabled:opacity-60`}
					  aria-label={`第 ${pageNumber} 页`}
					  aria-current={pageNumber === automationPage ? 'page' : undefined}
					>
					  {pageNumber}
					</button>
				  ))}
				  <button
					type="button"
					disabled={automationPage >= automationTotalPages || loading}
					onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setAutomationPage(/* 当前回调处理用户交互或异步状态变化。 */ page => Math.min(automationTotalPages, page + 1))}
					className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50 text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label="下一页"
					title="下一页"
				  >
					<ChevronRight className="h-4 w-4" />
				  </button>
				</div>
			  </div>
			)}
		  </section>
        </div>
      )}

      {activeTab === 'reply' && (
        <section className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 px-4 py-2 rounded-xl mb-5 w-fit">
            <AlertCircle className="w-4 h-4" />
            这里只处理买家用户消息；系统通知不会进入关键词或 AI 回复。
          </div>
          <div className="space-y-3">
            {replyError && replyRules.length > 0 && (
              <RulesLoadNotice message={`关键词回复刷新失败：${replyError}`} onRetry={/* 当前回调重试关键词回复列表。 */ () => void refresh()} />
            )}
            <AsyncStateView
              loading={loading && replyRules.length === 0}
              error={replyError && replyRules.length === 0 ? replyError : undefined}
              empty={!loading && !replyError && replyRules.length === 0}
              onRetry={/* 当前回调重试关键词回复列表。 */ () => void refresh()}
              emptyTitle="暂无关键词回复规则"
              emptyDescription="点击右上角新增关键词，配置命中后的自动回复。"
              loadingText="正在加载关键词回复"
            >
            {replyRules.length > 0 ? replyRules.map(/* rule 是当前列表中待展示的关键词回复规则。 */ rule => {
              // itemLabels 是当前规则关联商品的可读标签集合。
              const itemLabels = replyRuleItemLabels(rule);
              // expressions 是当前规则按 OR 语义展示的表达式集合，兼容旧 keyword 单值。
              const expressions = rule.expressions?.length ? rule.expressions : (rule.keyword ? [rule.keyword] : []);
              // firstExpression 是列表中突出展示的首个表达式。
              const firstExpression = expressions[0] || '';
              // additionalExpressionCount 是除首项外仍隐藏在规则中的表达式数量。
              const additionalExpressionCount = Math.max(0, expressions.length - 1);
              // matchLabel 是列表中说明当前规则匹配模式的中文标签。
              const matchLabel = rule.match_type === 'regexp' ? '正则表达式' : '包含匹配';
              // deletePending 表示当前关键词回复删除是否正在提交。
              const deletePending = isPending(ruleActionKey.replyDelete(rule.id));
              return (
              <div key={rule.id} className="flex flex-col md:flex-row md:items-center justify-between p-5 rounded-2xl border border-gray-100 bg-surface-subtle hover:bg-white hover:shadow-lg transition-all gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <span className={`px-3 py-1 rounded-lg text-xs font-bold ${rule.match_type === 'regexp' ? 'bg-purple-100 text-purple-700' : 'bg-black text-white'}`}>{matchLabel}</span>
                    <h3 className="font-bold text-gray-900">“{firstExpression}”</h3>
                    {additionalExpressionCount > 0 && (
                      <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold">+{additionalExpressionCount} 个表达式</span>
                    )}
                    {rule.notify_manual && (
                      <span className="px-3 py-1 bg-orange-50 text-orange-700 rounded-lg text-xs font-bold">通知人工</span>
                    )}
                    {itemLabels.length === 0 ? (
                      <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold">账号级</span>
                    ) : (
                      itemLabels.map(/* label 是当前规则关联商品的可读标题。 */ label => (
                        <span key={`${rule.id}-${label}`} className="max-w-[16rem] truncate px-3 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold" title={label}>{label}</span>
                      ))
                    )}
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-gray-100 text-sm text-gray-600 leading-relaxed">
                    {rule.type === 'image' ? (rule.image_url || (rule.library_image_id ? `图片库图片 #${rule.library_image_id}` : '')) : rule.reply_content}
                  </div>
                </div>
                <div className="flex items-center gap-3 border-t md:border-t-0 md:border-l border-gray-200 pt-4 md:pt-0 md:pl-6">
                  <button
                    onClick={/* 当前回调处理用户编辑并回填历史表达式和匹配模式。 */ () => {
                      // editExpressions 是编辑器需要展示的表达式行，兼容旧 keyword 响应。
                      const editExpressions = rule.expressions?.length ? rule.expressions : [rule.keyword || ''];
                      // editMatchType 是编辑器支持的匹配模式，历史 fuzzy/exact 均按 contains 展示。
                      const editMatchType = rule.match_type === 'regexp' ? 'regexp' : 'contains';
                      setEditingReplyRule({ ...rule, expressions: editExpressions, keyword: editExpressions[0] || '', match_type: editMatchType });
                      setShowReplyModal(true);
                    }}
                    disabled={deletePending}
                    className="p-2 text-gray-400 hover:text-black hover:bg-gray-100 rounded-xl transition-colors"
                    title="编辑"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button disabled={deletePending} onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleDeleteReply(rule.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50" title="删除">
                    {deletePending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              );
            }) : undefined}
            </AsyncStateView>
          </div>
        </section>
      )}

      {activeTab === 'default' && (
        <section className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 px-4 py-2 rounded-xl mb-5 w-fit">
            <AlertCircle className="w-4 h-4" />
            默认回复只处理买家用户消息；关键词未命中且 AI 未接管时才会使用。
          </div>
          <div className="space-y-3">
            {defaultRepliesError && visibleDefaultAccounts.length > 0 && (
              <RulesLoadNotice message={`默认回复配置刷新失败：${defaultRepliesError}。为避免覆盖服务端配置，编辑和删除已暂停。`} onRetry={/* 当前回调重试默认回复配置。 */ () => void refresh()} />
            )}
            <AsyncStateView
              loading={loading && visibleDefaultAccounts.length === 0}
              error={defaultRepliesError && visibleDefaultAccounts.length === 0 ? defaultRepliesError : undefined}
              empty={!loading && !defaultRepliesError && visibleDefaultAccounts.length === 0}
              onRetry={/* 当前回调重试规则页全部数据。 */ () => void refresh()}
              emptyTitle="暂无账号"
              emptyDescription="请先在账号管理中登录账号，再配置默认回复。"
              loadingText="正在加载默认回复"
            >
            {visibleDefaultAccounts.length > 0 ? visibleDefaultAccounts.map(/* 当前回调处理集合中的单个元素。 */ account => {
              // defaultReply 默认Reply，负责当前功能中的对应处理。
              const defaultReply = defaultReplies[account.id];
              // enabled 启用状态。
              const enabled = Boolean(defaultReply?.enabled);
              // openPending 表示当前账号默认回复是否正在读取。
              const openPending = isPending(ruleActionKey.defaultOpen(account.id));
              // clearPending 表示当前账号默认回复记录是否正在清理。
              const clearPending = isPending(ruleActionKey.defaultClearRecords(account.id));
              // deletePending 表示当前账号默认回复是否正在删除。
              const deletePending = isPending(ruleActionKey.defaultDelete(account.id));
              // defaultActionsDisabled 表示默认回复读取失败或正在执行同类操作时必须暂停入口。
              const defaultActionsDisabled = Boolean(defaultRepliesError) || openPending || clearPending || deletePending;
              return (
                <div key={account.id} className={`flex flex-col md:flex-row md:items-center justify-between p-5 rounded-2xl border transition-all gap-4 ${enabled ? 'border-purple-100 bg-purple-50/50 hover:bg-white hover:shadow-lg' : 'border-gray-100 bg-surface-subtle hover:bg-white hover:shadow-lg'}`}>
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${enabled ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
                      <Bot className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-bold text-gray-900 text-lg truncate">{accountLabel(account)}</h3>
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                          {enabled ? '已启用' : '未启用'}
                        </span>
                        {defaultReply?.reply_once && (
                          <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-purple-100 text-purple-700">只回复一次</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 line-clamp-2">
                        {enabled ? (defaultReply.reply_content || defaultReply.reply_image_url || (defaultReply.reply_library_image_id ? `图片库图片 #${defaultReply.reply_library_image_id}` : '已配置默认回复')) : '未配置默认回复'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 border-t md:border-t-0 md:border-l border-gray-200 pt-4 md:pt-0 md:pl-6">
                    <button
                      onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => void openDefaultReplyModal(account.id)}
                      disabled={defaultActionsDisabled}
                      className="p-2 text-gray-400 hover:text-black hover:bg-gray-100 rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      title="编辑"
                    >
                      {openPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Edit className="w-4 h-4" />}
                    </button>
                    {enabled && (
                      <>
                        <button
                          onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => void handleClearDefaultReplyRecords(account.id)}
                          disabled={defaultActionsDisabled}
                          className="px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {clearPending ? '清理中…' : '清空记录'}
                        </button>
                        <button disabled={defaultActionsDisabled} onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => void handleDeleteDefaultReply(account.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50" title="删除">
                          {deletePending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            }) : undefined}
            </AsyncStateView>
          </div>
        </section>
      )}

      {activeTab === 'greeting' && <ItemGreetingPanel accountID={selectedAccountId} libraryImageChooser={libraryImageChooser} />}

      {activeTab === 'agent' && <AgentReplyPanel accountID={selectedAccountId} />}

      {activeTab === 'support' && SupportPanel && <Suspense fallback={<p className="p-5 text-sm text-gray-500">加载客服中心…</p>}><SupportPanel accountId={selectedAccountId} accounts={accounts} items={items} /></Suspense>}

      {activeTab === 'logs' && (
        AuditPanel ? (
          <Suspense fallback={<div className="text-center py-20 text-gray-400">加载中…</div>}>
            <AuditPanel key={selectedAccountId} accountId={selectedAccountId} accountLabel={auditAccountLabel} />
          </Suspense>
        ) : (
          <div className="text-center py-20 text-gray-400">规则日志暂不可用</div>
        )
      )}

      {showAutomationModal && editingAutomationRule && createPortal(
        <div
          className="modal-overlay"
          onMouseDown={/* 当前回调仅在点击遮罩且未提交时关闭自动化弹窗。 */ event => {
            if (event.target === event.currentTarget && !automationSaving) setShowAutomationModal(false);
          }}
        >
          <div
            ref={automationDialogRef}
            className="modal-container"
            role="dialog"
            aria-modal="true"
            aria-labelledby="automation-rule-dialog-title"
            tabIndex={-1}
            style={{ maxWidth: '72rem', maxHeight: '92vh' }}
          >
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 id="automation-rule-dialog-title" className="text-2xl font-black text-gray-900">{editingAutomationRule.id ? '编辑自动化规则' : '新建自动化规则'}</h3>
                <p className="text-sm text-gray-500 mt-1">{currentMeta.description}</p>
              </div>
              <button
                onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setShowAutomationModal(false)}
                disabled={automationSaving}
                className="w-10 h-10 rounded-2xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
                title="关闭"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <fieldset disabled={automationSaving} className={`m-0 grid min-w-0 grid-cols-1 border-0 p-0 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] min-h-0 ${automationSaving ? 'pointer-events-none opacity-60' : ''}`}>
              <aside className="bg-slate-900 text-white p-5 overflow-y-auto">
                <div className="text-xs font-bold text-slate-400 mb-3">选择自动化类型</div>
                <div className="space-y-3">
                  {triggerOrder.map(/* 当前回调处理集合中的单个元素。 */ trigger => {
                    // meta 元数据。
                    const meta = triggerMeta[trigger];
                    // Icon 渲染Icon React 组件。
                    const Icon = meta.icon;
                    // selected 处理当前选择（ed）。
                    const selected = currentTrigger === trigger;
                    return (
                      <button
                        key={trigger}
                        type="button"
                        onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleTriggerChange(trigger)}
                        className={`w-full rounded-2xl p-4 text-left border transition-all ${
                          selected ? 'bg-white text-slate-950 border-white' : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <Icon className={`w-5 h-5 mt-0.5 ${selected ? 'text-brand' : 'text-white'}`} />
                          <div>
                            <div className="font-black">{meta.label}</div>
                            <div className={`text-xs mt-1 leading-5 ${selected ? 'text-gray-500' : 'text-gray-400'}`}>{meta.description}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-4">
                  <div className="text-xs font-bold text-slate-400 mb-3">执行流程</div>
                  <div className="space-y-3">
                    {currentMeta.flow.map(/* 当前回调处理集合中的单个元素。 */ (step, index) => (
                      <div key={step} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-white text-slate-950 text-xs font-black flex items-center justify-center">{index + 1}</div>
                        <span className="text-sm font-bold text-gray-100">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>

              <div className="min-w-0 overflow-x-hidden overflow-y-auto bg-surface-subtle p-6">
                <div className="space-y-5">
                  {automationSaveError && (
                    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                      {automationSaveError}
                    </div>
                  )}
                  <section className="bg-white rounded-3xl border border-gray-100 p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <CheckCircle2 className="w-5 h-5 text-brand" />
                      <h4 className="font-black text-gray-900">生效范围</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-sm font-bold text-gray-700 mb-2">规则名称</label>
                        <input
                          type="text"
                          value={editingAutomationRule.name || ''}
                          onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setEditingAutomationRule({ ...editingAutomationRule, name: event.target.value })}
                          placeholder="不填时按类型和商品自动生成"
                          className="w-full ios-input px-4 py-3 rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">闲鱼账号</label>
                        <select
                          value={editingAutomationRule.cookie_id || ''}
                          onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setEditingAutomationRule({
                            ...editingAutomationRule,
                            cookie_id: event.target.value,
                            config_json: withAllItemsConfirmation(editingAutomationRule.config_json, false),
                            item_id: '',
                            item_title: '',
                            item_keyword: '',
                          })}
                          className="w-full ios-input px-4 py-3 rounded-xl"
                        >
                          <option value="">选择账号</option>
                          {accounts.map(/* 当前回调处理集合中的单个元素。 */ account => (
                            <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">关联商品</label>
                        <select
                          value={editingAutomationRule.item_id || ''}
                          onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => handleAutomationItemChange(event.target.value)}
                          className="w-full ios-input px-4 py-3 rounded-xl"
                        >
                          <option value="">账号级规则（不限定商品）</option>
                          {modalAccountItems.map(/* 当前回调处理集合中的单个元素。 */ item => (
                            <option key={`${item.cookie_id}-${item.item_id}`} value={item.item_id}>{item.item_title || item.item_id}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {selectedRuleItem && currentTrigger !== 'review_missing_timeout' && currentTrigger !== 'order_created' && (
                      <div className="mt-4 rounded-2xl bg-gray-50 border border-gray-100 p-4">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-bold">{selectedRuleItem.item_title || selectedRuleItem.item_id}</span>
                          <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${isMultiSpecRule ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                            {isMultiSpecRule ? '多规格商品' : '普通商品'}
                          </span>
                          <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700">按订单购买数量自动发货</span>
                        </div>
                        <p className="text-xs leading-5 text-gray-500">
                          多规格状态来自闲鱼商品本身，发布后不能在这里修改；系统会在买家付款后读取订单详情，按实际购买规格和数量匹配下面的发货规则。
                        </p>
                      </div>
                    )}
                  </section>

                  {currentTrigger === 'order_paid' && !editingAutomationRule.item_id ? (
                    <AllItemsConfirmation
                      confirmed={reviewConfig.allow_all_items === true}
                      onChange={
                        // confirmed 是用户对账号下全部商品适用范围的明确选择；更新时保留其他规则配置。
                        confirmed => setEditingAutomationRule({ ...editingAutomationRule, config_json: withAllItemsConfirmation(editingAutomationRule.config_json, confirmed) })
                      }
                    />
                  ) : null}

                  {currentTrigger === 'order_paid' && (
                    <section className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input type="checkbox" aria-label="确认发货后自动求小红花"
                          checked={reviewConfig.request_red_flower === true}
                          onChange={/* enabled 表示买家付款规则是否在确认发货成功后调用原生求花接口。 */ event => setEditingAutomationRule({
                            ...editingAutomationRule,
                            config_json: JSON.stringify({ ...reviewConfig, request_red_flower: event.target.checked }),
                          })}
                          className="mt-1 h-4 w-4 shrink-0 accent-brand focus-visible:ring-2 focus-visible:ring-brand/30" />
                        <span className="min-w-0">
                          <span className="block font-bold text-gray-900">确认发货后自动求小红花</span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">
                            通过闲鱼订单的原生“求小红花”功能发送，不是聊天催评价。仅对启用后新触发的订单生效，
                            必须在账号管理中同时开启“自动发货”和“自动确认发货”；发送内容成功且平台确认发货后才求花，每笔订单最多执行一次。
                          </span>
                        </span>
                      </label>
                    </section>
                  )}

                  {currentTrigger === 'order_created' ? (
                    <section className="bg-white rounded-3xl border border-gray-100 p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <CircleDollarSign className="w-5 h-5 text-violet-600" />
                        <h4 className="font-black text-gray-900">改价设置</h4>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2">目标价格（元）</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={adjustPriceTarget(editingAutomationRule.actions)}
                            onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => updateAdjustPriceTarget(event.target.value)}
                            placeholder="例如：9.9"
                            className="w-full ios-input px-4 py-3 rounded-xl"
                          />
                          <p className="text-xs text-gray-500 mt-2">买家拍下未付款后，系统会把该笔订单价格修改为此金额（0.01 - 1000000 元，最多两位小数）。</p>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2">改价后提醒买家（可选）</label>
                          <textarea
                            value={editingAutomationRule.actions?.find(/* 当前回调处理集合中的单个元素。 */ action => action.action_type === 'send_text')?.message_template || ''}
                            onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => updateAdjustPriceNotifyText(event.target.value)}
                            placeholder="例如：已为您改好价格，请尽快支付哦～"
                            className="w-full ios-input px-4 py-3 rounded-xl h-24 resize-none"
                          />
                          <p className="text-xs text-gray-500 mt-2">留空则只改价不发送消息。</p>
                        </div>
                      </div>
                      <div className="mt-4 rounded-2xl bg-violet-50 border border-violet-100 p-4">
                        <p className="text-xs leading-5 text-violet-700">
                          改价仅对买家尚未付款的订单生效；订单已付款、已关闭或平台限制改价时任务会记录失败原因。建议配合商品说明引导买家「先拍下再等改价」。
                        </p>
                      </div>
                    </section>
                  ) : currentTrigger !== 'review_missing_timeout' ? (
                    <section className="bg-white rounded-3xl border border-gray-100 p-5">
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <Layers3 className="w-5 h-5 text-brand" />
                            <h4 className="font-black text-gray-900">{currentTrigger === 'buyer_reviewed' ? '赠品内容' : '发货内容'}</h4>
                          </div>
                          <p className="text-sm text-gray-500 mt-1">
                            {isMultiSpecRule
                              ? '每条发货内容绑定一个订单规格；同一规格可添加多条内容并全部发送。'
                              : '可添加多条发货内容，买家付款后会按顺序全部发送。'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={appendDeliveryContent}
                          className="px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-bold hover:bg-black flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          添加发货内容
                        </button>
                      </div>

                      <div className="space-y-3">
                        {!SHOW_CARD_UI && displayVariants.every(/* variant 判断是否没有任何可编辑的发货模板。 */ variant => !isVisibleShippingVariant(variant, deliveryTemplates)) && (
                          <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                            当前没有可编辑的发货模板，可点击“添加发货内容”配置新的发货模板；已有历史配置会保留。
                          </p>
                        )}
                        {displayVariants.map((variant, index) => (/* 旧库存模式保留在编辑草稿及保存载荷中，但隐藏对应前端编辑行。 */
                          !isVisibleShippingVariant(variant, deliveryTemplates) ? null :
                          <div
                            key={variant.id || index}
                            className={`rules-delivery-grid grid min-w-0 grid-cols-1 gap-3 items-end rounded-2xl border border-gray-200 p-4 ${isMultiSpecRule ? 'rules-delivery-grid-multi' : ''}`}
                          >
                            {isMultiSpecRule && (
                              <>
                                <div>
                                  <label className="block text-xs font-bold text-gray-600 mb-2">规格名称（多 SKU 用；连接）</label>
                                  <input
                                    value={variant.spec_name}
                                    onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => updateVariant(index, { spec_name: event.target.value })}
                                    className="w-full ios-input px-3 py-2.5 rounded-lg"
                                    placeholder="例如：颜色；尺码"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-bold text-gray-600 mb-2">规格值（按同顺序填写）</label>
                                  <input
                                    value={variant.spec_value}
                                    onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => updateVariant(index, { spec_value: event.target.value })}
                                    className="w-full ios-input px-3 py-2.5 rounded-lg"
                                    placeholder="例如：红色；M"
                                  />
                                </div>
                              </>
                            )}
                            <div>
                              <label className="block text-xs font-bold text-gray-600 mb-2">发货方式</label>
                              <select
                                value={variant.delivery_mode || 'card'}
                                onChange={/* 当前回调切换卡密库存和模板两种发货模式。 */ event => updateVariant(index, { delivery_mode: event.target.value as 'card' | 'template', card_id: 0, delivery_template_id: 0, template_bindings: [] })}
                                className="w-full ios-input px-3 py-2.5 rounded-lg"
                              >
                                {SHOW_CARD_UI && <option value="card">卡密库存</option>}
                                <option value="template">发货模板</option>
                              </select>
                            </div>
                            {variant.delivery_mode === 'template' ? (
                              <TemplateVariantEditor index={index} variant={variant} cards={cards} deliveryTemplates={deliveryTemplates} updateVariant={updateVariant} />
                            ) : SHOW_CARD_UI ? (
                              <div>
                                <label className="block text-xs font-bold text-gray-600 mb-2">卡密库存</label>
                                <SearchableSelect
                                  options={cards.filter(isDeliveryCardReady).map(/* card 转换为可搜索选项，仅保留主键与名称。 */ card => ({ value: card.id, label: card.name }))}
                                  value={variant.card_id}
                                  onChange={/* cardID 是用户选中的卡密库存主键，0 表示清空。 */ cardID => updateVariant(index, { card_id: cardID })}
                                  placeholder="请选择卡密库存"
                                  ariaLabel="卡密库存"
                                />

                              </div>
                            ) : null}
                            <div>
                              <label className="block text-xs font-bold text-gray-600 mb-2">每件份数</label>
                              <input
                                type="number"
                                min="1"
                                max="100"
                                value={variant.delivery_count}
                                onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => updateVariant(index, { delivery_count: Math.max(1, Number(event.target.value) || 1) })}
                                className="w-full ios-input px-3 py-2.5 rounded-lg"
                              />
                            </div>
                            <div className="md:col-span-full flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 px-3 py-2">
                              <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={variant.delay_override === true}
                                  onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => updateVariant(index, { delay_override: event.target.checked })}
                                  className="accent-brand"
                                />
                                覆盖默认延时
                              </label>
                              {variant.delay_override && (
                                <input
                                  type="number"
                                  min="0"
                                  max="3600"
                                  value={variant.delay_seconds || 0}
                                  onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => updateVariant(index, { delay_seconds: Math.max(0, Number(event.target.value) || 0) })}
                                  className="w-28 ios-input px-2 py-1.5 rounded-lg text-xs"
                                  aria-label="动作延时秒数"
                                />
                              )}
                              <span className="text-xs text-gray-500">{variant.delay_override ? `本动作延时 ${variant.delay_seconds || 0} 秒` : '使用默认延时'}</span>
                            </div>
                            <button
                              type="button"
                              disabled={displayVariants.filter(/* current 计算可见的发货内容行，历史隐藏行不能阻止删除。 */ current => isVisibleShippingVariant(current, deliveryTemplates)).length === 1}
                              onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setEditingAutomationRule({
                                ...editingAutomationRule,
                                variants: displayVariants.filter(/* 当前回调处理集合中的单个元素。 */ (_, variantIndex) => variantIndex !== index),
                              })}
                              className="w-10 h-10 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-25"
                              title="删除发货内容"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : (
                    <section className="bg-white rounded-3xl border border-gray-100 p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <Clock3 className="w-5 h-5 text-amber-600" />
                        <h4 className="font-black text-gray-900">求评价计划</h4>
                      </div>
                      <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                        <input
                          type="checkbox"
                          aria-label="买家确认收货后立即发送求评价"
                          checked={reviewConfig.trigger_on_completed === true}
                          onChange={/* enabled 表示确认收货事件到达后是否立即发送首次求评价。 */ event => setEditingAutomationRule({
                            ...editingAutomationRule,
                            config_json: buildReviewConfig(editingAutomationRule.config_json, {
                              trigger_on_completed: event.target.checked,
                            }),
                          })}
                          className="mt-1 h-4 w-4 shrink-0 accent-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                        />
                        <span className="min-w-0">
                          <span className="block font-bold text-gray-900">买家确认收货后立即发送求评价</span>
                          <span className="mt-1 block text-xs leading-5 text-gray-600">
                            开启后，收到买家确认收货的系统提示就立即发送下方文案，不再等待“发货后等待小时”。
                            确认收货事件丢失时，调度器会在最近一次扫描中补发；同一订单首次求评价只发送一次，重复提醒仍按“再次求评间隔”和“最多求评次数”执行。
                          </span>
                        </span>
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2">
                            发货后等待小时{reviewConfig.trigger_on_completed === true ? '（立即模式不生效）' : ''}
                          </label>
                          <input
                            type="number"
                            min="1"
                            disabled={reviewConfig.trigger_on_completed === true}
                            value={Number(reviewConfig.after_shipped_hours || 72)}
                            onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setEditingAutomationRule({
                              ...editingAutomationRule,
                              config_json: buildReviewConfig(editingAutomationRule.config_json, {
                                after_shipped_hours: Math.max(1, Number(event.target.value) || 72),
                              }),
                            })}
                            className="w-full ios-input px-4 py-3 rounded-xl disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2">再次求评间隔小时</label>
                          <input
                            type="number"
                            min="1"
                            value={Number(reviewConfig.repeat_interval_hours || 24)}
                            onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setEditingAutomationRule({
                              ...editingAutomationRule,
                              config_json: buildReviewConfig(editingAutomationRule.config_json, {
                                repeat_interval_hours: Math.max(1, Number(event.target.value) || 24),
                              }),
                            })}
                            className="w-full ios-input px-4 py-3 rounded-xl"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2">最多求评次数</label>
                          <input
                            type="number"
                            min="1"
                            value={Number(reviewConfig.max_attempts || 1)}
                            onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setEditingAutomationRule({
                              ...editingAutomationRule,
                              config_json: buildReviewConfig(editingAutomationRule.config_json, {
                                max_attempts: Math.max(1, Number(event.target.value) || 1),
                              }),
                            })}
                            className="w-full ios-input px-4 py-3 rounded-xl"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="block text-sm font-bold text-gray-700 mb-2">
                            {reviewConfig.trigger_on_completed === true ? '仅处理最近 N 小时内确认收货的订单' : '仅处理最近 N 小时内发货的订单'}
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={reviewLookbackHours(editingAutomationRule.config_json)}
                            onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setEditingAutomationRule({
                              ...editingAutomationRule,
                              config_json: buildReviewConfig(editingAutomationRule.config_json, {
                                max_lookback_hours: Math.max(1, Number(event.target.value) || 1),
                              }),
                            })}
                            className="w-full ios-input px-4 py-3 rounded-xl"
                          />
                          <p className="text-xs text-gray-500 mt-2">
                            {reviewConfig.trigger_on_completed === true
                              ? '确认收货时间早于该窗口的订单不会补发求评价，避免规则停用后重新启用时给历史订单补发消息。'
                              : '发货时间早于该窗口的订单不会求评价，避免规则停用后重新启用时给历史订单补发消息。'}
                            默认值为走完全部求评流程所需时长再加 24 小时；填写值不会小于「发货后等待小时」。
                          </p>
                        </div>
                        <div className="md:col-span-3">
                          <label className="block text-sm font-bold text-gray-700 mb-2">求评价文案</label>
                          <textarea
                            value={editingAutomationRule.actions?.find(/* 当前回调处理集合中的单个元素。 */ action => action.action_type === 'send_text')?.message_template || ''}
                            onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setEditingAutomationRule({
                              ...editingAutomationRule,
                              actions: (editingAutomationRule.actions?.length ? editingAutomationRule.actions : cardActionsForTrigger('review_missing_timeout')).map(/* 当前回调处理用户交互或异步状态变化。 */ action =>
                                action.action_type === 'send_text' ? { ...action, message_template: event.target.value } : action
                              ),
                            })}
                            className="w-full ios-input px-4 py-3 rounded-xl h-28 resize-none"
                          />
                        </div>
                      </div>
                    </section>
                  )}

                  <section className="bg-white rounded-3xl border border-gray-100 p-5">
                    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4 items-end">
                      <div>
						<label className="block text-sm font-bold text-gray-700 mb-2">优先级</label>
						<p className="text-xs text-gray-500 mb-2">数字越小优先级越高；同一账号、商品和触发条件只执行优先级最高的一条规则；商品级规则存在时，账号级规则不会生效。</p>
                        <input
                          type="number"
                          value={editingAutomationRule.priority || 100}
                          onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setEditingAutomationRule({ ...editingAutomationRule, priority: Number(event.target.value) || 100 })}
                          min="1"
                          className="w-full ios-input px-4 py-3 rounded-xl"
                        />
                      </div>
                      <label className="h-[48px] flex items-center gap-3 px-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-800">
                        <input
                          type="checkbox"
                          checked={editingAutomationRule.sku_migration_status !== 'needs_reconfiguration' && editingAutomationRule.enabled !== false}
                          disabled={editingAutomationRule.sku_migration_status === 'needs_reconfiguration'}
                          onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setEditingAutomationRule({ ...editingAutomationRule, enabled: event.target.checked })}
                          className="w-4 h-4 rounded"
                        />
                        启用规则
                      </label>
                    </div>
                  </section>
                </div>
              </div>
            </fieldset>

            <div className="px-6 py-4 border-t border-gray-100 bg-white flex gap-3">
              <button disabled={automationSaving} onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setShowAutomationModal(false)} className="flex-1 px-6 py-3 rounded-2xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50">
                取消
              </button>
              <button disabled={automationSaving} onClick={handleSaveAutomationRule} className="flex-1 ios-btn-primary px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
                <Save className="w-4 h-4" />
                {automationSaving ? '保存中…' : '保存自动化规则'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showReplyModal && editingReplyRule && (
        <ReplyRuleEditor
          rule={editingReplyRule}
          setRule={setEditingReplyRule}
          items={replyModalItems}
          onClose={/* 当前回调关闭关键词回复编辑器。 */ () => setShowReplyModal(false)}
          onSave={/* 当前回调提交关键词回复规则。 */ handleSaveReplyRule}
          libraryImageChooser={libraryImageChooser}
          saving={replySaving}
          error={replySaveError}
        />
      )}

      <DialogFrame
        open={showDefaultModal}
        title="账号默认回复"
        eyebrow="规则 / 默认回复"
        onClose={/* 当前回调关闭默认回复弹窗。 */ () => setShowDefaultModal(false)}
        closeDisabled={defaultReplySaving}
        busy={defaultReplySaving}
        size="lg"
        footer={defaultReplyReady ? (
          <>
            <button
              type="button"
              disabled={defaultReplySaving}
              onClick={/* 当前回调关闭默认回复弹窗。 */ () => setShowDefaultModal(false)}
              className="ios-btn-secondary px-5 py-2.5"
            >
              取消
            </button>
            <button
              type="button"
              disabled={defaultReplySaving}
              onClick={handleSaveDefaultReply}
              className="ios-btn-primary inline-flex items-center justify-center gap-2 px-5 py-2.5"
            >
              <Save className="w-4 h-4" />
              {defaultReplySaving ? '保存中…' : '保存默认回复'}
            </button>
          </>
        ) : undefined}
      >
        {defaultReplyLoading ? (
          <AsyncStateView loading error={undefined} empty={false} loadingText="正在读取默认回复" />
        ) : defaultReplyLoadError ? (
          <AsyncStateView loading={false} error={defaultReplyLoadError} empty={false} onRetry={/* 当前回调重试读取默认回复。 */ () => void retryDefaultReplyLoad()} />
        ) : defaultReplyReady ? (
          <fieldset disabled={defaultReplySaving} className="m-0 min-w-0 space-y-5 border-0 p-0">
            {defaultReplySaveError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {defaultReplySaveError}
              </div>
            )}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">闲鱼账号</label>
              <select
                value={defaultForm.cookie_id}
                disabled
                aria-describedby="default-reply-account-hint"
                className="w-full ios-input px-4 py-3 rounded-xl disabled:cursor-not-allowed disabled:opacity-70"
              >
                <option value="">选择账号</option>
                {accounts.map(/* 当前回调处理集合中的单个元素。 */ account => (
                  <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                ))}
              </select>
              <p id="default-reply-account-hint" className="mt-2 text-xs text-gray-500">默认回复按账号读取；如需编辑其他账号，请关闭弹窗后在列表中重新选择。</p>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div>
                <div className="font-bold text-gray-900">启用默认回复</div>
                <div className="text-xs text-gray-500 mt-1">启用后，未命中关键词时自动发送</div>
              </div>
              <button
                type="button"
                onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setDefaultForm({ ...defaultForm, enabled: !defaultForm.enabled })}
                className={`w-14 h-8 rounded-full transition-colors duration-300 relative ${defaultForm.enabled ? 'bg-brand' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 block ${defaultForm.enabled ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">回复内容</label>
              <textarea
                value={defaultForm.reply_content}
                onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setDefaultForm({ ...defaultForm, reply_content: event.target.value })}
                placeholder="输入默认回复内容"
                className="w-full ios-input px-4 py-3 rounded-xl h-32 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">回复图片（可选）</label>
              <ImageSourceField
                value={{ url: defaultForm.reply_image_url, libraryImageId: defaultForm.reply_library_image_id }}
                onChange={/* source 是用户选择的新图片来源；外链与图片库图片互斥。 */ source => setDefaultForm({ ...defaultForm, reply_image_url: source.url, reply_library_image_id: source.libraryImageId })}
                chooser={libraryImageChooser}
              />
            </div>

            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-800">
              <span>
                只回复一次
                <span className="block text-xs text-gray-500 font-medium mt-1">同一会话只发送一次默认回复</span>
              </span>
              <input
                type="checkbox"
                checked={defaultForm.reply_once}
                onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setDefaultForm({ ...defaultForm, reply_once: event.target.checked })}
                className="w-4 h-4 rounded"
              />
            </label>
          </fieldset>
        ) : null}
      </DialogFrame>
    </div>
  );
};

export default Rules;
