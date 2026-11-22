import { describe,expect,test } from 'vitest';
import type { AccountDetail,ShippingRule } from './api';
import {
accentClasses,
accountLabel,
actionSummary,
adjustPriceTarget,
boolFlag,
buildAdjustPriceConfig,
buildReviewConfig,
cardActionsForTrigger,
defaultRuleName,
reviewLookbackHours,
emptyVariant,
hasCompleteTemplateBindings,
isValidAdjustPrice,isVisibleShippingVariant,needsAllItemsConfirmation,
parseJSONObject,
shouldReplaceGeneratedName,
statusPill,withAllItemsConfirmation,
} from './utils';

// rule 是规则工具测试使用的最小规则对象。
const rule = (overrides: Partial<ShippingRule> = {}): ShippingRule => ({
  id: 'rule-1',
  name: '测试规则',
  trigger_type: 'order_paid',
  item_keyword: '',
  card_group_id: 0,
  priority: 1,
  enabled: true,
  actions: [],
  variants: [],
  ...overrides,
});

describe('规则工具函数', /* 当前回调处理规则配置和展示状态。 */ () => {
  test('安全解析规则配置并规范化求评价参数', /* 当前回调处理规则配置和展示状态。 */ () => {
    expect(parseJSONObject()).toEqual({});
    expect(parseJSONObject('{bad')).toEqual({});
    expect(parseJSONObject('[]')).toEqual({});
    expect(parseJSONObject('{"max_attempts": 3}')).toEqual({ max_attempts: 3 });
    expect(buildReviewConfig('{"after_shipped_hours": 48}')).toBe('{"after_shipped_hours":48,"repeat_interval_hours":24,"max_attempts":1,"trigger_on_completed":false}');
    expect(buildReviewConfig(undefined, { max_attempts: 4 })).toBe('{"after_shipped_hours":72,"repeat_interval_hours":24,"max_attempts":4,"trigger_on_completed":false}');
    // 确认收货后立即求评价的开关必须随其他时间参数一起保留。
    expect(buildReviewConfig('{"trigger_on_completed":true}', { max_attempts: 2 })).toBe('{"after_shipped_hours":72,"repeat_interval_hours":24,"max_attempts":2,"trigger_on_completed":true}');
  });

  test('求评价回溯窗口：默认推导、显式值保留与下限', /* 当前回调处理规则配置和展示状态。 */ () => {
    // 默认 72h 首次、1 次：72 + 24 = 96。
    expect(reviewLookbackHours()).toBe(96);
    // 多次求评：48 + 2*12 + 24 = 96。
    expect(reviewLookbackHours('{"after_shipped_hours":48,"repeat_interval_hours":12,"max_attempts":3}')).toBe(96);
    // 显式值生效，且不得小于首次等待时长。
    expect(reviewLookbackHours('{"max_lookback_hours":200}')).toBe(200);
    expect(reviewLookbackHours('{"after_shipped_hours":48,"max_lookback_hours":10}')).toBe(48);
    // 非正值视为未配置。
    expect(reviewLookbackHours('{"max_lookback_hours":-5}')).toBe(96);
    // 显式窗口随其他字段编辑被保留，未配置时不写入。
    expect(buildReviewConfig('{"max_lookback_hours":120}', { max_attempts: 2 })).toBe('{"after_shipped_hours":72,"repeat_interval_hours":24,"max_attempts":2,"trigger_on_completed":false,"max_lookback_hours":120}');
    expect(buildReviewConfig(undefined, { max_lookback_hours: 30 })).toBe('{"after_shipped_hours":72,"repeat_interval_hours":24,"max_attempts":1,"trigger_on_completed":false,"max_lookback_hours":30}');
  });

  test('生成规则名称并识别可替换的系统名称', /* 当前回调处理规则配置和展示状态。 */ () => {
    expect(defaultRuleName('order_paid')).toBe('付款后自动发货');
    expect(defaultRuleName('buyer_reviewed', '数字商品')).toBe('评价后发送赠品 - 数字商品');
    expect(defaultRuleName('unknown' as never)).toBe('自动化规则');
    expect(shouldReplaceGeneratedName()).toBe(true);
    expect(shouldReplaceGeneratedName('  ')).toBe(true);
    expect(shouldReplaceGeneratedName('付款后自动发货')).toBe(true);
    expect(shouldReplaceGeneratedName('付款后自动发货 - 旧商品')).toBe(true);
    expect(shouldReplaceGeneratedName('我自定义的规则')).toBe(false);
  });

  test('创建各类触发器的默认动作链', /* 当前回调处理规则配置和展示状态。 */ () => {
    expect(cardActionsForTrigger('review_missing_timeout')).toEqual([{
      action_type: 'send_text', message_template: '亲，商品使用满意的话，麻烦给个评价，谢谢～', enabled: true, sort_order: 1,
    }]);
    expect(cardActionsForTrigger('order_created')).toEqual([{
      action_type: 'adjust_price', config_json: '{"target_price":""}', enabled: true, sort_order: 1,
    }]);
    expect(cardActionsForTrigger('order_paid', 7)).toEqual([
      { action_type: 'send_card', card_id: 7, delivery_count: 1, enabled: true, sort_order: 1 },
      { action_type: 'confirm_shipment', enabled: true, sort_order: 2 },
    ]);
    expect(cardActionsForTrigger('buyer_reviewed', 8)).toEqual([
      { action_type: 'send_card', card_id: 8, delivery_count: 1, enabled: true, sort_order: 1 },
    ]);
  });

  test('精简编辑器只显示未绑定库存的模板变体，旧变体数据可保持原样', /* 校验用户可见变体的统一过滤规则。 */ () => {
    // templateOptions 由正式模板接口返回，含一个历史库存模板和一个网盘模板。
    const templateOptions = [{ id: 1, keys: ['code'] }, { id: 2, keys: [] }] as never;
    expect(isVisibleShippingVariant(emptyVariant(), templateOptions)).toBe(true);
    expect(isVisibleShippingVariant({ ...emptyVariant(), delivery_mode: 'card', card_id: 3 }, templateOptions)).toBe(false);
    expect(isVisibleShippingVariant({ ...emptyVariant(), delivery_template_id: 1 }, templateOptions)).toBe(false);
    expect(isVisibleShippingVariant({ ...emptyVariant(), delivery_template_id: 2 }, templateOptions)).toBe(true);
    expect(isVisibleShippingVariant({ ...emptyVariant(), delivery_template_id: 99 }, templateOptions)).toBe(false);
  });

  test('校验并读取拍下改价的目标价格', /* 当前回调处理规则配置和展示状态。 */ () => {
    expect(buildAdjustPriceConfig(' 9.9 ')).toBe('{"target_price":"9.9"}');
    expect(adjustPriceTarget([{ action_type: 'adjust_price', config_json: '{"target_price":"12.5"}', enabled: true }])).toBe('12.5');
    expect(adjustPriceTarget([{ action_type: 'send_text', message_template: 'x', enabled: true }])).toBe('');
    expect(adjustPriceTarget()).toBe('');
    expect(isValidAdjustPrice('9.9')).toBe(true);
    expect(isValidAdjustPrice('0.01')).toBe(true);
    expect(isValidAdjustPrice('1000000')).toBe(true);
    expect(isValidAdjustPrice('0')).toBe(false);
    expect(isValidAdjustPrice('')).toBe(false);
    expect(isValidAdjustPrice('1.234')).toBe(false);
    expect(isValidAdjustPrice('abc')).toBe(false);
    expect(isValidAdjustPrice('1000000.01')).toBe(false);
    expect(actionSummary(rule({ trigger_type: 'order_created', actions: [{ action_type: 'adjust_price', config_json: '{"target_price":"9.9"}', enabled: true }] }))).toBe('拍下后改价为 ¥9.9');
    expect(actionSummary(rule({ trigger_type: 'order_created', actions: [] }))).toBe('未配置目标价格');
  });

  test('汇总动作、主题样式和布尔标志', /* 当前回调处理规则配置和展示状态。 */ () => {
    expect(actionSummary(rule({ trigger_type: 'review_missing_timeout', actions: [{ action_type: 'send_text', message_template: '请评价', enabled: true }] }))).toBe('请评价');
    expect(actionSummary(rule({ trigger_type: 'review_missing_timeout', actions: [] }))).toBe('发送求评价文案');
    expect(actionSummary(rule({ actions: [] }))).toBe('未配置发货内容');
    expect(actionSummary(rule({ actions: [
      { action_type: 'send_card', card_id: 1, card_name: '库存一', enabled: true },
      { action_type: 'send_card', card_id: 2, enabled: true },
      { action_type: 'send_text', message_template: '忽略', enabled: true },
    ] }))).toBe('已有历史发货配置');
    // 旧库存名字不应从列表摘要暴露，但合法发货模板仍展示。
    expect(actionSummary(rule({ actions: [
      { action_type: 'send_card', card_id: 1, card_name: '仅作历史保留的库存', enabled: true },
      { action_type: 'send_template', delivery_template_id: 7, delivery_template_name: '网盘发货模板', enabled: true },
    ] }))).toBe('网盘发货模板');
    expect(accentClasses('blue', true)).toContain('border-blue-500');
    expect(accentClasses('amber')).toContain('hover:border-amber-300');
    expect(accentClasses('unknown' as never)).toContain('border-blue-100');
    expect(statusPill(true)).toContain('bg-emerald-100');
    expect(statusPill(false)).toContain('bg-gray-200');
    expect(boolFlag(true)).toBe(true);
    expect(boolFlag(1)).toBe(true);
    expect(boolFlag('1')).toBe(true);
    expect(boolFlag(false)).toBe(false);
    expect(boolFlag('true')).toBe(false);
  });

  test('创建空规格并选择账号展示名称', /* 当前回调处理规则配置和展示状态。 */ () => {
    expect(emptyVariant()).toEqual({ spec_name: '', spec_value: '', card_id: 0, delivery_count: 1, enabled: true, delay_override: false, delay_seconds: 0, delivery_mode: 'template', delivery_template_id: 0, template_bindings: [], custom_variables: {} });
    // idOnly 是仅包含平台账号标识的最小账号对象。
    const idOnly = { id: 'account-1' } as AccountDetail;
    expect(accountLabel({ id: 'a', nickname: '昵称' } as AccountDetail)).toBe('昵称');
    expect(accountLabel({ id: 'a', remark: '备注' } as AccountDetail)).toBe('备注');
    expect(accountLabel(idOnly)).toBe('account-1');
    expect(accountLabel()).toBe('未知账号');
  });

  test('严格校验模板卡密变量绑定，包括零变量模板', /* 当前回调覆盖模板绑定完整性和非法键拒绝。 */ () => {
    expect(hasCompleteTemplateBindings([], [])).toBe(true);
    expect(hasCompleteTemplateBindings(['main'], [{ variable_key: 'main', card_id: 1, delivery_count: 1 }])).toBe(true);
    expect(hasCompleteTemplateBindings(['main'], [])).toBe(false);
    expect(hasCompleteTemplateBindings(['main'], [{ variable_key: 'main', card_id: 0, delivery_count: 1 }])).toBe(false);
    expect(hasCompleteTemplateBindings(['main'], [{ variable_key: 'other', card_id: 1, delivery_count: 1 }])).toBe(false);
    expect(hasCompleteTemplateBindings(['main'], [
      { variable_key: 'main', card_id: 1, delivery_count: 1 },
      { variable_key: 'main', card_id: 2, delivery_count: 1 },
    ])).toBe(false);
  });
});

// 通用发货授权必须由布尔勾选产生，旧配置默认不授权且其他配置字段保持不变。
test('全商品发货确认保留其他配置且可撤销', /* 当前回调验证授权配置的创建、保留和撤销。 */ () => {
  expect(JSON.parse(withAllItemsConfirmation(undefined, false))).toEqual({ allow_all_items: false });
  expect(JSON.parse(withAllItemsConfirmation('{bad', true))).toEqual({ allow_all_items: true });
  expect(JSON.parse(withAllItemsConfirmation('{"after_shipped_hours":24}', true))).toEqual({ after_shipped_hours: 24, allow_all_items: true });
  expect(JSON.parse(withAllItemsConfirmation('{"allow_all_items":true}', false))).toEqual({ allow_all_items: false });
});

// 列表应清楚区分待确认账号通用规则与可以执行的商品规则。
test('旧账号级规则显示待确认提示', /* 当前回调验证规则列表的范围提示。 */ () => {
  expect(needsAllItemsConfirmation(rule())).toBe(true);
  expect(needsAllItemsConfirmation(rule({ config_json: '{"allow_all_items":"true"}' }))).toBe(true);
  expect(needsAllItemsConfirmation(rule({ config_json: '{"allow_all_items":true}' }))).toBe(false);
  expect(needsAllItemsConfirmation(rule({ item_id: 'item-a' }))).toBe(false);
  expect(needsAllItemsConfirmation(rule({ trigger_type: 'buyer_reviewed' }))).toBe(false);
});
