import type { AccountDetail } from './models';

/** summarizeSafety 仅根据本地账号摘要分类，不将在线状态解释为平台合规或无风控。 */
export function summarizeSafety(accounts: readonly AccountDetail[]) {
  // totals 汇总互斥的运行状态，未知连接状态单独展示。
  const totals = { online: 0, attention: 0, pending: 0, disabled: 0 };
  // account 是当前待分类的已授权账号摘要。
  for (const /* 当前参与分类的本地账号摘要。 */ account of accounts) {
    if (!account.enabled || account.runtime_state === 'disabled') totals.disabled++;
    else if (account.paused || ['auth_expired', 'verification_required', 'runtime_conflict', 'error', 'stopped'].includes(account.runtime_state || '')) totals.attention++;
    else if (account.runtime_state === 'online' && account.runtime_connected === true) totals.online++;
    else totals.pending++;
  }
  return totals;
}

/** accountAttentionReason 根据本地状态给出固定的人工核对提示，不展示可能含秘密的原始错误文本。 */
export function accountAttentionReason(account: AccountDetail): string {
  if (!account.enabled || account.runtime_state === 'disabled') return '';
  switch (account.runtime_state) {
    case 'verification_required': return '平台要求验证，请停止操作并在官方渠道核实';
    case 'auth_expired': return '登录失效，请人工检查授权';
    case 'runtime_conflict': return '运行实例冲突，请检查本地服务';
    case 'error': case 'stopped': return '运行异常，请检查日志及待处理订单';
  }
  return account.paused ? '存在暂停状态，请核对任务' : '';
}

/** StopVerification 是批次结束时持久化状态的复核结果，不把接口确认或者账号消失当作停用。 */
export interface StopVerification {
  // disabled 是重新查询时明确显示停用的账号。
  disabled: string[];
  // enabled 是重新查询时仍启用的账号。
  enabled: string[];
  // unknown 是查询结果中缺失的账号，必须人工核对。
  unknown: string[];
}

/** verifyStoppedAccounts 只根据重新读取的本地启停字段判断，不推断远端会话已经断开。 */
export function verifyStoppedAccounts(ids: readonly string[], latest: readonly AccountDetail[]): StopVerification {
  // states 使用账号 ID 索引重新读取的持久化状态。
  const states = new Map(latest.map(/* 取账号标识及本地持久化启用字段。 */ account => [account.id, account.enabled] as const));
  // result 按计划停用的账号记录互斥的复核结果。
  const result: StopVerification = { disabled: [], enabled: [], unknown: [] };
  for (const /* 当前待复核账号标识。 */ id of new Set(ids)) {
    if (!states.has(id)) result.unknown.push(id);
    else if (states.get(id) === false) result.disabled.push(id);
    else result.enabled.push(id);
  }
  return result;
}

/** DisableResult 记录停用接口确认及未确认的账号 ID，不保留接口错误正文。 */
export interface DisableResult {
  // confirmed 是明确返回成功的账号标识。
  confirmed: string[];
  // unconfirmed 是失败或响应不确定的账号标识，需要重新核对。
  unconfirmed: string[];
  // remaining 是取消后尚未开始处理的账号标识。
  remaining: string[];
}

/** DisableConfirmation 只保留停用接口的确认字段。 */
export interface DisableConfirmation {
  // success 仅在服务端明确确认停用时为真。
  success: boolean;
}

/** disableAccounts 顺序调用本地停用接口；取消只阻止后续操作，不承诺撤回已发送请求。 */
export async function disableAccounts(
  // accounts 是用户确认前重新取得的当前账号摘要。
  accounts: readonly AccountDetail[],
  // disable 是已有的账号停用操作，仅接受当前账号标识。
  disable: (id: string) => Promise<DisableConfirmation>,
  // signal 由所在面板持有，用于停止尚未开始的操作。
  signal: AbortSignal,
): Promise<DisableResult> {
  // ids 去除已停用账号和重复标识，避免重复写入。
  const ids = [...new Set(accounts.filter(/* 仅选择仍启用的账号。 */ account => account.enabled).map(/* 只取不含凭证的账号标识。 */ account => account.id))];
  // result 累计每条操作的明确结果，任何失败都不得显示全部成功。
  const result: DisableResult = { confirmed: [], unconfirmed: [], remaining: [] };
  // id 是当前待停用的账号标识；顺序执行，不并发写入。
  for (const /* 当前顺序提交的账号标识。 */ id of ids) {
    if (signal.aborted) { result.remaining.push(id); continue; }
    try {
      // response 是本地停用接口返回的确认结果。
      const response = await disable(id);
      (response.success === true ? result.confirmed : result.unconfirmed).push(id);
    } catch {
      result.unconfirmed.push(id);
    }
  }
  return result;
}
