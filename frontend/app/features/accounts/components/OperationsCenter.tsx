import { useEffect, useState } from 'react';
import type { AccountDetail } from '../models';
import { readOperationsAudit, readOperationsRuntime, readOperationsSales, readOperationsTasks, type OperationsEvent, type OperationsSales } from '../api';

/** OperationsCenterProps 只接收已有账号摘要，不持有账号凭证。 */
interface OperationsCenterProps {
  // accounts 是当前用户可管理的店铺清单。
  accounts: AccountDetail[];
}

/** eventLabels 将任务状态翻译为简短的固定界面文案。 */
const eventLabels: Record<string, string> = { failed: '失败', needs_review: '待人工核对', skipped: '已跳过', success: '成功', running: '运行中', canceled: '已取消', queued: '排队中', auto_rate: '评价任务', auto_polish: '擦亮任务', order_paid: '付款规则', order_created: '订单规则', buyer_reviewed: '评价规则', review_missing_timeout: '评后提醒规则', automation: '自动化', engine: '消息引擎', mtop: '平台接口', ws: '连接', renewal: '授权', notify: '通知', http: '内部接口', other: '其他' };

/** EventRows 按来源显示最近的非敏感本地记录，不提供重试或自动运行入口。 */
function EventRows({ events, accounts }: { /** events 为当前页面查询结果。 */ events: OperationsEvent[]; /** accounts 为账号名称索引来源。 */ accounts: AccountDetail[] }) {
  if (!events.length) return <p className="text-sm text-gray-500">当前查询没有记录。</p>;
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-gray-500"><th className="p-2">店铺</th><th className="p-2">任务</th><th className="p-2">状态</th><th className="p-2">时间</th></tr></thead><tbody>
    {events.map(/* event 为当前有归属的本地记录。 */ event => {
      // account 从用户摘要中查找昵称与备注。
      const account = accounts.find(/* item 是待匹配的本人账号。 */ item => item.id === event.accountId);
      return <tr key={`${event.source}-${event.id}`} className="border-t border-gray-100"><td className="p-2">{account?.remark || account?.nickname || event.accountId}</td><td className="p-2">{eventLabels[event.kind] || event.kind}</td><td className="p-2">{eventLabels[event.status] || event.status}</td><td className="p-2 whitespace-nowrap">{event.at > 0 ? new Date(event.at * 1000).toLocaleString() : '—'}</td></tr>;
    })}
  </tbody></table></div>;
}

/** OperationsCenter 是显式打开的本地运营总览；筛选改变或卸载时取消旧查询，不发起平台请求。 */
export default function OperationsCenter({ accounts }: OperationsCenterProps) {
  // selection 与 setSelection 保存店铺筛选，不影响现有任务状态。
  const [selection, setSelection] = useState('');
  // days 与 setDays 保存包含今天的统计天数。
  const [days, setDays] = useState(7);
  // filter 与 setFilter 保存审计结果分类。
  const [filter, setFilter] = useState<'failed' | 'needs_review' | 'skipped'>('needs_review');
  // version 与 setVersion 由用户触发本地刷新，不设置后台轮询。
  const [version, setVersion] = useState(0);
  // showRuntime 由用户明确开启管理员日志查询，权限不足不自动重试。
  const [showRuntime, setShowRuntime] = useState(false);
  // sales、tasks、audit 是相互独立的查询结果；null 表示尚未读取或失败，不能显示为零。
  const [sales, setSales] = useState<OperationsSales | null>(null);
  // tasks 与 setTasks 仅保存当前所选店铺的本地任务记录。
  const [tasks, setTasks] = useState<OperationsEvent[] | null>(null);
  const [audit, setAudit] = useState<OperationsEvent[] | null>(null);
  // runtime 保存主动请求的本地错误日志摘要，未读取用 null 表示。
  const [runtime, setRuntime] = useState<OperationsEvent[] | null>(null);
  // loading 和 error 记录本轮本地查询是否完成及哪些分区失败。
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // accountId 防止已删除账号留下失效的筛选条件。
  const accountId = accounts.some(/* 检查选中账号仍存在。 */ account => account.id === selection) ? selection : '';
  // accountScope 是稳定的本人账号范围快照，避免账号状态轮询导致额外查询。
  const accountScope = JSON.stringify(accountId ? [accountId] : accounts.map(/* 只保存授权账号标识。 */ account => account.id).sort());

  useEffect(/* 对选定范围进行一次本地查询；清理时取消全部旧请求并忽略晚到响应。 */ () => {
    // controller 由本轮查询独占，负责取消及晚到响应校验。
    const controller = new AbortController();
    setSales(null); setTasks(null); setAudit(null); setRuntime(null); setLoading(true); setError('');
    // fetchAll 将三项独立查询的失败隔离，避免部分失败时抹掉其他有效数据。
    async function fetchAll() {
      // results 是仅访问本地数据库的销售、任务、审计结果；不对全部账号逐个扇出任务查询。
      const results = await Promise.allSettled([readOperationsSales(accountId, days, controller.signal), accountId ? readOperationsTasks(accountId, controller.signal) : Promise.resolve(null), readOperationsAudit(accountId, filter, controller.signal), showRuntime ? readOperationsRuntime(JSON.parse(accountScope) as string[], controller.signal) : Promise.resolve(null)] as const);
      if (controller.signal.aborted) return;
      if (results[0].status === 'fulfilled') setSales(results[0].value);
      if (results[1].status === 'fulfilled') setTasks(results[1].value);
      if (results[2].status === 'fulfilled') setAudit(results[2].value);
      if (results[3].status === 'fulfilled') setRuntime(results[3].value);
      if (results.some(/* 任一查询拒绝即提示数据不完整。 */ result => result.status === 'rejected')) setError('部分本地数据读取失败，请刷新核对；未读取数据不计为零。');
      setLoading(false);
    }
    void fetchAll();
    return /* 卸载或筛选变化取消当前查询。 */ () => controller.abort();
  }, [accountId, days, filter, version, showRuntime, accountScope]);

  return <div className="space-y-5 border-t border-gray-100 pt-4">
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="运营店铺" className="ios-input rounded-xl p-2 text-sm" value={accountId} onChange={/* 切换汇总或单店铺。 */ event => setSelection(event.target.value)}><option value="">全部本人店铺</option>{accounts.map(/* account 是可查看的店铺。 */ account => <option key={account.id} value={account.id}>{account.remark || account.nickname || account.id}</option>)}</select>
      <select aria-label="统计范围" className="ios-input rounded-xl p-2 text-sm" value={days} onChange={/* 修改本地自然日统计窗口。 */ event => setDays(Number(event.target.value))}><option value={1}>今天</option><option value={7}>最近7天</option><option value={30}>最近30天</option></select>
      <button type="button" onClick={/* 人工刷新，不重复执行任务。 */ () => setVersion(/* n 是刷新代次。 */ n => n + 1)} disabled={loading} className="rounded-xl border px-3 py-2 text-sm">{loading ? '读取中…' : '刷新本地数据'}</button>
    </div>
    {error && <p role="alert" className="text-sm text-amber-800">{error}</p>}
    <div><h3 className="font-bold text-gray-900 mb-2">多店铺经营看板</h3><div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
      {[[ '销售额', sales ? `¥${sales.amount.toFixed(2)}` : '—' ], [ '销售订单', sales?.orders ?? '—' ], [ '已完成订单金额', sales ? `¥${sales.received.toFixed(2)}` : '—' ], [ '取消订单金额', sales ? `¥${sales.cancelled.toFixed(2)}` : '—' ]].map(/* entry 是单项统计指标。 */ ([label, value]) => <div key={label} className="rounded-xl bg-gray-50 p-3"><span className="text-gray-500">{label}</span><strong className="block text-lg">{value}</strong></div>)}
    </div><p className="text-xs text-gray-500 mt-2">本地已同步订单统计，按创建日期归属；不代表实际到账、利润或平台实时余额。</p></div>
    <div><h3 className="font-bold text-gray-900 mb-2">多账号任务记录</h3>{!accountId ? <p className="text-sm text-gray-500">选择一个店铺查看最近20条计划任务。账号启停和任务设置仍在各账号卡片。</p> : tasks ? <EventRows events={tasks} accounts={accounts} /> : <p className="text-sm text-gray-500">暂未取得记录。</p>}</div>
    <div><h3 className="font-bold text-gray-900 mb-2">异常与任务去重审计</h3><select aria-label="审计状态" className="ios-input rounded-xl p-2 text-sm mb-2" value={filter} onChange={/* 切换审计事件分类，不触发执行。 */ event => { if (event.target.value === 'failed' || event.target.value === 'needs_review' || event.target.value === 'skipped') setFilter(event.target.value); }}><option value="needs_review">待人工核对</option><option value="failed">失败</option><option value="skipped">已跳过（含幂等拦截）</option></select>
      {audit ? <EventRows events={audit} accounts={accounts} /> : <p className="text-sm text-gray-500">暂未取得记录。</p>}
      <p className="text-xs text-gray-500 mt-2">每类最近30条本地审计事件；跳过不等于全部为重复任务。原始诊断请使用现有运行日志及规则日志。</p>
      <button type="button" disabled={loading} onClick={/* 仅用户主动打开管理员日志，仍由服务端检查权限。 */ () => setShowRuntime(!showRuntime)} className="rounded-xl border px-3 py-2 text-sm mt-3">{showRuntime ? '隐藏管理员运行错误' : '查看管理员运行错误'}</button>
      {showRuntime && <div className="mt-2">{runtime ? <EventRows events={runtime} accounts={accounts} /> : <p className="text-sm text-gray-500">未取得运行日志（可能需要管理员权限）。</p>}<p className="text-xs text-gray-500">最近100条错误中的本人账号摘要；无账号标识的系统级错误仍在运行日志页查看。</p></div>}
    </div>
  </div>;
}
