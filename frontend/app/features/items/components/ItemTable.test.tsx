// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Item, ShippingRule } from '../models';
import ItemTable from './ItemTable';

// itemFixture 是账号 acc1 下的一个商品。
const itemFixture = { cookie_id: 'acc1', item_id: 'i1', item_title: '示例商品', item_price: '9.9', ai_override: 'enabled' } as Item;

// paidRule 是该商品专属的付款后自动发货规则。
const paidRule = { id: '1', name: 'r', trigger_type: 'order_paid', item_keyword: '', cookie_id: 'acc1', item_id: 'i1', card_group_id: 0, priority: 0, enabled: true, actions: [], variants: [] } as ShippingRule;

afterEach(cleanup);

// renderTable 渲染列表视图并返回各回调的记录函数。
const renderTable = (items: Item[], rules: ShippingRule[]) => {
  // handlers 记录表格触发的全部用户操作回调。
  const handlers = {
    onConfigureDelivery: vi.fn(), onOpenAISettings: vi.fn(), onEdit: vi.fn(), onSetShelf: vi.fn(), onToggleBargain: vi.fn(), onRefreshMetrics: vi.fn(), onDelete: vi.fn(),
    onToggleSelection: vi.fn(), onToggleAll: vi.fn(),
  };
  render(<ItemTable items={items} rules={rules} accountNickname={/* 返回固定昵称。 */ () => '店铺A'} formatPrice={/* 原样返回价格。 */ price => `¥${price}`} aiStatusText={{ inherit: '继承账号', enabled: '已启用', disabled: '已停用' }} emptyText="暂无商品" remoteItemBusy={null} selectedKeys={new Set()} allPageSelected={false} {...handlers} />);
  return handlers;
};

describe('ItemTable', /* 覆盖列表视图渲染与操作回调。 */ () => {
  test('显示真实商品指标并保留零值，缺失指标不伪造为零', /* itemMetricCase 捕获表格把全部指标写死为占位符的问题。 */ () => {
    // metricItem 是平台已返回曝光为零、浏览及想要为正数的商品。
    const metricItem = { ...itemFixture, exposure_count: 0, browse_count: 128, want_count: 9 };
    renderTable([metricItem], []);
    expect(screen.getByRole('cell', { name: '0' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '128' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '9' })).toBeTruthy();
    cleanup();
    renderTable([itemFixture], []);
    expect(screen.queryByRole('cell', { name: '0' })).toBeNull();
    expect(screen.getAllByText('—')).toHaveLength(5);
    cleanup();
    // invalidItem 验证非整数、非有限值和负数都不能显示为真实平台统计。
    const invalidItem = { ...itemFixture, exposure_count: Number.NaN, browse_count: 1.5, want_count: -1 };
    renderTable([invalidItem], []);
    expect(screen.getAllByText('—')).toHaveLength(5);
  });

  test('shows rule coverage per trigger and fires row actions', /* 已配置显示条数，其余显示未配置，操作回调带上商品。 */ () => {
    // handlers 是各行操作的记录函数。
    const handlers = renderTable([itemFixture], [paidRule]);
    expect((screen.getByRole('switch', { name: '配置发货规则：示例商品' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    /** openMenu 打开当前商品的“更多”浮层；每次操作后浮层都会关闭，因此需要按需重开。 */
    const openMenu = () => {
      fireEvent.click(screen.getByRole('button', { name: '更多操作：示例商品' }));
      return screen.getByRole('menu', { name: '商品操作：示例商品' });
    };
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '配置发货规则：示例商品' }));
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '编辑' }));
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '下架商品：示例商品' }));
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '刷新商品指标：示例商品' }));
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '删除' }));
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '配置商品 AI 客服：示例商品' }));
    expect(handlers.onConfigureDelivery).toHaveBeenCalledWith(itemFixture, 'order_paid');
    expect(handlers.onEdit).toHaveBeenCalledWith(itemFixture);
    expect(handlers.onSetShelf).toHaveBeenCalledWith(itemFixture);
    expect(handlers.onRefreshMetrics).toHaveBeenCalledWith(itemFixture);
    expect(handlers.onDelete).toHaveBeenCalledWith(itemFixture);
    expect(handlers.onOpenAISettings).toHaveBeenCalledWith(itemFixture);
  });

  test('shows bargain state from the platform label and toggles the switch', /* 2 人小刀状态来自闲鱼标签，点击开关应触发反向切换。 */ () => {
    // bargainItem 是闲鱼详情已带“2人小刀价”标签的商品。
    const bargainItem = {
      ...itemFixture,
      item_detail: '{"item_label_data":{"labelData":{"r3":{"tagList":[{"data":{"content":"2人小刀价"}}]}}}}',
    };
    const bargainHandlers = renderTable([bargainItem], []);
    const bargainSwitch = screen.getByRole('switch', { name: '2 人小刀状态：示例商品' }) as HTMLButtonElement;
    expect(bargainSwitch.getAttribute('aria-checked')).toBe('true');
    expect(bargainSwitch.disabled).toBe(false);
    fireEvent.click(bargainSwitch);
    expect(bargainHandlers.onToggleBargain).toHaveBeenCalledWith(bargainItem, false);
    cleanup();
    // 未开启的商品保持关闭，点击开关应请求开启。
    const offHandlers = renderTable([itemFixture], []);
    const offSwitch = screen.getByRole('switch', { name: '2 人小刀状态：示例商品' }) as HTMLButtonElement;
    expect(offSwitch.getAttribute('aria-checked')).toBe('false');
    expect(offSwitch.disabled).toBe(false);
    fireEvent.click(offSwitch);
    expect(offHandlers.onToggleBargain).toHaveBeenCalledWith(itemFixture, true);
  });

  test('renders the empty text when there are no items', /* 无商品时只显示提示。 */ () => {
    renderTable([], []);
    expect(screen.getByText('暂无商品')).toBeTruthy();
  });
  test('平台确认下架的商品只能显示重新上架按钮', /* offShelfButtonCase 验证状态操作和文案一致。 */ () => {
    // offItem 是已有下架回执的本地商品。
    const offItem = { ...itemFixture, item_detail: '{"shelf_state":"off"}' };
    // handlers 是复用表格操作回调的模拟器。
    const handlers = renderTable([offItem], []);
    fireEvent.click(screen.getByRole('button', { name: '更多操作：示例商品' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '商品操作：示例商品' })).getByRole('menuitem', { name: '上架商品：示例商品' }));
    expect(handlers.onSetShelf).toHaveBeenCalledWith(offItem);
  });
});
