// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import TemplateVariantEditor from './TemplateVariantEditor';
import type { Card, DeliveryTemplate, ShippingVariant } from '../types';

// templateFixture 是包含卡密和自定义变量的最小模板摘要。
const templateFixture: DeliveryTemplate = {
  id: 9,
  name: '订单通知',
  enabled: true,
  messages: [{ id: 1, sort_order: 1, content: '{{custom.remark}} {{cards.main}}' }],
  keys: ['main'],
  custom_keys: ['remark'],
  created_at: '',
  updated_at: '',
};

// variantFixture 是模板变量编辑器使用的空白规则变体。
const variantFixture: ShippingVariant = {
  spec_name: '',
  spec_value: '',
  card_id: 0,
  delivery_count: 1,
  enabled: true,
  delivery_mode: 'template',
  delivery_template_id: 9,
  template_bindings: [{ variable_key: 'main', card_id: 0, delivery_count: 1 }],
  custom_variables: {},
};

describe('TemplateVariantEditor 自定义变量配置', /* 当前回调验证模板自定义变量 key/value 编辑行为。 */ () => {
  afterEach(/* 当前回调清理模板变量编辑器测试 DOM。 */ () => cleanup());

test('按模板 key 显示字符串 value 输入，而不是数组下标输入', /* 当前回调验证自定义变量按模板 key 展示。 */ () => {
    // updateVariant 是验证编辑回调是否接收到键值表更新的替身。
    const updateVariant = vi.fn();
    // cards 是当前规则可选的卡密库存摘要。
    const cards: Card[] = [{ id: 1, name: '主卡', type: 'text', enabled: true }];
    render(<TemplateVariantEditor index={0} variant={variantFixture} cards={cards} deliveryTemplates={[templateFixture]} updateVariant={updateVariant} />);

    expect(screen.getByText('{{custom.remark}}')).toBeTruthy();
    expect(screen.getByPlaceholderText('填写 remark 对应的字符串')).toBeTruthy();
    expect(screen.queryByText('{{cards.main}}')).toBeNull();
  });
});

afterEach(/* 当前回调清理后续模板变量编辑器测试 DOM。 */ () => cleanup());

test('隐藏库存绑定控件但保留发货模板选择', /* 库存能力继续存在于配置模型，界面只允许编辑自定义变量。 */ () => {
  // cards 是包含所有卡券类型和启用状态的筛选样例。
  const cards: Card[] = [
    { id: 1, name: '文本卡', type: 'text', enabled: true },
    { id: 2, name: '批量卡', type: 'data', enabled: true },
    { id: 3, name: '就绪 API 卡', type: 'api', enabled: true, api_config: { url: 'https://example.test', method: 'GET', timeout_seconds: 10, retry_enabled: true, headers_configured: true, params_configured: true, ready: true } },
    { id: 4, name: '图片卡', type: 'image', enabled: true },
    { id: 5, name: '停用文本卡', type: 'text', enabled: false },
    { id: 6, name: '停用批量卡', type: 'data', enabled: false },
    { id: 7, name: '未就绪 API 卡', type: 'api', enabled: true, api_config: { url: 'https://example.test', method: 'GET', timeout_seconds: 10, retry_enabled: true, headers_configured: false, params_configured: false, ready: false } },
  ];
  // updateVariant 是验证选择器变更回传的编辑回调替身。
  const updateVariant = vi.fn();
  render(<TemplateVariantEditor index={0} variant={variantFixture} cards={cards} deliveryTemplates={[templateFixture]} updateVariant={updateVariant} />);

  expect(screen.queryByRole('option', { name: '订单通知' })).toBeNull();
  expect(screen.queryByRole('option', { name: '文本卡' })).toBeNull();
  expect(screen.queryByRole('option', { name: '批量卡' })).toBeNull();
  expect(screen.queryByRole('option', { name: '就绪 API 卡' })).toBeNull();
  expect(screen.queryByRole('option', { name: '图片卡' })).toBeNull();
  expect(screen.queryByRole('option', { name: '停用文本卡' })).toBeNull();
  expect(screen.queryByRole('option', { name: '停用批量卡' })).toBeNull();
  expect(screen.queryByRole('option', { name: '未就绪 API 卡' })).toBeNull();
});

test('已有库存绑定隐藏，但编辑自定义变量不覆盖原绑定', /* 只提交变动字段，历史库存配置仍由上层草稿保留。 */ () => {
  // cards 是已有绑定和另一个可选库存的最小列表。
  const cards: Card[] = [
    { id: 1, name: '已绑定文本卡', type: 'text', enabled: true },
    { id: 2, name: '批量卡', type: 'data', enabled: true },
  ];
  // updateVariant 是验证数量编辑结果的回调替身。
  const updateVariant = vi.fn();
  render(<TemplateVariantEditor index={0} variant={{ ...variantFixture, template_bindings: [{ variable_key: 'main', card_id: 1, delivery_count: 1 }] }} cards={cards} deliveryTemplates={[templateFixture]} updateVariant={updateVariant} />);

  expect(screen.queryByRole('option', { name: '已绑定文本卡' })).toBeNull();
  expect(screen.queryByRole('spinbutton', { name: 'main 每件份数' })).toBeNull();
  fireEvent.change(screen.getByPlaceholderText('填写 remark 对应的字符串'), { target: { value: '订单已发货' } });
  expect(updateVariant).toHaveBeenCalledWith(0, { custom_variables: { remark: '订单已发货' } });
});

test('新增与历史规则均不暴露需要库存绑定的模板选项', /* 历史绑定仍由上层数据保存，但精简视图不提供该编辑入口。 */ () => {
  // plainTemplate 是仅包含自定义变量、可以在当前界面完整配置的发货模板。
  const plainTemplate: DeliveryTemplate = { ...templateFixture, id: 10, name: '网盘链接', keys: [], messages: [{ id: 2, sort_order: 1, content: '{{custom.remark}}' }] };
  // updateVariant 是组件选择模板时的更新回调替身。
  const updateVariant = vi.fn();
  render(<TemplateVariantEditor index={0} variant={{ ...variantFixture, delivery_template_id: 0 }} cards={[]} deliveryTemplates={[templateFixture, plainTemplate]} updateVariant={updateVariant} />);
  expect(screen.queryByRole('option', { name: '订单通知' })).toBeNull();
  expect(screen.getByRole('option', { name: '网盘链接' })).toBeTruthy();
  cleanup();
  render(<TemplateVariantEditor index={0} variant={variantFixture} cards={[]} deliveryTemplates={[templateFixture, plainTemplate]} updateVariant={updateVariant} />);
  expect(screen.queryByRole('option', { name: '订单通知' })).toBeNull();
});
