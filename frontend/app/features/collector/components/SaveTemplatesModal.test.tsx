// @vitest-environment jsdom
import { act,cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollectedProduct, CollectorSaveTemplatesSummary } from '../types';
import { SaveTemplatesModal } from './SaveTemplatesModal';

// mockSave 替换真实模板转存请求，确保界面回归测试既不访问服务器也不请求闲鱼平台。
const mockSave = vi.hoisted(/* 创建本地 API 请求替身，记录每次提交的商品数量和补抓开关。 */ () => vi.fn());
vi.mock('../api', /* 使用纯本地替身验证弹窗行为，不依赖真实网络或账号。 */ () => ({
  saveProductsToTemplates: mockSave,
  collectorErrorMessage: /* 让测试中的意外错误可被稳定识别。 */ () => '模拟错误',
}));

/** makeItem 构造一件只有列表摘要的闲鱼商品，不提供任何账号凭证。 */
const makeItem = (index: number): CollectedProduct => ({
  itemId: `item-${index}`,
  title: `测试商品${index}`,
  description: `描述${index}`,
  price: '3.99',
  originalPrice: '',
  picUrl: 'https://example.test/item.jpg',
  imageUrls: ['https://example.test/item.jpg'],
  area: '北京',
  sellerId: 'seller',
  sellerNick: '示例卖家',
  wantCount: 0,
  browseCount: 0,
  categoryId: '',
  isFreeShipping: true,
  isMultiSpec: false,
  hasFullDetail: false,
  webUrl: 'https://www.goofish.com/item?id=1',
});

// busySummary 模拟截图中“2 件商品失败且因同行整店采集占用而停止”的真实回包形状。
const busySummary: CollectorSaveTemplatesSummary = {
  total: 2,
  succeeded: 0,
  failed: 2,
  abortedByRisk: true,
  results: [
    { itemId: 'item-1', title: '测试商品1', success: false, templateId: 0, imageCount: 0, errorReason: '补抓商品详情失败：已有采集操作正在运行，请等待完成并核对状态后再手动操作' },
    { itemId: 'item-2', title: '测试商品2', success: false, templateId: 0, imageCount: 0, errorReason: '本批次已安全停止，本商品未执行' },
  ],
};

// successSummary 模拟单件商品成功写入本地模板的稳定回包。
const successSummary: CollectorSaveTemplatesSummary = {
  total: 1,
  succeeded: 1,
  failed: 0,
  abortedByRisk: false,
  results: [{ itemId: 'item-1', title: '测试商品1', success: true, templateId: 9, imageCount: 1, errorReason: '' }],
};

afterEach(/* 每轮测试卸载弹窗并恢复 API 替身，防止互相污染。 */ () => {
  cleanup();
  mockSave.mockReset();
});

describe('SaveTemplatesModal 任务冲突与关闭状态', /* 验证无需绕过限流也能恢复转存，并且新批次不展示旧失败结果。 */ () => {
  it('缺少真实描述时禁止跳过补抓直接入库', /* 验证不能再次生成只有标题的商品模板，且不触发任何 API 调用。 */ () => {
    // missing 是从整店列表取得的无正文商品快照。
    const missing = { ...makeItem(10), description: '' };
    render(<SaveTemplatesModal open items={[missing]} cookieId="sample-account" deliveryTemplates={[]} onClose={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('缺少完整正文');
    expect((screen.getByRole('button', { name: '确认转存 1 件商品' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect((screen.getByRole('button', { name: '确认转存 1 件商品' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('补抓真实详情');
  });
  it('已有采集任务时提供保留补抓或关闭补抓两种人工恢复入口', /* 验证用户可自行选择是否继续补详情，没有后台自动重试。 */ async () => {
    mockSave.mockResolvedValue(busySummary);
    render(<SaveTemplatesModal open items={[makeItem(1), makeItem(2)]} cookieId="sample-account" deliveryTemplates={[]} onClose={vi.fn()} />);

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: '确认转存 2 件商品' }));
    expect(await screen.findByText(/当前有其他采集或账号任务在运行/)).toBeTruthy();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0].fetchDetailIfMissing).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '保留补抓，返回设置' }));
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true);
    expect(mockSave).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '确认转存 2 件商品' }));
    expect(await screen.findByText(/本次提交 2 件/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '不补抓详情，返回设置' }));
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认转存 2 件商品' }));
    expect(mockSave.mock.calls[2][0].fetchDetailIfMissing).toBe(false);
  });

  it('关闭旧批次后重新打开五件商品，不再显示旧批次两件商品的失败记录', /* 验证截图中选品数与旧结果不一致的状态泄漏被修复。 */ async () => {
    mockSave.mockResolvedValue(busySummary);
    // onClose 由父组件控制关闭；测试用重新渲染模拟用户选择下一批商品。
    const onClose = vi.fn();
    // view 保存当前测试树，以便在同一组件实例上变更 open 和 items。
    const view = render(<SaveTemplatesModal open items={[makeItem(1), makeItem(2)]} cookieId="sample-account" deliveryTemplates={[]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '确认转存 2 件商品' }));
    expect(await screen.findByText(/本次提交 2 件/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(<SaveTemplatesModal open={false} items={[]} cookieId="sample-account" deliveryTemplates={[]} onClose={onClose} />);
    view.rerender(<SaveTemplatesModal open items={[makeItem(1), makeItem(2), makeItem(3), makeItem(4), makeItem(5)]} cookieId="sample-account" deliveryTemplates={[]} onClose={onClose} />);

    expect(screen.queryByText(/本次提交 2 件/)).toBeNull();
    expect(screen.getByText(/已选择 5 件商品/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认转存 5 件商品' })).toBeTruthy();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('转存请求未完成时忽略重复点击', /* 验证同步锁覆盖按钮状态更新前的快速双击。 */ async () => {
    // resolveSave 保存挂起转存请求的兑现函数。
    let resolveSave: ((summary: CollectorSaveTemplatesSummary) => void) | undefined;
    mockSave.mockImplementationOnce(/* pendingFactory 保留首次转存请求未完成。 */ () => new Promise(/* resolve 保存测试可控完成入口。 */ resolve => { resolveSave = resolve; }));
    render(<SaveTemplatesModal open items={[makeItem(1)]} cookieId="sample-account" deliveryTemplates={[]} onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    // confirmButton 是提交转存的主按钮。
    const confirmButton = screen.getByRole('button', { name: '确认转存 1 件商品' });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    expect(mockSave).toHaveBeenCalledTimes(1);
    await act(/* completeSaveAction 放行首次转存结果。 */ async () => { resolveSave?.(successSummary); });
    expect(await screen.findByText(/本次提交 1 件/)).toBeTruthy();
  });
});
