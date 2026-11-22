import { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { getAccountDetails, updateAccountStatus } from '../api';
import type { AccountDetail } from '../models';
import { accountAttentionReason, disableAccounts, summarizeSafety, verifyStoppedAccounts } from '../safety';
import { confirmAction, notify } from '../../../../shared/ui/feedback';

import OperationsCenter from './OperationsCenter';

/** SafetyPanelProps 复用账号页面的摘要和刷新动作，不自行轮询平台。 */
interface SafetyPanelProps {
  // accounts 是页面已加载的非敏感账号摘要。
  accounts: AccountDetail[];
  // refresh 在操作结束后重新读取本地账号列表。
  refresh: () => Promise<void>;
}

/** AccountSafetyPanel 展示运行概况，并允许用户明确确认后逐个停用当前账号；卸载停止后续操作。 */
export function AccountSafetyPanel({ accounts, refresh }: SafetyPanelProps) {
  // totals 直接从现有列表派生，不额外保存可能过时的统计值。
  const totals = summarizeSafety(accounts);
  // busy 和 setBusy 控制批量操作期间的按钮互斥。
  const [busy, setBusy] = useState(false);
  // message 和 setMessage 保存本轮停用结果的非敏感提示。
  const [message, setMessage] = useState('');
  // expanded 与 setExpanded 控制运营查询的生命周期，默认不读取销售或历史任务。
  const [expanded, setExpanded] = useState(false);
  // operation 同步防止重复点击，并持有未完成批次的取消控制器。
  const operation = useRef<AbortController | null>(null);
  useEffect(/* 面板卸载时终止后续本地停用请求。 */ () => /* 清理回调只取消当前批次。 */ () => operation.current?.abort(), []);

  // stopEnabled 由人工点击触发；获取最新列表后确认，不自动恢复或重新登录任何账号。
  async function stopEnabled() {
    if (operation.current) return;
    // controller 隔离当前操作生命周期，避免卸载后更新界面。
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setMessage('');
    try {
      // latest 是操作前重新查询的账号列表，不使用过期的筛选结果。
      const latest = await getAccountDetails({ signal: controller.signal });
      if (controller.signal.aborted) return;
      // enabled 是本轮确实需要停用的账号集合。
      const enabled = latest.filter(/* 保留仍启用的账号。 */ account => account.enabled);
      if (!enabled.length) { setMessage('当前没有启用的账号。'); return; }
      if (!(await confirmAction({ title: '停用全部启用账号', message: `确定停用当前 ${enabled.length} 个启用账号？可能中断客服和正在执行的任务，需逐个手动恢复。`, confirmText: '全部停用', danger: true }))) return;
      // result 只保存本地接口确认数量，异常响应不能当作停用成功。
      const result = await disableAccounts(enabled, /* 调用既有本地账号状态接口。 */ id => updateAccountStatus(id, false), controller.signal);
      if (!controller.signal.aborted) {
        // current 是批量操作之后重新读取的本地持久化状态，即使写请求超时也不能直接认定失败或成功。
        const current = await getAccountDetails({ signal: controller.signal });
        if (controller.signal.aborted) return;
        // verified 是目标账号的明确复核结果；账号缺失亦单列，不能算作停用成功。
        const verified = verifyStoppedAccounts(enabled.map(/* 只复核本轮用户确认的目标。 */ account => account.id), current);
        // summary 是接口确认数量与重新查询结果的非敏感说明。
        const summary = `接口确认 ${result.confirmed.length} 个；重新查询：已停用 ${verified.disabled.length} 个，仍启用 ${verified.enabled.length} 个，状态未知 ${verified.unknown.length} 个。请核对待处理订单。`;
        setMessage(summary);
        notify(verified.enabled.length > 0 || verified.unknown.length > 0 ? 'warning' : 'success', summary);
        await refresh();
      }
    } catch {
      if (!controller.signal.aborted) {
        setMessage('无法确认操作结果，请刷新账号状态并逐个核对。');
        notify('error', '无法确认停用结果，请刷新账号状态并逐个核对。');
      }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="ios-card p-5 space-y-4" aria-label="账号安全中心">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-extrabold text-gray-900"><ShieldAlert className="w-5 h-5" />账号安全中心</h2>
      <button type="button" disabled={busy || !accounts.some(/* 判断是否有可停用账号。 */ account => account.enabled)} onClick={/* 人工触发批量停用确认。 */ () => void stopEnabled()} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 font-bold text-red-700 disabled:opacity-50">{busy ? '处理中…' : '停用全部已启用账号'}</button>
    </div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 text-sm">
      <div className="rounded-xl bg-green-50 p-3 text-green-800">已连接 <strong className="block text-xl">{totals.online}</strong></div>
      <div className="rounded-xl bg-amber-50 p-3 text-amber-900">需人工关注 <strong className="block text-xl">{totals.attention}</strong></div>
      <div className="rounded-xl bg-gray-50 p-3 text-gray-700">连接待确认 <strong className="block text-xl">{totals.pending}</strong></div>
      <div className="rounded-xl bg-gray-50 p-3 text-gray-700">已停用 <strong className="block text-xl">{totals.disabled}</strong></div>
    </div>
    <p className="text-sm text-gray-500">仅展示本地运行状态，不代表平台无风险。遇到验证或登录失效，请停止相关操作并通过官方渠道核实。批量停用不是全局网络断开，已发出的请求可能仍会完成。</p>
    {totals.attention > 0 && <div className="space-y-2 border-t border-gray-100 pt-3" aria-label="需人工核对的账号">
      {accounts.map(/* 根据已加载摘要展示每个需要人工核对的账号。 */ account => {
        // reason 是固定的非敏感状态说明，而不是后端原始错误内容。
        const reason = accountAttentionReason(account);
        return reason ? <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>{account.remark || account.nickname || account.id}</strong><span>{reason}</span></div> : null;
      })}
    </div>}
    {message && <p role="status" className="text-sm text-gray-800">{message}</p>}
    <button type="button" className="rounded-xl border px-4 py-2 text-sm font-bold" aria-expanded={expanded} onClick={/* 展开或关闭本地运营总览。 */ () => setExpanded(!expanded)}>{expanded ? '收起运营总览' : '展开运营总览'}</button>
    {expanded && <OperationsCenter accounts={accounts} />}
  </section>;
}
