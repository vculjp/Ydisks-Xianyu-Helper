// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { emptyAutomation, newAction } from '../templateDraft';
import type { SpecScope } from '../templateDraft';
import { TemplateAutomationEditor } from './TemplateAutomationEditor';

afterEach(/* cleanupUI 清理每轮界面测试挂载的 DOM，避免跨用例污染。 */ () => cleanup());

test('隐藏卡密动作入口但添加发货模板不会删除旧动作', /* 界面仅隐藏库存操作，历史自动化动作必须原样保存在更新载荷中。 */ () => {
  // scope 是单规格商品的唯一自动化范围；保留动作原始索引以验证数组不被截断。
  const scope: SpecScope = { specName: '', specValue: '', label: '全部订单' };
  // historicalAction 是现有库存动作；仍由服务端自动化执行但不在编辑器中展示。
  const historicalAction = { ...newAction('send_card', scope), cardId: 12 };
  // automation 是带历史动作的模板自动化草稿。
  const automation = emptyAutomation();
  automation.paidDelivery = { enabled: true, actions: [historicalAction] };
  // onChange 记录用户添加模板动作后要持久化的完整自动化草稿。
  const onChange = vi.fn();
  render(<TemplateAutomationEditor automation={automation} scopes={[scope]} cards={[{ id: 12, name: '已有库存', type: 'text' }]} deliveryTemplates={[]} onChange={onChange} />);

  expect(screen.queryByRole('button', { name: '发送卡密' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: '卡密组' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '发货模板' }));
  expect(onChange).toHaveBeenCalledWith({ ...automation, paidDelivery: { enabled: true, actions: [historicalAction, newAction('send_template', scope)] } });
});

test('商品模板自动化仅允许新增无需卡密绑定的发货模板', /* 保证隐藏卡密绑定后不会产生无法配置的新增动作。 */ () => {
  // scope 是本次测试唯一发货范围。
  const scope: SpecScope = { specName: '', specValue: '', label: '全部订单' };
  // automation 含一条待选择发货模板的动作。
  const automation = emptyAutomation();
  automation.paidDelivery = { enabled: true, actions: [newAction('send_template', scope)] };
  render(<TemplateAutomationEditor automation={automation} scopes={[scope]} cards={[]} deliveryTemplates={[{ id: 1, name: '旧卡密模板', keys: ['code'], customKeys: [] }, { id: 2, name: '网盘链接模板', keys: [], customKeys: ['link'] }]} onChange={vi.fn()} />);
  expect(screen.queryByRole('option', { name: '旧卡密模板' })).toBeNull();
  expect(screen.getByRole('option', { name: '网盘链接模板' })).toBeTruthy();
});

test('历史库存模板动作不展示，但新增普通发货动作仍保留完整原始数组', /* 历史模板不会以残缺绑定误编辑，也不影响链接模板添加。 */ () => {
  // scope 表示单规格模板使用的动作范围。
  const scope: SpecScope = { specName: '', specValue: '', label: '全部订单' };
  // historical 保存一个曾绑定库存变量的发货模板动作。
  const historical = { ...newAction('send_template', scope), deliveryTemplateId: 10, templateBindings: [{ variableKey: 'code', cardId: 2, deliveryCount: 1 }] };
  // automation 包含旧动作，编辑其余内容时不得丢失。
  const automation = emptyAutomation();
  automation.paidDelivery = { enabled: true, actions: [historical] };
  // onChange 断言新动作被追加而非覆盖。
  const onChange = vi.fn();
  render(<TemplateAutomationEditor automation={automation} scopes={[scope]} cards={[]} deliveryTemplates={[{ id: 10, name: '历史库存模板', keys: ['code'], customKeys: [] }, { id: 20, name: '网盘链接模板', keys: [], customKeys: ['link'] }]} onChange={onChange} />);
  expect(screen.queryByText('历史库存模板')).toBeNull();
  expect(screen.queryByRole('combobox', { name: '变量 code 的卡密组' })).toBeNull();
  expect(screen.getByText(/部分历史发货配置在精简界面中不显示/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '发货模板' }));
  expect(onChange).toHaveBeenCalledWith({ ...automation, paidDelivery: { enabled: true, actions: [historical, newAction('send_template', scope)] } });
});
