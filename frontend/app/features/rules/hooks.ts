import { useCallback,useRef,useState } from 'react';
import type {
AccountDetail,
AutomationTriggerType,
  Card,
  DefaultReply,
  DeliveryTemplate,
Item,
ReplyRule,
ShippingRule,
} from './api';
import {
getAccountDetails,
getAutomationIssues,
getCards,
  getDefaultReplies,
  getDeliveryTemplates,
getItems,
getReplyRules,
getShippingRulesPage,
} from './api';
import { isCurrentRequest,nextRequestGeneration } from './interactionState';
import type { AutomationIssueState,RulesDataOptions,RulesDataResult,RulesTab } from './types';
import { SHOW_CARD_UI } from '../../../shared/ui/featureVisibility';

// rulesLoadErrorMessage 把未知加载异常转换为可直接展示的中文失败说明。
const rulesLoadErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
};

// optionalReferenceMessage 把可选参考数据失败项汇总成一条降级提示。
const optionalReferenceMessage = (names: string[]): string =>
  names.length ? `以下参考数据加载失败，页面将继续使用已有数据：${names.join('、')}` : '';

// useRulesData 集中管理 Rules 页的服务端数据、请求代次和刷新动作。
export const useRulesData = (options: RulesDataOptions): RulesDataResult => {
  // automationRules 保存当前分页返回的自动化规则。
  const [automationRules, setAutomationRules] = useState<ShippingRule[]>([]);
  // automationIssues 保存自动化规则列表旁的人工处理异常。
  const [automationIssues, setAutomationIssues] = useState<AutomationIssueState>({ runs: [], pending_tasks: [] });
  // replyRules 保存当前账号的关键词回复规则。
  const [replyRules, setReplyRules] = useState<ReplyRule[]>([]);
  // defaultReplies 保存所有账号的默认回复配置。
  const [defaultReplies, setDefaultReplies] = useState<Record<string, DefaultReply>>({});
  // accounts 保存规则筛选和编辑器使用的账号摘要。
  const [accounts, setAccounts] = useState<AccountDetail[]>([]);
  // cards 保存规则动作可选的卡密库存。
  const [cards, setCards] = useState<Card[]>([]);
  // items 保存规则编辑器可绑定的商品。
  const [items, setItems] = useState<Item[]>([]);
  // deliveryTemplates 保存规则编辑器可选的发货模板。
  const [deliveryTemplates, setDeliveryTemplates] = useState<DeliveryTemplate[]>([]);
  // loading 表示当前规则页是否有刷新请求正在执行；初始为 true，避免首屏在首个请求发出前误显示空态。
  const [loading, setLoading] = useState(true);
  // referenceDataError 保存账号等必需参考数据加载失败文案。
  const [referenceDataError, setReferenceDataError] = useState('');
  // referenceDataWarning 保存可选参考数据降级提示，不阻断已有数据继续展示。
  const [referenceDataWarning, setReferenceDataWarning] = useState('');
  // automationError 保存自动化规则列表最近一次加载失败文案。
  const [automationError, setAutomationError] = useState('');
  // replyError 保存关键词回复列表最近一次加载失败文案。
  const [replyError, setReplyError] = useState('');
  // defaultRepliesError 保存默认回复配置最近一次读取失败文案。
  const [defaultRepliesError, setDefaultRepliesError] = useState('');
  // referenceDataRequest 保存参考数据请求的最新代次，防止旧账号列表覆盖新刷新结果。
  const referenceDataRequest = useRef(0);
  // automationRulesRequest 保存自动化列表请求的最新代次。
  const automationRulesRequest = useRef(0);
  // replyRulesRequest 保存关键词规则请求的最新代次。
  const replyRulesRequest = useRef(0);
  // replyRulesAccountRef 保存最近一次成功加载关键词规则的账号，用于账号切换时清空旧账号数据、同账号刷新时保留旧列表。
  const replyRulesAccountRef = useRef('');
  // defaultRepliesRequest 保存默认回复列表请求的最新代次，防止旧响应覆盖新配置。
  const defaultRepliesRequest = useRef(0);

  // automationTotal 保存服务端返回的自动化规则总数。
  const [automationTotal, setAutomationTotal] = useState(0);
  // automationTotalPages 保存服务端返回的自动化规则总页数。
  const [automationTotalPages, setAutomationTotalPages] = useState(0);
  // automationTriggerCounts 保存服务端按触发类型聚合的规则数量。
  const [automationTriggerCounts, setAutomationTriggerCounts] = useState<Record<string, number>>({});

  // loadReferenceData 并行加载规则编辑器所需的全部参考数据。
  const loadReferenceData = useCallback(
    // 参考数据加载器把共享结果写入 Hook 状态。
    async () => {
    // requestID 标记本次参考数据请求，防止重复刷新时旧结果覆盖新结果。
    const requestID = ++referenceDataRequest.current;
    setReferenceDataError('');
    setReferenceDataWarning('');
    // referenceResults 汇总账号和可选参考数据的独立加载结果，单个失败不阻断其他成功数据。
    const referenceResults = await Promise.allSettled([
      getAccountDetails(),
      SHOW_CARD_UI ? getCards() : Promise.resolve([] as Card[]),
      getItems(),
      getDefaultReplies(),
      getDeliveryTemplates(),
    ]);
    if (requestID < referenceDataRequest.current) return;
    // accountResult、cardResult、itemResult、defaultReplyResult、deliveryTemplateResult 分别对应五类参考数据。
    const [accountResult, cardResult, itemResult, defaultReplyResult, deliveryTemplateResult] = referenceResults;
    if (accountResult.status === 'fulfilled') {
      setAccounts(accountResult.value);
      options.setSelectedAccountId(
        // 账号选择器保留用户已有选择，否则回填首个账号。
        current => current || accountResult.value[0]?.id || '',
      );
    } else {
      setReferenceDataError(rulesLoadErrorMessage(accountResult.reason, '账号参考数据加载失败，请重试'));
    }
    if (cardResult.status === 'fulfilled') setCards(cardResult.value);
    if (itemResult.status === 'fulfilled') setItems(itemResult.value);
    if (deliveryTemplateResult.status === 'fulfilled') setDeliveryTemplates(deliveryTemplateResult.value);
    if (defaultReplyResult.status === 'fulfilled') {
      setDefaultReplies(defaultReplyResult.value);
      setDefaultRepliesError('');
    } else {
      setDefaultRepliesError(rulesLoadErrorMessage(defaultReplyResult.reason, '默认回复配置加载失败，请重试'));
    }
    // degradedReferenceNames 收集非必需参考数据的失败名称，用于展示降级提示。
    const degradedReferenceNames: string[] = [];
    if (SHOW_CARD_UI && cardResult.status === 'rejected') degradedReferenceNames.push('卡密库存');
    if (itemResult.status === 'rejected') degradedReferenceNames.push('商品列表');
    if (deliveryTemplateResult.status === 'rejected') degradedReferenceNames.push('发货模板');
    setReferenceDataWarning(optionalReferenceMessage(degradedReferenceNames));
    },
    [options.setSelectedAccountId],
  );

  // loadAutomationRules 加载自动化规则和异常，并丢弃过期列表响应。
  const loadAutomationRules = useCallback(
    // 自动化列表加载器隔离旧筛选请求的响应。
    async () => {
    // requestID 标记本次自动化规则请求，防止旧响应覆盖新筛选结果。
    const requestID = nextRequestGeneration(automationRulesRequest.current);
    automationRulesRequest.current = requestID;
    setAutomationError('');
    // issuesPromise 与主规则请求并行，异常接口失败不阻断规则展示。
    const issuesPromise = getAutomationIssues().catch(
      // 异常请求失败记录日志并转换为空结果，避免阻断主列表。
      error => {
      console.warn('加载自动化异常列表失败，不阻断规则展示', error);
      return null;
      },
    );
    try {
      // result 是当前筛选条件对应的分页响应。
      const result = await getShippingRulesPage({
        cookieId: options.selectedAccountId || undefined,
        triggerType: options.automationTriggerFilter,
        enabled: options.automationStatusFilter === 'all' ? undefined : options.automationStatusFilter === 'enabled',
        search: options.debouncedAutomationSearch,
        page: options.automationPage,
        pageSize: options.automationPageSize,
      });
      if (!isCurrentRequest(requestID, automationRulesRequest.current, options.selectedAccountId, options.selectedAccountId)) return;
      setAutomationRules(result.data);
      setAutomationTotal(result.total);
      setAutomationTotalPages(result.total_pages);
      setAutomationTriggerCounts(result.trigger_counts || {});
      if (result.page !== options.automationPage) {
        // 分页响应可能被后端修正到有效页码，使用函数式更新避免读取过期闭包。
        options.onAutomationPageChange?.(result.page);
      }
      // issues 是与规则列表并行加载的异常结果。
      const issues = await issuesPromise;
      if (!isCurrentRequest(requestID, automationRulesRequest.current, options.selectedAccountId, options.selectedAccountId)) return;
      if (issues) setAutomationIssues(issues);
    } catch (/* error 是自动化规则列表加载失败原因。 */ error) {
      if (!isCurrentRequest(requestID, automationRulesRequest.current, options.selectedAccountId, options.selectedAccountId)) return;
      setAutomationError(rulesLoadErrorMessage(error, '自动化规则加载失败，请重试'));
      throw error;
    }
    },
    [
    options.automationPage,
    options.automationPageSize,
    options.automationStatusFilter,
    options.automationTriggerFilter,
    options.debouncedAutomationSearch,
    options.onAutomationPageChange,
    options.selectedAccountId,
    ],
  );

  // loadReplyRules 加载关键词规则，并用请求代次隔离账号切换产生的旧响应。
  const loadReplyRules = useCallback(
    // 关键词规则加载器只提交最新账号对应的响应。
    async () => {
    // requestID 标记本次关键词规则请求。
    const requestID = nextRequestGeneration(replyRulesRequest.current);
    replyRulesRequest.current = requestID;
    // cookieID 是本次关键词规则请求绑定的账号。
    const cookieID = options.selectedAccountId;
    setReplyError('');
    if (!cookieID) {
      // 未选择账号时没有可展示的关键词规则，直接清空并重置账号标记。
      setReplyRules([]);
      replyRulesAccountRef.current = '';
      return;
    }
    if (replyRulesAccountRef.current && replyRulesAccountRef.current !== cookieID) {
      // 账号已切换时先清空旧账号列表，避免刷新失败后把其他账号的规则误当成当前账号数据。
      setReplyRules([]);
    }
    try {
      // rules 是当前账号的关键词回复规则。
      const rules = await getReplyRules(cookieID);
      if (!isCurrentRequest(requestID, replyRulesRequest.current, cookieID, options.selectedAccountId)) return;
      setReplyRules(rules);
      replyRulesAccountRef.current = cookieID;
    } catch (/* error 是关键词回复列表加载失败原因。 */ error) {
      if (!isCurrentRequest(requestID, replyRulesRequest.current, cookieID, options.selectedAccountId)) return;
      setReplyError(rulesLoadErrorMessage(error, '关键词回复加载失败，请重试'));
      throw error;
    }
    },
    [options.selectedAccountId],
  );

  // loadDefaultReplies 刷新默认回复配置，供保存后和切换页签时复用。
  const loadDefaultReplies = useCallback(
    // 默认回复加载器刷新全部账号的默认配置。
    async () => {
    // requestID 标记本次默认回复请求，防止旧响应覆盖新配置。
    const requestID = nextRequestGeneration(defaultRepliesRequest.current);
    defaultRepliesRequest.current = requestID;
    setDefaultRepliesError('');
    try {
      // nextReplies 是服务端返回的全部账号默认回复配置。
      const nextReplies = await getDefaultReplies();
      if (!isCurrentRequest(requestID, defaultRepliesRequest.current, 'default', 'default')) return;
      setDefaultReplies(nextReplies);
    } catch (/* error 是默认回复配置读取失败原因。 */ error) {
      if (!isCurrentRequest(requestID, defaultRepliesRequest.current, 'default', 'default')) return;
      setDefaultRepliesError(rulesLoadErrorMessage(error, '默认回复配置加载失败，请重试'));
      throw error;
    }
    },
    [],
  );

  // refresh 刷新账号参考数据和当前页签数据，保证新增账号能立即进入规则页选择器。
  const refresh = useCallback(
    // 页面刷新动作根据页签选择唯一的数据请求。
    async () => {
    setLoading(true);
    try {
      // refreshJobs 收集参考数据和当前页签数据请求；失败由各自错误态承接。
      const refreshJobs: Promise<void>[] = [loadReferenceData()];
      refreshJobs.push(
        options.activeTab === 'automation' ? loadAutomationRules() : options.activeTab === 'reply' ? loadReplyRules() : loadDefaultReplies(),
      );
      // 使用 allSettled 保证某一请求失败时仍等待其他请求收口，且不会产生未处理拒绝。
      await Promise.allSettled(refreshJobs);
    } finally {
      setLoading(false);
    }
    },
    [loadAutomationRules, loadDefaultReplies, loadReferenceData, loadReplyRules, options.activeTab],
  );

  // result 汇总 Hook 的状态与动作，保持页面只消费 feature 边界。
  const result: RulesDataResult = {
    automationRules,
    automationIssues,
    replyRules,
    defaultReplies,
    accounts,
    cards,
    items,
    deliveryTemplates,
    automationTotal,
    automationTotalPages,
    automationTriggerCounts,
    loading,
    referenceDataError,
    referenceDataWarning,
    automationError,
    replyError,
    defaultRepliesError,
    setLoading,
    setAutomationRules,
    setCards,
    setItems,
    loadReferenceData,
    loadAutomationRules,
    loadReplyRules,
    loadDefaultReplies,
    refresh,
  };
  return result;
};

// RulesDataOptionsWithPageChange 为分页修正提供可选的页面状态回调。
export interface RulesDataOptionsWithPageChange extends RulesDataOptions {
  // onAutomationPageChange 接收服务端修正后的有效页码。
  onAutomationPageChange?: (page: number) => void;
}

// useRulesDataWithPageChange 是带分页回调的 Rules 数据 Hook 入口。
export const useRulesDataWithPageChange = (options: RulesDataOptionsWithPageChange): RulesDataResult =>
  useRulesData(options);

// RulesHookTab 用于在测试中表达页签切换场景，避免重复声明字符串联合类型。
export type RulesHookTab = RulesTab;

// RulesHookTrigger 用于在测试中表达自动化触发类型筛选场景。
export type RulesHookTrigger = AutomationTriggerType;
