import { describe, expect, it, vi } from 'vitest';
import type { AccountDetail } from './models';
import { accountAttentionReason, disableAccounts, summarizeSafety, verifyStoppedAccounts, type DisableConfirmation } from './safety';

/** account 为测试构造仅包含非敏感字段的账号。 */
function account(id: string, fields: Partial<AccountDetail> = {}): AccountDetail {
  return { id, enabled: true, auto_confirm: false, auto_consign: false, auto_bargain: false, ...fields };
}

describe('账号安全中心', /* 验证分类与人工停用的边界。 */ () => {
  it('运行状态互斥，异常优先于已连接', /* 覆盖正常、暂停、失效、待连接及停用。 */ () => {
    expect(summarizeSafety([
      account('1', { runtime_state: 'online', runtime_connected: true }),
      account('2', { runtime_state: 'auth_expired' }),
      account('3', { runtime_state: 'online', runtime_connected: true, paused: true }),
      account('4', { runtime_state: 'online', runtime_connected: false }),
      account('5', { enabled: false, runtime_state: 'verification_required' }),
      account('6', { runtime_state: 'disabled' }),
    ])).toEqual({ online: 1, attention: 2, pending: 1, disabled: 2 });
  });

  it('跳过重复和已停用账号，保留失败与未知结果', /* 验证顺序停用和部分成功报告。 */ async () => {
    // disable 模拟三次独立本地请求分别成功、拒绝和网络异常。
    const disable = vi.fn<(id: string) => Promise<DisableConfirmation>>()
      .mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false }).mockRejectedValueOnce(new Error('network'));
    expect(await disableAccounts([account('a'), account('a'), account('b'), account('c'), account('d', { enabled: false })], disable, new AbortController().signal))
      .toEqual({ confirmed: ['a'], unconfirmed: ['b', 'c'], remaining: [] });
    expect(disable.mock.calls).toEqual([['a'], ['b'], ['c']]);
  });

  it('取消后不发起新请求', /* 已提交请求可完成，但其余条目保持未处理。 */ async () => {
    // controller 模拟关闭安全面板。
    const controller = new AbortController();
    // disable 模拟第一个请求完成时发生取消。
    const disable = vi.fn(/* 首次请求确认后触发取消。 */ async () => { controller.abort(); return { success: true }; });
    expect(await disableAccounts([account('a'), account('b')], disable, controller.signal)).toEqual({ confirmed: ['a'], unconfirmed: [], remaining: ['b'] });
    expect(disable).toHaveBeenCalledTimes(1);
  });

  it('使用固定异常提示，不泄露原始错误', /* 验证多种运行异常和停用状态。 */ () => {
    expect(accountAttentionReason(account('a', { runtime_state: 'verification_required', runtime_message: 'secret' }))).toContain('官方渠道');
    expect(accountAttentionReason(account('b', { runtime_state: 'auth_expired' }))).toContain('登录失效');
    expect(accountAttentionReason(account('c', { paused: true }))).toContain('暂停');
    expect(accountAttentionReason(account('d', { enabled: false, runtime_state: 'error' }))).toBe('');
    expect(accountAttentionReason(account('e', { runtime_state: 'runtime_conflict' }))).toContain('冲突');
    expect(accountAttentionReason(account('f', { runtime_state: 'stopped' }))).toContain('异常');
    expect(accountAttentionReason(account('g'))).toBe('');
  });

  it('复核真实本地启停状态并区分缺失账号', /* 验证接口成功也不能覆盖后续启用状态。 */ () => {
    expect(verifyStoppedAccounts(['a', 'a', 'b', 'c'], [account('a', { enabled: false }), account('b'), account('d')]))
      .toEqual({ disabled: ['a'], enabled: ['b'], unknown: ['c'] });
  });
});
