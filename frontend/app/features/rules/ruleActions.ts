import { useCallback,useEffect,useMemo,useState,type Dispatch,type SetStateAction } from 'react';
import {
clearDefaultReplyRecords,
deleteDefaultReply,
deleteReplyRule,
deleteShippingRule,
getCards,
getDefaultReply,
getItems,
getShippingRules,
resolveAutomationRun,
resolveDeferredAutomationTask,
updateDefaultReply,
updateReplyRule,
updateShippingRule,
} from './api';
import { precheckRegexpExpression } from './regexpPrecheck';
import { finishRuleSubmission,idleRuleSubmitState,startRuleSubmission,type RuleSubmitState } from './interactionState';
import type { AutomationTriggerType,Card,DefaultReplyForm,DeliveryTemplate,Item,ReplyRule,RulesProps,RulesTab,ShippingRule,ShippingVariant } from './types';
import { adjustPriceTarget,boolFlag,buildAdjustPriceConfig,buildReviewConfig,cardActionsForTrigger,defaultRuleName,emptyVariant,hasCompleteTemplateBindings,isValidAdjustPrice,isVisibleShippingVariant,parseJSONObject,shouldReplaceGeneratedName,triggerMeta,withAllItemsConfirmation } from './utils';
import { SHOW_CARD_UI } from '../../../shared/ui/featureVisibility';
import { confirmAction,notify } from '../../../shared/ui/feedback';
import { useAsyncAction } from '../../../shared/ui/useAsyncAction';

// rulesActionErrorMessage 把未知业务异常转换为可展示的中文失败文案。
const rulesActionErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
};

// ruleActionKey 统一生成动作 Hook 与页面共用的业务 pending 键，避免按钮禁用状态和请求键不一致。
export const ruleActionKey = {
  // automationSave 是自动化规则保存的业务键。
  automationSave: 'automation:save',
  // automationDelete 生成指定自动化规则的删除业务键。
  automationDelete: (id: string): string => `automation:delete:${id}`,
  // automationToggle 生成指定自动化规则的启停业务键。
  automationToggle: (id: string): string => `automation:toggle:${id}`,
  // issueRun 生成指定运行异常和恢复决策的业务键。
  issueRun: (id: number, resolution: 'continue' | 'retry' | 'cancel'): string => `issue:run:${id}:${resolution}`,
  // issueDeferred 生成指定延迟任务和恢复决策的业务键。
  issueDeferred: (id: number, resolution: 'retry' | 'dismiss'): string => `issue:deferred:${id}:${resolution}`,
  // replySave 生成关键词回复新建或更新的保存业务键。
  replySave: (id?: string | number): string => `reply:save:${id ?? 'new'}`,
  // replyDelete 生成指定关键词回复的删除业务键。
  replyDelete: (id: string): string => `reply:delete:${id}`,
  // defaultOpen 生成指定账号默认回复读取的业务键。
  defaultOpen: (cookieID: string): string => `default:open:${cookieID}`,
  // defaultSave 生成指定账号默认回复保存的业务键。
  defaultSave: (cookieID: string): string => `default:save:${cookieID}`,
  // defaultDelete 生成指定账号默认回复删除的业务键。
  defaultDelete: (cookieID: string): string => `default:delete:${cookieID}`,
  // defaultClearRecords 生成指定账号默认回复记录清理的业务键。
  defaultClearRecords: (cookieID: string): string => /* 清理记录业务键。 */ `default:clear-records:${cookieID}`,
} as const;

// RuleActionsOptions 描述规则动作协调器依赖的页面数据、刷新函数和外部联动目标。
export interface RuleActionsOptions {
  // selectedAccountId 保存当前规则页面选择的账号。
  selectedAccountId: string;
  // setSelectedAccountId 更新当前规则页面选择的账号。
  setSelectedAccountId: Dispatch<SetStateAction<string>>;
  // setActiveTab 将外部联动切换到自动化页签。
  setActiveTab: Dispatch<SetStateAction<RulesTab>>;
  // items 保存规则编辑器可绑定的商品列表。
  items: Item[];
  // deliveryTemplates 保存发货模板编辑器可选的模板列表。
  deliveryTemplates?: DeliveryTemplate[];
  // setAutomationRules 写入外部联动场景加载的自动化规则。
  setAutomationRules: Dispatch<SetStateAction<ShippingRule[]>>;
  // setCards 写入外部联动场景加载的卡密库存。
  setCards: Dispatch<SetStateAction<Card[]>>;
  // setItems 写入外部联动场景加载的商品列表。
  setItems: Dispatch<SetStateAction<Item[]>>;
  // setLoading 更新规则页面的加载指示器。
  setLoading: Dispatch<SetStateAction<boolean>>;
  // loadAutomationRules 刷新自动化规则和异常任务。
  loadAutomationRules: () => Promise<void>;
  // loadReferenceData 刷新规则编辑器参考数据。
  loadReferenceData: () => Promise<void>;
  // loadReplyRules 刷新关键词回复规则。
  loadReplyRules: () => Promise<void>;
  // loadDefaultReplies 刷新账号默认回复。
  loadDefaultReplies: () => Promise<void>;
  // initialDeliveryTarget 保存商品页跳转到规则页的目标。
  initialDeliveryTarget?: RulesProps['initialDeliveryTarget'];
  // onDeliveryTargetHandled 通知父页面外部跳转已完成。
  onDeliveryTargetHandled?: () => void;
}

// RuleActionsState 暴露规则页弹窗状态、编辑草稿和业务动作。
export interface RuleActionsState {
  // showAutomationModal 表示自动化规则弹窗是否打开。
  showAutomationModal: boolean;
  // setShowAutomationModal 更新自动化规则弹窗展示状态。
  setShowAutomationModal: Dispatch<SetStateAction<boolean>>;
  // showReplyModal 表示关键词回复弹窗是否打开。
  showReplyModal: boolean;
  // setShowReplyModal 更新关键词回复弹窗展示状态。
  setShowReplyModal: Dispatch<SetStateAction<boolean>>;
  // showDefaultModal 表示默认回复弹窗是否打开。
  showDefaultModal: boolean;
  // setShowDefaultModal 更新默认回复弹窗展示状态。
  setShowDefaultModal: Dispatch<SetStateAction<boolean>>;
  // automationSubmitState 保存自动化规则提交状态。
  automationSubmitState: RuleSubmitState;
  // replySubmitState 保存关键词回复提交状态。
  replySubmitState: RuleSubmitState;
  // defaultReplySubmitState 保存默认回复提交状态。
  defaultReplySubmitState: RuleSubmitState;
  // automationSaveError 保存自动化规则表单最近一次校验或保存失败的可见文案。
  automationSaveError: string;
  // replySaveError 保存关键词回复表单最近一次校验或保存失败的可见文案。
  replySaveError: string;
  // defaultReplySaveError 保存默认回复表单最近一次校验或保存失败的可见文案。
  defaultReplySaveError: string;
  // defaultReplyLoading 表示默认回复弹窗是否正在读取指定账号配置。
  defaultReplyLoading: boolean;
  // defaultReplyLoadError 保存默认回复弹窗读取失败文案；非空时只允许重试，不允许编辑或保存。
  defaultReplyLoadError: string;
  // defaultReplyReady 表示默认回复已读取成功，表单字段和保存按钮可以操作。
  defaultReplyReady: boolean;
  // isPending 判断指定业务键是否正在提交；页面用它禁用对应按钮并显示处理中状态。
  isPending: (key: string) => boolean;
  // retryDefaultReplyLoad 重新读取当前默认回复弹窗所属账号的配置。
  retryDefaultReplyLoad: () => Promise<void>;
  // editingAutomationRule 保存当前自动化规则草稿。
  editingAutomationRule: Partial<ShippingRule> | null;
  // setEditingAutomationRule 更新自动化规则草稿。
  setEditingAutomationRule: Dispatch<SetStateAction<Partial<ShippingRule> | null>>;
  // editingReplyRule 保存当前关键词回复草稿。
  editingReplyRule: Partial<ReplyRule> | null;
  // setEditingReplyRule 更新关键词回复草稿。
  setEditingReplyRule: Dispatch<SetStateAction<Partial<ReplyRule> | null>>;
  // defaultForm 保存当前默认回复草稿。
  defaultForm: DefaultReplyForm;
  // setDefaultForm 更新默认回复草稿。
  setDefaultForm: Dispatch<SetStateAction<DefaultReplyForm>>;
  // selectedRuleItem 保存当前规则草稿绑定的商品。
  selectedRuleItem: Item | undefined;
  // isMultiSpecRule 表示当前商品是否需要多规格字段。
  isMultiSpecRule: boolean;
  // currentTrigger 保存当前规则草稿的触发类型。
  currentTrigger: AutomationTriggerType;
  // currentMeta 保存当前触发类型的展示元数据。
  currentMeta: typeof triggerMeta[AutomationTriggerType];
  // reviewConfig 保存当前评价规则配置对象。
  reviewConfig: Record<string, unknown>;
  // displayVariants 保存至少包含一行的规格草稿。
  displayVariants: ShippingVariant[];
  // buildAutomationDraft 创建指定触发类型的规则草稿。
  buildAutomationDraft: (trigger?: AutomationTriggerType, cookieID?: string, itemID?: string) => Partial<ShippingRule>;
  // openAutomationRule 打开指定自动化规则的编辑弹窗。
  openAutomationRule: (rule: ShippingRule) => void;
  // openNewAutomationRule 打开新建自动化规则弹窗。
  openNewAutomationRule: (trigger?: AutomationTriggerType) => void;
  // handleTriggerChange 切换当前规则的触发类型。
  handleTriggerChange: (trigger: AutomationTriggerType) => void;
  // handleAutomationItemChange 切换当前规则绑定的商品。
  handleAutomationItemChange: (itemID: string) => void;
  // updateVariant 更新指定发货规格的字段。
  updateVariant: (index: number, patch: Partial<ShippingVariant>) => void;
  // updateAdjustPriceTarget 更新拍下改价草稿的目标价格。
  updateAdjustPriceTarget: (targetPrice: string) => void;
  // updateAdjustPriceNotifyText 更新拍下改价草稿的可选买家提醒文案。
  updateAdjustPriceNotifyText: (text: string) => void;
  // appendDeliveryContent 追加一行发货规格。
  appendDeliveryContent: () => void;
  // handleSaveAutomationRule 保存当前自动化规则。
  handleSaveAutomationRule: () => Promise<void>;
  // handleDeleteAutomation 删除指定自动化规则。
  handleDeleteAutomation: (id: string) => Promise<void>;
  // handleToggleAutomation 切换指定自动化规则启用状态。
  handleToggleAutomation: (rule: ShippingRule) => Promise<void>;
  // handleResolveRunIssue 处理暂停中的自动化运行。
  handleResolveRunIssue: (id: number, resolution: 'continue' | 'retry' | 'cancel') => Promise<void>;
  // handleResolveDeferredIssue 处理等待重试的自动化任务。
  handleResolveDeferredIssue: (id: number, resolution: 'retry' | 'dismiss') => Promise<void>;
  // handleAddReplyRule 打开新增关键词回复弹窗。
  handleAddReplyRule: () => void;
  // handleSaveReplyRule 保存当前关键词回复规则。
  handleSaveReplyRule: () => Promise<void>;
  // handleDeleteReply 删除指定关键词回复规则。
  handleDeleteReply: (id: string) => Promise<void>;
  // openDefaultReplyModal 打开指定账号的默认回复弹窗。
  openDefaultReplyModal: (cookieID?: string) => Promise<void>;
  // handleSaveDefaultReply 保存当前默认回复配置。
  handleSaveDefaultReply: () => Promise<void>;
  // handleDeleteDefaultReply 删除指定账号的默认回复配置。
  handleDeleteDefaultReply: (cookieID: string) => Promise<void>;
  // handleClearDefaultReplyRecords 清空指定账号的默认回复记录。
  handleClearDefaultReplyRecords: (cookieID: string) => Promise<void>;
}

// useRuleActions 集中管理规则页三类规则的编辑、保存、删除和异常恢复动作。
export const useRuleActions = ({
  selectedAccountId,
  setSelectedAccountId,
  setActiveTab,
  items,
  deliveryTemplates = [],
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
}: RuleActionsOptions): RuleActionsState => {
  // showAutomationModal 表示自动化规则弹窗是否打开。
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  // showReplyModal 表示关键词回复弹窗是否打开。
  const [showReplyModal, setShowReplyModal] = useState(false);
  // showDefaultModal 表示默认回复弹窗是否打开。
  const [showDefaultModal, setShowDefaultModal] = useState(false);
  // automationSubmitState 保存自动化规则提交状态。
  const [automationSubmitState, setAutomationSubmitState] = useState<RuleSubmitState>(idleRuleSubmitState);
  // replySubmitState 保存关键词回复提交状态。
  const [replySubmitState, setReplySubmitState] = useState<RuleSubmitState>(idleRuleSubmitState);
  // defaultReplySubmitState 保存默认回复提交状态。
  const [defaultReplySubmitState, setDefaultReplySubmitState] = useState<RuleSubmitState>(idleRuleSubmitState);
  // editingAutomationRule 保存当前自动化规则草稿。
  const [editingAutomationRule, setEditingAutomationRule] = useState<Partial<ShippingRule> | null>(null);
  // editingReplyRule 保存当前关键词回复草稿。
  const [editingReplyRule, setEditingReplyRule] = useState<Partial<ReplyRule> | null>(null);
  // defaultForm 保存当前默认回复草稿。
  const [defaultForm, setDefaultForm] = useState<DefaultReplyForm>({ cookie_id: '', enabled: false, reply_content: '', reply_once: false, reply_image_url: '', reply_library_image_id: 0 });
  // automationSaveError 保存自动化规则表单的行内校验或保存错误。
  const [automationSaveError, setAutomationSaveError] = useState('');
  // replySaveError 保存关键词回复表单的行内校验或保存错误。
  const [replySaveError, setReplySaveError] = useState('');
  // defaultReplySaveError 保存默认回复表单的行内校验或保存错误。
  const [defaultReplySaveError, setDefaultReplySaveError] = useState('');
  // defaultReplyLoading 表示默认回复弹窗正在读取服务端配置。
  const [defaultReplyLoading, setDefaultReplyLoading] = useState(false);
  // defaultReplyLoadError 保存默认回复弹窗读取失败文案。
  const [defaultReplyLoadError, setDefaultReplyLoadError] = useState('');
  // defaultReplyReady 表示默认回复读取成功并允许编辑保存。
  const [defaultReplyReady, setDefaultReplyReady] = useState(false);
  // defaultReplyAccountId 保存默认回复弹窗当前读取的账号，供失败重试使用。
  const [defaultReplyAccountId, setDefaultReplyAccountId] = useState('');
  // isActionPending 查询指定业务键是否正在提交，页面按钮使用同一键禁用。
  // runAction 执行按业务键加锁的异步动作，并统一处理成功/失败提示。
  const { isPending: isActionPending, run: runAction } = useAsyncAction();

  // selectedRuleItem 查找当前自动化规则草稿绑定的商品。
  const selectedRuleItem = useMemo(
    /* 当前回调计算规则草稿绑定的商品。 */ () => editingAutomationRule?.cookie_id && editingAutomationRule.item_id
      ? items.find(/* 当前回调查找匹配的商品。 */ item => item.cookie_id === editingAutomationRule.cookie_id && item.item_id === editingAutomationRule.item_id)
      : undefined,
    [editingAutomationRule?.cookie_id, editingAutomationRule?.item_id, items],
  );
  // isMultiSpecRule 表示当前商品是否需要填写规格名称和值。
  const isMultiSpecRule = boolFlag(selectedRuleItem?.is_multi_spec);
  // currentTrigger 保存当前规则草稿的触发类型。
  const currentTrigger = (editingAutomationRule?.trigger_type || 'order_paid') as AutomationTriggerType;
  // currentMeta 保存当前触发类型的页面展示元数据。
  const currentMeta = triggerMeta[currentTrigger];
  // reviewConfig 将当前评价规则配置解析为对象。
  const reviewConfig = parseJSONObject(editingAutomationRule?.config_json);
  // displayVariants 为编辑器提供至少一行规格数据。
  const displayVariants = editingAutomationRule?.variants?.length ? editingAutomationRule.variants : [emptyVariant()];

  // buildAutomationDraft 创建指定触发类型的默认规则草稿。
  const buildAutomationDraft = useCallback(/* buildDraftAction 创建规则默认草稿。 */ (trigger: AutomationTriggerType = 'order_paid', cookieID = selectedAccountId, itemID = ''): Partial<ShippingRule> => {
    // item 保存规则绑定的商品。
    const item = items.find(/* 当前回调查找规则绑定的商品。 */ candidate => candidate.cookie_id === cookieID && candidate.item_id === itemID);
    // itemLabel 保存规则名称使用的商品标签。
    const itemLabel = item?.item_title || itemID;
    return {
      name: defaultRuleName(trigger, itemLabel), trigger_type: trigger, cookie_id: cookieID, item_id: itemID,
      item_title: item?.item_title || '', item_keyword: itemLabel, card_group_id: 0, priority: 100, enabled: true,
      config_json: trigger === 'review_missing_timeout' ? buildReviewConfig() : '{}', actions: cardActionsForTrigger(trigger),
      variants: trigger === 'review_missing_timeout' || trigger === 'order_created' ? [] : [emptyVariant()],
    };
  }, [items, selectedAccountId]);

  // openAutomationRule 将已有规则复制为草稿并打开编辑弹窗。
  const openAutomationRule = useCallback(/* openRuleAction 打开已有规则草稿。 */ (rule: ShippingRule) => {
    setAutomationSaveError('');
    // trigger 保存已有规则的触发类型。
    const trigger = (rule.trigger_type || 'order_paid') as AutomationTriggerType;
    setEditingAutomationRule({
      ...rule,
      trigger_type: trigger,
      config_json: trigger === 'review_missing_timeout' ? buildReviewConfig(rule.config_json) : (rule.config_json || '{}'),
      actions: rule.actions?.length ? rule.actions.map(/* 当前回调复制自动化动作。 */ action => ({ ...action })) : cardActionsForTrigger(trigger, rule.card_group_id),
      variants: rule.variants?.length ? rule.variants.map(/* 当前回调复制发货规格。 */ variant => ({ ...variant })) : (trigger === 'review_missing_timeout' || trigger === 'order_created' ? [] : [emptyVariant()]),
    });
    setShowAutomationModal(true);
  }, []);

  // useEffect 处理商品页跳转到规则页时的异步加载和取消。
  useEffect(/* 当前回调处理外部商品联动。 */ () => {
    if (!initialDeliveryTarget) return;
    // targetTrigger 是商品页明确要求的规则类型；旧链接没有该字段时保持付款后发货。
    const targetTrigger: AutomationTriggerType = initialDeliveryTarget.trigger === 'order_created' ? 'order_created' : 'order_paid';
    // cancelled 标记外部跳转加载是否已经失效。
    let cancelled = false;
    // openLinkedRule 加载跳转目标对应的规则、商品和卡密数据。
    const openLinkedRule = async () => {
      setActiveTab('automation');
      setSelectedAccountId(initialDeliveryTarget.cookieId);
      setLoading(true);
      try {
        // ruleList 保存当前账号的自动化规则。
        const [ruleList, itemList, cardList] = await Promise.all([
          getShippingRules(), getItems(), (SHOW_CARD_UI ? getCards() : Promise.resolve([] as Card[])).catch(/* error 表示卡密参考数据加载异常。 */ error => {
            console.warn('加载卡密库存失败，不阻断打开自动化规则', error);
            return [];
          }),
        ]);
        if (cancelled) return;
        setAutomationRules(ruleList);
        setItems(itemList);
        setCards(cardList);
        // rule 保存跳转商品已有的目标类型规则。
        const rule = ruleList.find(/* 当前回调查找跳转目标规则。 */ candidate => candidate.cookie_id === initialDeliveryTarget.cookieId && candidate.item_id === initialDeliveryTarget.itemId && candidate.trigger_type === targetTrigger);
        if (rule) {
          openAutomationRule(rule);
        } else {
          // item 保存跳转商品的参考数据。
          const item = itemList.find(/* 当前回调查找跳转目标商品。 */ candidate => candidate.cookie_id === initialDeliveryTarget.cookieId && candidate.item_id === initialDeliveryTarget.itemId);
          setEditingAutomationRule({
            ...buildAutomationDraft(targetTrigger, initialDeliveryTarget.cookieId, initialDeliveryTarget.itemId),
            item_title: item?.item_title || '', item_keyword: item?.item_title || initialDeliveryTarget.itemId,
            name: defaultRuleName(targetTrigger, item?.item_title || initialDeliveryTarget.itemId),
          });
          setShowAutomationModal(true);
        }
      } catch (/* error 表示外部联动加载异常。 */ error) {
        console.error('打开商品自动化规则失败', error);
        notify('error', '无法加载该商品的自动化规则');
      } finally {
        if (!cancelled) {
          setLoading(false);
          onDeliveryTargetHandled?.();
        }
      }
    };
    void openLinkedRule();
    return /* 当前回调取消外部联动请求。 */ () => { cancelled = true; };
  }, [buildAutomationDraft, initialDeliveryTarget, onDeliveryTargetHandled, openAutomationRule, setActiveTab, setAutomationRules, setCards, setItems, setLoading, setSelectedAccountId]);

  // openNewAutomationRule 创建指定类型的规则草稿并打开弹窗。
  const openNewAutomationRule = useCallback(/* openNewAction 创建新规则草稿。 */ (trigger: AutomationTriggerType = 'order_paid') => {
    if (!selectedAccountId) {
      notify('error', '请先选择账号');
      return;
    }
    setAutomationSaveError('');
    setEditingAutomationRule(buildAutomationDraft(trigger));
    setShowAutomationModal(true);
  }, [buildAutomationDraft, selectedAccountId]);

  // handleTriggerChange 切换规则触发类型并保留当前卡密组。
  const handleTriggerChange = useCallback(/* triggerAction 切换规则触发类型。 */ (trigger: AutomationTriggerType) => {
    if (!editingAutomationRule) return;
    // currentCardID 保存当前规则选中的卡密组。
    const currentCardID = editingAutomationRule.variants?.find(/* 当前回调查找当前卡密组。 */ variant => variant.card_id)?.card_id || editingAutomationRule.actions?.find(/* 当前回调查找发卡动作。 */ action => action.action_type === 'send_card')?.card_id || editingAutomationRule.card_group_id || 0;
    // itemLabel 保存当前规则商品名称。
    const itemLabel = selectedRuleItem?.item_title || editingAutomationRule.item_title || editingAutomationRule.item_id || '';
    setEditingAutomationRule({
      ...editingAutomationRule, trigger_type: trigger,
      name: shouldReplaceGeneratedName(editingAutomationRule.name) ? defaultRuleName(trigger, itemLabel) : editingAutomationRule.name,
      card_group_id: currentCardID, config_json: trigger === 'review_missing_timeout' ? buildReviewConfig(editingAutomationRule.config_json) : '{}',
      actions: cardActionsForTrigger(trigger, currentCardID),
      variants: trigger === 'review_missing_timeout' || trigger === 'order_created' ? [] : (editingAutomationRule.variants?.length ? editingAutomationRule.variants : [{ ...emptyVariant(), card_id: currentCardID }]),
    });
  }, [editingAutomationRule, selectedRuleItem]);

  // handleAutomationItemChange 切换规则商品并同步商品标题和默认名称。
  const handleAutomationItemChange = useCallback(/* itemAction 切换规则绑定商品。 */ (itemID: string) => {
    if (!editingAutomationRule) return;
    // item 保存当前账号下选择的商品。
    const item = items.find(/* 当前回调查找切换后的商品。 */ candidate => candidate.cookie_id === (editingAutomationRule.cookie_id || selectedAccountId) && candidate.item_id === itemID);
    // itemLabel 保存商品名称或商品 ID。
    const itemLabel = item?.item_title || itemID;
    setEditingAutomationRule({
      ...editingAutomationRule, item_id: itemID, item_title: item?.item_title || '', item_keyword: itemLabel,
      config_json: withAllItemsConfirmation(editingAutomationRule.config_json, false),
      name: shouldReplaceGeneratedName(editingAutomationRule.name) ? defaultRuleName(currentTrigger, itemLabel) : editingAutomationRule.name,
    });
  }, [currentTrigger, editingAutomationRule, items, selectedAccountId]);

  // updateVariant 更新规则中的一行发货规格。
  const updateVariant = useCallback(/* variantAction 更新规则规格。 */ (index: number, patch: Partial<ShippingVariant>) => {
    if (!editingAutomationRule) return;
    // next 保存合并后的规格列表。
    const next = displayVariants.map(/* 当前回调合并指定规格字段。 */ (variant, variantIndex) => variantIndex === index ? { ...variant, ...patch } : variant);
    setEditingAutomationRule({ ...editingAutomationRule, variants: next, card_group_id: next[0]?.card_id || 0 });
  }, [displayVariants, editingAutomationRule]);

  // updateAdjustPriceTarget 更新拍下改价草稿中的目标价格。
  const updateAdjustPriceTarget = useCallback(/* adjustPriceAction 更新改价目标价格。 */ (targetPrice: string) => {
    if (!editingAutomationRule) return;
    // baseActions 保存至少包含改价动作的当前动作列表。
    const baseActions = editingAutomationRule.actions?.some(/* 当前回调查找改价动作。 */ action => action.action_type === 'adjust_price')
      ? editingAutomationRule.actions
      : cardActionsForTrigger('order_created');
    setEditingAutomationRule({
      ...editingAutomationRule,
      actions: baseActions.map(/* 当前回调把新目标价格写入改价动作配置。 */ action =>
        action.action_type === 'adjust_price' ? { ...action, config_json: buildAdjustPriceConfig(targetPrice) } : action),
    });
  }, [editingAutomationRule]);

  // updateAdjustPriceNotifyText 更新拍下改价草稿中的可选买家提醒文案。
  const updateAdjustPriceNotifyText = useCallback(/* adjustNotifyAction 更新改价提醒文案。 */ (text: string) => {
    if (!editingAutomationRule) return;
    // actions 保存当前动作列表副本。
    const actions = (editingAutomationRule.actions || []).slice();
    // textIndex 是可选提醒动作在列表中的位置。
    const textIndex = actions.findIndex(/* 当前回调查找提醒文案动作。 */ action => action.action_type === 'send_text');
    if (textIndex >= 0) {
      actions[textIndex] = { ...actions[textIndex], message_template: text };
    } else {
      actions.push({ action_type: 'send_text', message_template: text, enabled: true, sort_order: actions.length + 1 });
    }
    setEditingAutomationRule({ ...editingAutomationRule, actions });
  }, [editingAutomationRule]);

  // appendDeliveryContent 在规格编辑器末尾追加一行。
  const appendDeliveryContent = useCallback(/* appendVariantAction 追加规则规格。 */ () => {
    if (!editingAutomationRule) return;
    // previous 保存上一行规格，用于多规格商品复制规格名称和值。
    const previous = displayVariants[displayVariants.length - 1];
    setEditingAutomationRule({
      ...editingAutomationRule,
      variants: [...displayVariants, { ...emptyVariant(), spec_name: isMultiSpecRule ? previous?.spec_name || '' : '', spec_value: isMultiSpecRule ? previous?.spec_value || '' : '' }],
    });
  }, [displayVariants, editingAutomationRule, isMultiSpecRule]);

  // showAutomationValidationError 把自动化规则校验失败同时写入行内错误和统一提示。
  const showAutomationValidationError = useCallback(/* showAutomationValidationAction 展示自动化表单校验错误。 */ (message: string) => {
    setAutomationSaveError(message);
    notify('error', message);
  }, []);

  // refreshAutomationListAfterMutation 在业务动作已成功后刷新列表；刷新失败只提示数据未更新。
  const refreshAutomationListAfterMutation = useCallback(/* refreshAutomationListAction 刷新自动化列表并保留业务结果。 */ async (warningText: string) => {
    try {
      await loadAutomationRules();
    } catch {
      notify('warning', warningText);
    }
  }, [loadAutomationRules]);

  // refreshAutomationAfterSave 在保存成功后刷新列表和参考数据；刷新失败不得否定保存成功。
  const refreshAutomationAfterSave = useCallback(/* refreshAutomationAfterSaveAction 刷新保存后的规则和参考数据。 */ async (warningText: string) => {
    // refreshResults 保存两个刷新请求的独立结果，任一失败仍等待另一请求收口。
    const refreshResults = await Promise.allSettled([loadAutomationRules(), loadReferenceData()]);
    if (refreshResults.some(/* result 是单个刷新请求的完成状态。 */ result => result.status === 'rejected')) notify('warning', warningText);
  }, [loadAutomationRules, loadReferenceData]);

  // handleSaveAutomationRule 校验并保存当前自动化规则。
  const handleSaveAutomationRule = useCallback(/* saveRuleAction 保存自动化规则。 */ async () => {
    if (!editingAutomationRule) return;
    // saveKey 是自动化规则保存的全局业务键，阻断连续点击。
    const saveKey = ruleActionKey.automationSave;
    if (isActionPending(saveKey)) return;
    // trigger 保存当前规则触发类型。
    const trigger = (editingAutomationRule.trigger_type || 'order_paid') as AutomationTriggerType;
    if (!editingAutomationRule.cookie_id) {
      showAutomationValidationError('请选择账号');
      return;
    }
    // variants 保存当前规格列表。
    const variants = editingAutomationRule.variants?.length ? editingAutomationRule.variants : [];
    // editableVariants 只校验本次精简界面实际可编辑的模板，旧库存动作原样保留且不阻断其他设置。
    const editableVariants = variants.filter(/* variant 是一个需要用户校验的可见动作。 */ variant => isVisibleShippingVariant(variant, deliveryTemplates));
    if (trigger !== 'review_missing_timeout' && trigger !== 'order_created') {
      // 新建规则不能借隐藏的历史动作绕过模板校验；已有规则则允许保留原样的旧动作。
      if (!SHOW_CARD_UI && !editingAutomationRule.id && editableVariants.length !== variants.length) {
        showAutomationValidationError('请选择无需库存绑定的发货模板');
        return;
      }
      if (!variants.length || editableVariants.some(/* 当前回调只校验可见发货内容或模板是否有效。 */ variant => variant.delivery_mode === 'template' ? !variant.delivery_template_id : !variant.card_id)) {
        showAutomationValidationError('请选择发货模板');
        return;
      }
      if (editableVariants.some(/* 当前回调校验模板变量是否绑定完整。 */ variant => {
        if (variant.delivery_mode !== 'template') return false;
        // template 保存当前变体选择的模板摘要。
        const template = deliveryTemplates.find(/* 模板候选项查找器定位当前变体模板。 */ candidate => candidate.id === variant.delivery_template_id);
        return !template || !hasCompleteTemplateBindings(template.keys, variant.template_bindings);
      })) {
        showAutomationValidationError('当前模板含有无法在精简界面配置的变量，请改用仅含自定义变量的发货模板');
        return;
      }
      if (editableVariants.some(/* 当前回调校验模板自定义变量键值是否完整。 */ variant => {
        // template 保存当前变体选择的发货模板摘要。
        const template = deliveryTemplates.find(/* templateCandidate 定位当前模板。 */ templateCandidate => templateCandidate.id === variant.delivery_template_id);
        // customKeys 保存模板引用的自定义变量键。
        const customKeys = template?.custom_keys || [];
        return variant.delivery_mode === 'template' && customKeys.some(/* key 检查规则是否填写了对应的自定义字符串。 */ key => !variant.custom_variables?.[key]?.trim());
      })) {
        showAutomationValidationError('请填写发货模板要求的全部自定义变量');
        return;
      }
      if (isMultiSpecRule && editableVariants.some(/* 当前回调校验可见多规格字段。 */ variant => !variant.spec_name.trim() || !variant.spec_value.trim())) {
        showAutomationValidationError('多规格商品必须填写每一行的规格名称和规格值');
        return;
      }
    }
    if (trigger === 'review_missing_timeout') {
      // text 保存求评价动作的文案。
      const text = editingAutomationRule.actions?.find(/* 当前回调查找求评价文案动作。 */ action => action.action_type === 'send_text')?.message_template || '';
      if (!text.trim()) {
        showAutomationValidationError('请填写求评价文案');
        return;
      }
    }
    // saveActions 保存实际提交的动作列表；拍下改价规则会剔除未填写文案的可选提醒动作。
    let saveActions = editingAutomationRule.actions?.length ? editingAutomationRule.actions : cardActionsForTrigger(trigger, editingAutomationRule.card_group_id || 0);
    if (trigger === 'order_created') {
      if (!isValidAdjustPrice(adjustPriceTarget(saveActions))) {
        showAutomationValidationError('请填写 0.01 到 1000000 元、最多两位小数的目标价格');
        return;
      }
      saveActions = saveActions.filter(/* 当前回调剔除空文案的可选提醒动作。 */ action => action.action_type !== 'send_text' || Boolean(action.message_template?.trim()));
    }
    // saveVariants 保存归一化后的发货规格。
    const saveVariants = trigger === 'review_missing_timeout' || trigger === 'order_created' ? [] : variants.map(/* 当前回调归一化发货规格字段。 */ variant => ({ ...variant, spec_name: isMultiSpecRule ? variant.spec_name.trim() : '', spec_value: isMultiSpecRule ? variant.spec_value.trim() : '', delivery_count: Math.max(1, Number(variant.delivery_count) || 1), enabled: variant.enabled !== false }));
    setAutomationSaveError('');
    setAutomationSubmitState(/* current 是当前自动化提交状态。 */ current => startRuleSubmission(current));
    // saved 表示服务端是否已确认保存；后续刷新失败不得改写该业务事实。
    const saved = await runAction(saveKey, /* saveAutomationTask 提交归一化后的自动化规则。 */ async () => {
      await updateShippingRule({ ...editingAutomationRule, trigger_type: trigger, name: (editingAutomationRule.name || '').trim() || defaultRuleName(trigger, selectedRuleItem?.item_title || editingAutomationRule.item_id || ''), config_json: trigger === 'review_missing_timeout' ? buildReviewConfig(editingAutomationRule.config_json) : (editingAutomationRule.config_json || '{}'), actions: trigger === 'order_created' ? saveActions : (editingAutomationRule.actions?.length ? editingAutomationRule.actions : cardActionsForTrigger(trigger, saveVariants[0]?.card_id || editingAutomationRule.card_group_id || 0)), variants: saveVariants });
      return true;
    }, {
      successMessage: '保存成功',
      successTitle: '自动化规则',
      errorMessage: '保存失败，请稍后重试',
      onError: /* error 是自动化规则保存失败原因。 */ error => setAutomationSaveError(rulesActionErrorMessage(error, '保存失败，请稍后重试')),
    });
    if (!saved) {
      setAutomationSubmitState(/* current 是当前自动化提交状态。 */ current => finishRuleSubmission(current, false));
      return;
    }
    setAutomationSubmitState(/* current 是当前自动化提交状态。 */ current => finishRuleSubmission(current, true));
    setShowAutomationModal(false);
    await refreshAutomationAfterSave('规则已保存，但列表刷新失败，请手动刷新确认最新状态');
  }, [deliveryTemplates, editingAutomationRule, isActionPending, isMultiSpecRule, refreshAutomationAfterSave, runAction, selectedRuleItem, showAutomationValidationError]);

  // handleDeleteAutomation 删除自动化规则并刷新列表。
  const handleDeleteAutomation = useCallback(/* deleteRuleAction 删除自动化规则。 */ async (id: string) => {
    // deleteKey 是当前规则删除的业务键，避免同一规则重复提交。
    const deleteKey = ruleActionKey.automationDelete(id);
    if (isActionPending(deleteKey)) return;
    // confirmed 表示用户在统一确认框中的明确选择。
    const confirmed = await confirmAction({ title: '删除自动化规则', message: '确定删除该自动化规则吗？删除后无法恢复。', confirmText: '删除', danger: true });
    if (!confirmed) return;
    // deleted 表示服务端是否已确认删除成功。
    const deleted = await runAction(deleteKey, /* deleteAutomationTask 调用删除接口。 */ async () => {
      await deleteShippingRule(id);
      return true;
    }, { successMessage: '自动化规则已删除', errorMessage: '删除失败，请稍后重试' });
    if (!deleted) return;
    await refreshAutomationListAfterMutation('自动化规则已删除，但列表刷新失败，请手动刷新');
  }, [isActionPending, refreshAutomationListAfterMutation, runAction]);

  // handleToggleAutomation 切换规则启用状态并刷新列表。
  const handleToggleAutomation = useCallback(/* toggleRuleAction 切换自动化规则状态。 */ async (rule: ShippingRule) => {
    // toggleKey 是当前规则启停的业务键。
    const toggleKey = ruleActionKey.automationToggle(rule.id);
    if (isActionPending(toggleKey)) return;
    // nextEnabled 是本次要写入的启用状态。
    const nextEnabled = !rule.enabled;
    // updated 表示服务端是否已确认状态更新。
    const updated = await runAction(toggleKey, /* toggleAutomationTask 写入翻转后的启用状态。 */ async () => {
      await updateShippingRule({ ...rule, enabled: nextEnabled });
      return nextEnabled;
    }, { successMessage: nextEnabled ? '规则已启用' : '规则已禁用', errorMessage: '状态更新失败，请稍后重试' });
    if (updated === undefined) return;
    await refreshAutomationListAfterMutation('状态已更新，但列表刷新失败，请手动刷新');
  }, [isActionPending, refreshAutomationListAfterMutation, runAction]);

  // handleResolveRunIssue 处理自动化运行的人工恢复决策。
  const handleResolveRunIssue = useCallback(/* resolveRunAction 处理自动化运行异常。 */ async (id: number, resolution: 'continue' | 'retry' | 'cancel') => {
    // resolveKey 是当前运行异常和决策的业务键。
    const resolveKey = ruleActionKey.issueRun(id, resolution);
    if (isActionPending(resolveKey)) return;
    // prompt 保存当前恢复操作的确认文案。
    const prompt = resolution === 'continue' ? '确认外部动作已经执行成功，并跳到下一步吗？' : resolution === 'retry' ? '确认外部动作没有执行，可以安全重试吗？错误判断可能造成重复发送。' : '确认终止该自动化运行吗？';
    // confirmed 表示用户是否确认执行恢复决策。
    const confirmed = await confirmAction({ title: '处理自动化异常', message: prompt, confirmText: resolution === 'continue' ? '继续' : resolution === 'retry' ? '安全重试' : '终止', danger: resolution !== 'continue' });
    if (!confirmed) return;
    // handled 表示服务端是否已接收恢复决策。
    const handled = await runAction(resolveKey, /* resolveRunTask 提交运行恢复决策。 */ async () => {
      await resolveAutomationRun(id, resolution);
      return true;
    }, { successMessage: '异常处理已提交', errorMessage: '处理失败，请稍后重试' });
    if (!handled) return;
    await refreshAutomationListAfterMutation('异常已处理，但列表刷新失败，请手动刷新');
  }, [isActionPending, refreshAutomationListAfterMutation, runAction]);

  // handleResolveDeferredIssue 处理延迟自动化任务的重试或忽略。
  const handleResolveDeferredIssue = useCallback(/* resolveDeferredAction 处理延迟任务异常。 */ async (id: number, resolution: 'retry' | 'dismiss') => {
    // deferredKey 是当前延迟任务和决策的业务键。
    const deferredKey = ruleActionKey.issueDeferred(id, resolution);
    if (isActionPending(deferredKey)) return;
    // confirmed 表示用户是否确认重试或忽略该任务。
    const confirmed = await confirmAction({ title: '处理延迟任务', message: resolution === 'retry' ? '确认重新执行该任务吗？' : '确认忽略并删除该异常任务吗？', confirmText: resolution === 'retry' ? '重新入队' : '忽略', danger: resolution === 'dismiss' });
    if (!confirmed) return;
    // handled 表示服务端是否已接收延迟任务决策。
    const handled = await runAction(deferredKey, /* resolveDeferredTask 提交延迟任务决策。 */ async () => {
      await resolveDeferredAutomationTask(id, resolution);
      return true;
    }, { successMessage: '延迟任务已处理', errorMessage: '处理失败，请稍后重试' });
    if (!handled) return;
    await refreshAutomationListAfterMutation('延迟任务已处理，但列表刷新失败，请手动刷新');
  }, [isActionPending, refreshAutomationListAfterMutation, runAction]);

  // showReplyValidationError 把关键词回复校验失败同时写入行内错误和统一提示。
  const showReplyValidationError = useCallback(/* showReplyValidationAction 展示关键词表单校验错误。 */ (message: string) => {
    setReplySaveError(message);
    notify('error', message);
  }, []);

  // handleAddReplyRule 打开一个默认使用包含匹配的关键词回复草稿。
  const handleAddReplyRule = useCallback(/* addReplyAction 创建关键词回复草稿。 */ () => {
    if (!selectedAccountId) {
      notify('error', '请先选择账号');
      return;
    }
    setReplySaveError('');
    // expressions 保存至少一行可编辑表达式，避免新建表单丢失 OR 语义入口。
    const expressions = [''];
    setEditingReplyRule({ keyword: '', expressions, reply_content: '', image_url: '', library_image_id: 0, item_id: '', item_ids: [], type: 'text', match_type: 'contains', enabled: true, notify_manual: false });
    setShowReplyModal(true);
  }, [selectedAccountId]);

  // handleSaveReplyRule 清理表达式、校验回复内容和客户端正则语法后保存规则。
  const handleSaveReplyRule = useCallback(/* saveReplyAction 保存关键词回复。 */ async () => {
    if (!editingReplyRule || !selectedAccountId) return;
    // saveKey 是当前关键词回复的业务保存键。
    const saveKey = ruleActionKey.replySave(editingReplyRule.id);
    if (isActionPending(saveKey)) return;
    // rawExpressions 保存新多表达式字段或旧 keyword 字段提供的输入。
    const rawExpressions = Array.isArray(editingReplyRule.expressions) ? editingReplyRule.expressions : [editingReplyRule.keyword || ''];
    // cleanedExpressions 保存去除首尾空白、空值和重复项后的表达式。
    const cleanedExpressions = rawExpressions
      .map(/* expression 是当前待清理的关键词或正则表达式。 */ expression => typeof expression === 'string' ? expression.trim() : '')
      .filter(/* expression 是清理后仍可提交的表达式。 */ expression => Boolean(expression));
    // legacyKeyword 保存旧草稿在默认空行场景下仍可提交的单关键词。
    const legacyKeyword = typeof editingReplyRule.keyword === 'string' ? editingReplyRule.keyword.trim() : '';
    // expressions 保存按输入顺序去重后的最终表达式集合。
    const expressions = Array.from(new Set(cleanedExpressions.length ? cleanedExpressions : (legacyKeyword ? [legacyKeyword] : [])));
    // matchType 将历史 fuzzy/exact/空值归一为当前 UI 支持的模式。
    const matchType = editingReplyRule.match_type === 'regexp' ? 'regexp' : 'contains';
    // hasReplyContent 表示当前回复是否填写了文字或图片。
    const hasReplyContent = editingReplyRule.type === 'image' ? Boolean(editingReplyRule.image_url?.trim()) || Boolean(editingReplyRule.library_image_id) : Boolean(editingReplyRule.reply_content?.trim());
    if (!expressions.length || !hasReplyContent) {
      showReplyValidationError('请填写关键词和回复内容');
      return;
    }
    // 正则模式先做尽力而为的语法预检；预检已兼容 Go/RE2 的内联标志和命名组，后端仍是最终权威。
    if (matchType === 'regexp' && !expressions.every(/* expression 是当前待预检的正则表达式。 */ expression => precheckRegexpExpression(expression))) {
      showReplyValidationError('正则表达式格式错误，请检查关键词');
      return;
    }
    setReplySaveError('');
    setReplySubmitState(/* current 是当前关键词提交状态。 */ current => startRuleSubmission(current));
    // saved 表示服务端是否已确认关键词回复保存成功。
    const saved = await runAction(saveKey, /* saveReplyTask 提交关键词回复规则。 */ async () => {
      await updateReplyRule({ ...editingReplyRule, keyword: expressions[0], expressions, match_type: matchType, enabled: true }, selectedAccountId);
      return true;
    }, {
      successMessage: '保存成功',
      successTitle: '关键词回复',
      errorMessage: '保存失败，请稍后重试',
      onError: /* error 是关键词回复保存失败原因。 */ error => setReplySaveError(rulesActionErrorMessage(error, '保存失败，请稍后重试')),
    });
    if (!saved) {
      setReplySubmitState(/* current 是当前关键词提交状态。 */ current => finishRuleSubmission(current, false));
      return;
    }
    setReplySubmitState(/* current 是当前关键词提交状态。 */ current => finishRuleSubmission(current, true));
    setShowReplyModal(false);
    try {
      await loadReplyRules();
    } catch {
      notify('warning', '关键词回复已保存，但列表刷新失败，请手动刷新');
    }
  }, [editingReplyRule, isActionPending, loadReplyRules, runAction, selectedAccountId, showReplyValidationError]);

  // handleDeleteReply 删除指定关键词回复并刷新列表。
  const handleDeleteReply = useCallback(/* deleteReplyAction 删除关键词回复。 */ async (id: string) => {
    if (!selectedAccountId) return;
    // deleteKey 是当前关键词回复删除的业务键。
    const deleteKey = ruleActionKey.replyDelete(id);
    if (isActionPending(deleteKey)) return;
    // confirmed 表示用户是否确认删除该关键词回复。
    const confirmed = await confirmAction({ title: '删除关键词回复', message: '确定删除该回复规则吗？删除后无法恢复。', confirmText: '删除', danger: true });
    if (!confirmed) return;
    // deleted 表示服务端是否已确认删除成功。
    const deleted = await runAction(deleteKey, /* deleteReplyTask 调用关键词回复删除接口。 */ async () => {
      await deleteReplyRule(id, selectedAccountId);
      return true;
    }, { successMessage: '关键词回复已删除', errorMessage: '删除失败，请稍后重试' });
    if (!deleted) return;
    try {
      await loadReplyRules();
    } catch {
      notify('warning', '关键词回复已删除，但列表刷新失败，请手动刷新');
    }
  }, [isActionPending, loadReplyRules, runAction, selectedAccountId]);

  // loadDefaultReplyConfig 读取指定账号默认回复；失败时保持表单禁用并记录错误。
  const loadDefaultReplyConfig = useCallback(/* loadDefaultReplyConfigAction 读取默认回复配置。 */ async (cookieID: string) => {
    // openKey 是当前账号默认回复读取的业务键。
    const openKey = ruleActionKey.defaultOpen(cookieID);
    if (isActionPending(openKey)) return;
    setDefaultReplyAccountId(cookieID);
    setDefaultReplyLoadError('');
    setDefaultReplyReady(false);
    setDefaultReplySaveError('');
    setDefaultReplyLoading(true);
    try {
      await runAction(openKey, /* loadDefaultReplyTask 读取并写入默认回复表单。 */ async () => {
        // data 保存服务端返回的默认回复配置。
        const data = await getDefaultReply(cookieID);
        setDefaultForm({ cookie_id: cookieID, enabled: data.enabled, reply_content: data.reply_content, reply_once: data.reply_once, reply_image_url: data.reply_image_url || '', reply_library_image_id: data.reply_library_image_id || 0 });
        setDefaultReplyReady(true);
        return true;
      }, {
        errorMessage: '读取默认回复失败，请重试',
        onError: /* error 是默认回复读取失败原因。 */ error => setDefaultReplyLoadError(rulesActionErrorMessage(error, '读取默认回复失败，请重试')),
      });
    } finally {
      setDefaultReplyLoading(false);
    }
  }, [isActionPending, runAction]);

  // openDefaultReplyModal 打开指定账号的默认回复弹窗并在弹窗内显示读取状态。
  const openDefaultReplyModal = useCallback(/* openDefaultAction 打开默认回复弹窗。 */ async (cookieID = selectedAccountId) => {
    if (!cookieID) {
      notify('error', '请先选择账号');
      return;
    }
    setShowDefaultModal(true);
    await loadDefaultReplyConfig(cookieID);
  }, [loadDefaultReplyConfig, selectedAccountId]);

  // retryDefaultReplyLoad 重试读取当前弹窗所属账号的默认回复配置。
  const retryDefaultReplyLoad = useCallback(/* retryDefaultReplyAction 重试默认回复读取。 */ async () => {
    if (!defaultReplyAccountId) return;
    await loadDefaultReplyConfig(defaultReplyAccountId);
  }, [defaultReplyAccountId, loadDefaultReplyConfig]);

  // showDefaultReplyValidationError 把默认回复校验失败同时写入行内错误和统一提示。
  const showDefaultReplyValidationError = useCallback(/* showDefaultValidationAction 展示默认回复校验错误。 */ (message: string) => {
    setDefaultReplySaveError(message);
    notify('error', message);
  }, []);

  // handleSaveDefaultReply 校验并保存账号默认回复。
  const handleSaveDefaultReply = useCallback(/* saveDefaultAction 保存默认回复。 */ async () => {
    if (!defaultReplyReady) {
      notify('error', '默认回复尚未读取成功，请先重试读取');
      return;
    }
    if (!defaultForm.cookie_id) {
      showDefaultReplyValidationError('请先选择账号');
      return;
    }
    // saveKey 是当前账号默认回复保存的业务键。
    const saveKey = ruleActionKey.defaultSave(defaultForm.cookie_id);
    if (isActionPending(saveKey)) return;
    if (defaultForm.enabled && !defaultForm.reply_content.trim() && !defaultForm.reply_image_url.trim() && !defaultForm.reply_library_image_id) {
      showDefaultReplyValidationError('启用默认回复时，请填写回复内容或选择/填写图片');
      return;
    }
    setDefaultReplySaveError('');
    setDefaultReplySubmitState(/* current 是当前默认回复提交状态。 */ current => startRuleSubmission(current));
    // saved 表示服务端是否已确认默认回复保存成功。
    const saved = await runAction(saveKey, /* saveDefaultReplyTask 提交默认回复配置。 */ async () => {
      await updateDefaultReply(defaultForm.cookie_id, { enabled: defaultForm.enabled, reply_content: defaultForm.reply_content, reply_once: defaultForm.reply_once, reply_image_url: defaultForm.reply_image_url, reply_library_image_id: defaultForm.reply_library_image_id });
      return true;
    }, {
      successMessage: '保存成功',
      successTitle: '默认回复',
      errorMessage: '保存失败，请稍后重试',
      onError: /* error 是默认回复保存失败原因。 */ error => setDefaultReplySaveError(rulesActionErrorMessage(error, '保存失败，请稍后重试')),
    });
    if (!saved) {
      setDefaultReplySubmitState(/* current 是当前默认回复提交状态。 */ current => finishRuleSubmission(current, false));
      return;
    }
    setDefaultReplySubmitState(/* current 是当前默认回复提交状态。 */ current => finishRuleSubmission(current, true));
    setShowDefaultModal(false);
    try {
      await loadDefaultReplies();
    } catch {
      notify('warning', '默认回复已保存，但列表刷新失败，请手动刷新');
    }
  }, [defaultForm, defaultReplyReady, isActionPending, loadDefaultReplies, runAction, showDefaultReplyValidationError]);

  // handleDeleteDefaultReply 删除账号默认回复配置。
  const handleDeleteDefaultReply = useCallback(/* deleteDefaultAction 删除默认回复。 */ async (cookieID: string) => {
    // deleteKey 是当前账号默认回复删除的业务键。
    const deleteKey = ruleActionKey.defaultDelete(cookieID);
    if (isActionPending(deleteKey)) return;
    // confirmed 表示用户是否确认删除默认回复。
    const confirmed = await confirmAction({ title: '删除默认回复', message: '确定删除该账号默认回复吗？删除后无法恢复。', confirmText: '删除', danger: true });
    if (!confirmed) return;
    // deleted 表示服务端是否已确认删除成功。
    const deleted = await runAction(deleteKey, /* deleteDefaultReplyTask 调用默认回复删除接口。 */ async () => {
      await deleteDefaultReply(cookieID);
      return true;
    }, { successMessage: '默认回复已删除', errorMessage: '删除失败，请稍后重试' });
    if (!deleted) return;
    try {
      await loadDefaultReplies();
    } catch {
      notify('warning', '默认回复已删除，但列表刷新失败，请手动刷新');
    }
  }, [isActionPending, loadDefaultReplies, runAction]);

  // handleClearDefaultReplyRecords 清空账号默认回复的会话记录。
  const handleClearDefaultReplyRecords = useCallback(/* clearDefaultRecordsAction 清空默认回复记录。 */ async (cookieID: string) => {
    // clearKey 是当前账号默认回复记录清理的业务键。
    const clearKey = ruleActionKey.defaultClearRecords(cookieID);
    if (isActionPending(clearKey)) return;
    // confirmed 表示用户是否确认清空默认回复记录。
    const confirmed = await confirmAction({ title: '清空默认回复记录', message: '确定清空该账号的默认回复记录吗？清空后可重新对所有会话使用“只回复一次”。', confirmText: '清空记录', danger: true });
    if (!confirmed) return;
    await runAction(clearKey, /* clearDefaultRecordsTask 调用默认回复记录清理接口。 */ async () => {
      await clearDefaultReplyRecords(cookieID);
      return true;
    }, { successMessage: '默认回复记录已清空', errorMessage: '清空失败，请稍后重试' });
  }, [isActionPending, runAction]);

  return {
    showAutomationModal, setShowAutomationModal, showReplyModal, setShowReplyModal, showDefaultModal, setShowDefaultModal,
    automationSubmitState, replySubmitState, defaultReplySubmitState,
    automationSaveError, replySaveError, defaultReplySaveError,
    defaultReplyLoading, defaultReplyLoadError, defaultReplyReady, isPending: isActionPending, retryDefaultReplyLoad,
    editingAutomationRule, setEditingAutomationRule,
    editingReplyRule, setEditingReplyRule, defaultForm, setDefaultForm, selectedRuleItem, isMultiSpecRule, currentTrigger,
    currentMeta, reviewConfig, displayVariants, buildAutomationDraft, openAutomationRule, openNewAutomationRule,
    handleTriggerChange, handleAutomationItemChange, updateVariant, updateAdjustPriceTarget, updateAdjustPriceNotifyText, appendDeliveryContent, handleSaveAutomationRule,
    handleDeleteAutomation, handleToggleAutomation, handleResolveRunIssue, handleResolveDeferredIssue, handleAddReplyRule,
    handleSaveReplyRule, handleDeleteReply,
    openDefaultReplyModal, handleSaveDefaultReply, handleDeleteDefaultReply,
    handleClearDefaultReplyRecords,
  };
};
