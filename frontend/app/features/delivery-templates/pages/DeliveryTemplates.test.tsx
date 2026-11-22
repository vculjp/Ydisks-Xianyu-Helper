// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { listDeliveryTemplates } from '../api';
import type { DeliveryTemplate } from '../types';
import DeliveryTemplates from './DeliveryTemplates';

vi.mock('../api', /* deliveryTemplatesApiMockFactory 提供发货模板页面的列表请求替身。 */ () => ({
  createDeliveryTemplate: vi.fn(),
  deleteDeliveryTemplate: vi.fn(),
  listDeliveryTemplates: vi.fn(),
  updateDeliveryTemplate: vi.fn(),
}));

// listDeliveryTemplatesMock 是模板列表读取接口的可控替身。
const listDeliveryTemplatesMock = vi.mocked(listDeliveryTemplates);

// emptyTemplateFixture 是空模板列表请求返回的稳定测试数据。
const emptyTemplateFixture: DeliveryTemplate[] = [];

describe('DeliveryTemplates 页面组合行为', /* 当前回调验证模板编辑器的打开状态和空白新建流程。 */ () => {
  beforeEach(/* 当前回调重置模板接口替身。 */ () => {
    listDeliveryTemplatesMock.mockResolvedValue(emptyTemplateFixture);
  });

  afterEach(/* 当前回调清理模板页面 DOM 和接口替身。 */ () => {
    cleanup();
    vi.clearAllMocks();
  });

  test('点击新建模板会显示空白编辑器', /* 当前回调验证空白新建草稿不会因为名称为空而被条件渲染隐藏。 */ async () => {
    render(<DeliveryTemplates />);
    await waitFor(/* loadAssertion 等待初始模板列表请求完成后再触发用户操作。 */ () => expect(listDeliveryTemplatesMock).toHaveBeenCalledTimes(1));

    // createButton 是页面标题区域触发新建模板的用户操作入口。
    const createButton = screen.getByRole('button', { name: '新建模板' });
    expect(screen.queryByText('新建发货模板')).toBeNull();
    fireEvent.click(createButton);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('新建发货模板')).toBeTruthy();
    expect(screen.getByPlaceholderText('例如：数字产品发货')).toBeTruthy();
    expect(screen.getByText('内置和自定义变量均用双大括号')).toBeTruthy();
    expect(screen.queryByText('{{cards.<变量名>}}')).toBeNull();
    expect(screen.getByText('{{buyer_nickname}}')).toBeTruthy();
    expect(screen.getByText('{{custom.<变量名>}}')).toBeTruthy();
    expect(screen.getByText('如何声明和使用')).toBeTruthy();

    // cancelButton 是浮窗底部放弃当前未保存模板草稿的操作入口。
    const cancelButton = screen.getByRole('button', { name: '取消' });
    fireEvent.click(cancelButton);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('页面只显示网盘发货模板，历史库存绑定模板不渲染可编辑入口', /* 页面隐藏历史库存资源但不调用删除接口。 */ async () => {
    // cardTemplate 是包含库存变量的历史模板，不能出现在当前简化列表。
    const cardTemplate = { id: 11, name: '历史卡密模板', enabled: true, keys: ['code'], custom_keys: [], messages: [{ id: 111, content: '{{cards.code}}' }] } as unknown as DeliveryTemplate;
    // linkTemplate 是不依赖库存资源的可复用链接模板。
    const linkTemplate = { id: 12, name: '网盘链接模板', enabled: true, keys: [], custom_keys: ['link'], messages: [{ id: 112, content: '链接：{{custom.link}}' }] } as unknown as DeliveryTemplate;
    listDeliveryTemplatesMock.mockResolvedValueOnce([cardTemplate, linkTemplate]);
    render(<DeliveryTemplates />);
    await waitFor(/* visibleTemplateAssertion 等待合法模板出现。 */ () => expect(screen.getByText('网盘链接模板')).toBeTruthy());
    expect(screen.queryByText('历史卡密模板')).toBeNull();
    expect(screen.queryByText('{{cards.code}}')).toBeNull();
    expect(screen.getByText('链接：{{custom.link}}')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(1);
  });
});
