// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountDetail } from './models';
import OperationsCenter from './components/OperationsCenter';
import { readOperationsAudit, readOperationsRuntime, readOperationsSales, readOperationsTasks } from './api';

vi.mock('./api', /* 替换为本地查询的确定性测试端口，不执行平台动作。 */ () => ({ readOperationsAudit: vi.fn(), readOperationsRuntime: vi.fn(), readOperationsSales: vi.fn(), readOperationsTasks: vi.fn() }));

// accounts 保存两家虚拟测试店铺的非敏感摘要。
const accounts: AccountDetail[] = [
  { id: 'one', remark: '店铺一', enabled: true, auto_confirm: false, auto_consign: false, auto_bargain: false },
  { id: 'two', remark: '店铺二', enabled: false, auto_confirm: false, auto_consign: false, auto_bargain: false },
];

describe('运营中心本地数据', /* 覆盖账号范围切换、失败展示、管理员日志显式读取。 */ () => {
  beforeEach(/* 每个测试使用独立且无网络请求的测试数据。 */ () => {
    vi.clearAllMocks();
    vi.mocked(readOperationsSales).mockResolvedValue({ amount: 10.5, orders: 2, received: 8, cancelled: 0 });
    vi.mocked(readOperationsTasks).mockResolvedValue([{ id: 1, accountId: 'one', kind: 'auto_rate', source: '账号计划', status: 'success', at: 1 }]);
    vi.mocked(readOperationsAudit).mockResolvedValue([{ id: 2, accountId: 'two', kind: 'order_paid', source: '规则审计', status: 'needs_review', at: 2 }]);
    vi.mocked(readOperationsRuntime).mockResolvedValue([]);
  });
  afterEach(/* 每次测试释放组件并取消尚未结束的读取。 */ () => cleanup());

  it('汇总不请求每个账号的任务，切换店铺后查询指定账号', /* 验证不扇出本地任务查询。 */ async () => {
    render(<OperationsCenter accounts={accounts} />);
    await screen.findByText('¥10.50');
    expect(readOperationsTasks).not.toHaveBeenCalled();
    expect(readOperationsRuntime).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('运营店铺'), { target: { value: 'one' } });
    await screen.findByText('评价任务');
    expect(readOperationsTasks).toHaveBeenCalledWith('one', expect.any(AbortSignal));
    expect(readOperationsSales).toHaveBeenLastCalledWith('one', 7, expect.any(AbortSignal));
    fireEvent.change(screen.getByLabelText('审计状态'), { target: { value: 'skipped' } });
    await waitFor(/* 检查跳过审计筛选条件。 */ () => expect(readOperationsAudit).toHaveBeenLastCalledWith('one', 'skipped', expect.any(AbortSignal)));
  });

  it('读取失败不显示虚假零收入，管理员日志需要主动打开', /* 验证请求失败隔离以及读取意图。 */ async () => {
    vi.mocked(readOperationsSales).mockRejectedValueOnce(new Error('local failure'));
    render(<OperationsCenter accounts={accounts} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('¥0.00')).toBeNull();
    expect(screen.getByText('付款规则')).toBeTruthy();
    expect(readOperationsRuntime).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看管理员运行错误' }));
    await waitFor(/* 只能读取当前用户范围内的摘要。 */ () => expect(readOperationsRuntime).toHaveBeenCalledWith(['one', 'two'], expect.any(AbortSignal)));
  });
});
