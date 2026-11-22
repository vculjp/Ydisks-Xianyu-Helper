import { AlertCircle, CalendarClock, ClipboardPaste, Loader2, QrCode, RefreshCw, Trash2, User } from 'lucide-react';
import React from 'react';
import type { AccountDetail } from '../api';
import { accountRuntimePresentation } from '../runtime';

// RISK_GUIDE_URL 是账号风控恢复说明的公开教程地址，不包含任何账号凭证。
const RISK_GUIDE_URL = 'https://github.com/Christ9038/Ydisks-Xianyu-Helper/issues/92';

/** AccountTableProps 描述账号表格展示和逐行操作所需的非敏感数据。 */
export interface AccountTableProps {
  /** accounts 是当前筛选后的账号摘要。 */
  accounts: AccountDetail[];
  /** isPending 判断指定账号动作是否正在提交。 */
  isPending: (key: string) => boolean;
  /** onRefreshProfile 刷新指定账号的昵称和头像。 */
  onRefreshProfile: (account: AccountDetail) => void | Promise<void>;
  /** onReauthorize 为指定账号启动二维码重新授权。 */
  onReauthorize: (account: AccountDetail) => void | Promise<void>;
  /** onEdit 打开指定账号的编辑弹窗。 */
  onEdit: (account: AccountDetail) => void | Promise<void>;
  /** onAI 打开指定账号的 AI 客服配置。 */
  onAI: (account: AccountDetail) => void | Promise<void>;
  /** onTasks 打开指定账号的评价与擦亮任务配置。 */
  onTasks: (account: AccountDetail) => void;
  /** onToggle 切换指定账号的启用状态。 */
  onToggle: (id: string, currentStatus: boolean) => void | Promise<void>;
  /** onDelete 打开指定账号的删除确认框。 */
  onDelete: (account: AccountDetail) => void;
}

/** AccountTable 以参考控制台表格展示账号，并保留账号页现有的全部操作入口。 */
const AccountTable: React.FC<AccountTableProps> = ({
  accounts,
  isPending,
  onRefreshProfile,
  onReauthorize,
  onEdit,
  onAI,
  onTasks,
  onToggle,
  onDelete,
}) => (
  <div className="console-table-shell">
    <div className="console-table-wrap">
      <table className="console-table" style={{ minWidth: 1120 }}>
        <thead>
          <tr>
            <th style={{ width: '24%' }}>账号</th>
            <th style={{ width: '12%' }}>启用状态</th>
            <th style={{ width: '18%' }}>自动化</th>
            <th style={{ width: '20%' }}>运行状态</th>
            <th style={{ width: '26%', textAlign: 'right' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map(/* account 是当前需要渲染的账号摘要。 */ account => {
            // runtime 是该账号运行状态的展示文案和颜色。
            const runtime = accountRuntimePresentation(account);
            // requiresLogin 表示该账号必须重新授权或粘贴无风控 Cookie。
            const requiresLogin = account.runtime_state === 'auth_expired' || account.runtime_state === 'verification_required';
            // refreshing 表示该账号昵称头像正在刷新。
            const refreshing = isPending(`refresh:${account.id}`);
            // toggling 表示该账号启用状态正在更新。
            const toggling = isPending(`toggle:${account.id}`);
            // deleting 表示该账号删除流程正在提交。
            const deleting = isPending(`delete:${account.id}`);
            return (
              <tr key={account.id}>
                <td>
                  <div className="flex min-w-0 items-center gap-3">
                    {account.avatar_url ? (
                      <img src={account.avatar_url} alt="" className="h-10 w-10 flex-none rounded-full bg-slate-100 object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-slate-100 text-slate-400">
                        <User className="h-5 w-5" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">{account.nickname || account.remark || `账号 ${account.id.slice(0, 6)}`}</div>
                      <div className="mt-1 truncate text-[11px] text-muted">{account.remark || '暂无备注'}</div>
                      <div className="mt-0.5 select-all truncate font-mono text-[10px] text-slate-400">ID: {account.id}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={`console-switch ${account.enabled ? 'is-on' : ''}`}
                      role="switch"
                      aria-checked={account.enabled}
                      aria-label={`${account.enabled ? '停用' : '启用'}账号 ${account.nickname || account.remark || account.id}`}
                      disabled={toggling || deleting}
                      onClick={/* 用户点击开关时切换账号启用状态。 */ () => void onToggle(account.id, account.enabled)}
                    />
                    <span className={`text-xs font-medium ${account.enabled ? 'text-success-600' : 'text-muted'}`}>
                      {toggling ? '更新中' : account.enabled ? '已启用' : '已停用'}
                    </span>
                  </div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    {account.ai_enabled && <span className="rounded bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-700">AI 客服</span>}
                    {account.auto_confirm && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand">自动发货</span>}
                    {account.auto_rate_enabled && <span className="rounded bg-success-50 px-1.5 py-0.5 text-[10px] font-medium text-success-700">自动评价</span>}
                    {account.auto_polish_enabled && <span className="rounded bg-warning-50 px-1.5 py-0.5 text-[10px] font-medium text-warning-700">每日擦亮</span>}
                    {!account.ai_enabled && !account.auto_confirm && !account.auto_rate_enabled && !account.auto_polish_enabled && <span className="text-xs text-slate-400">未配置</span>}
                  </div>
                </td>
                <td>
                  <div className="flex flex-col gap-1.5">
                    <span className={`w-fit rounded px-2 py-0.5 text-[11px] font-medium ${runtime.badge}`}>{runtime.label}</span>
                    {account.paused && <span className="w-fit rounded bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand">暂停处理中</span>}
                    {account.profile_error && (
                      <span className="flex items-center gap-1 text-[11px] text-warning-700" title={account.profile_error}>
                        <AlertCircle className="h-3 w-3" />资料未同步
                      </span>
                    )}
                    {account.runtime_message && account.runtime_state !== 'online' && account.runtime_state !== 'disabled' && (
                      <span className={`flex items-start gap-1 text-[11px] leading-5 ${requiresLogin ? 'text-danger-700' : 'text-warning-700'}`}>
                        <AlertCircle className="mt-1 h-3 w-3 flex-none" />
                        <span className="line-clamp-2" title={account.runtime_message}>{account.runtime_message}</span>
                      </span>
                    )}
                    {requiresLogin && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="console-link-button"
                          onClick={/* 风控账号打开编辑弹窗粘贴 Cookie，登录失效账号走二维码授权。 */ () => void (account.runtime_state === 'verification_required' ? onEdit(account) : onReauthorize(account))}
                        >
                          {account.runtime_state === 'verification_required'
                            ? <><ClipboardPaste className="mr-1 inline h-3 w-3" />粘贴无风控 Cookie</>
                            : <><QrCode className="mr-1 inline h-3 w-3" />重新授权</>}
                        </button>
                        {account.runtime_state === 'verification_required' && (
                          <a href={RISK_GUIDE_URL} target="_blank" rel="noopener noreferrer" className="console-link-button">操作教程</a>
                        )}
                      </div>
                    )}
                  </div>
                </td>
                <td>
                  <div className="console-row-actions">
                    <button type="button" className="console-link-button" disabled={refreshing || deleting} onClick={/* 刷新当前账号公开资料。 */ () => void onRefreshProfile(account)}>
                      {refreshing ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 inline h-3 w-3" />}
                      {refreshing ? '刷新中' : '刷新资料'}
                    </button>
                    <button type="button" className="console-link-button" disabled={deleting} onClick={/* 打开当前账号二维码重新授权。 */ () => void onReauthorize(account)}>
                      <QrCode className="mr-1 inline h-3 w-3" />重新授权
                    </button>
                    <button type="button" className="console-link-button" disabled={deleting} onClick={/* 打开当前账号编辑弹窗。 */ () => void onEdit(account)}>编辑</button>
                    <button type="button" className="console-link-button" disabled={deleting} onClick={/* 打开当前账号 AI 配置。 */ () => void onAI(account)}>AI</button>
                    <button type="button" className="console-link-button" disabled={deleting} onClick={/* 打开当前账号计划任务配置。 */ () => onTasks(account)}>
                      <CalendarClock className="mr-1 inline h-3 w-3" />任务
                    </button>
                    <button type="button" className="console-link-button is-danger" disabled={deleting} onClick={/* 打开当前账号删除确认框。 */ () => onDelete(account)}>
                      {deleting ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 inline h-3 w-3" />}
                      {deleting ? '删除中' : '删除'}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

export default AccountTable;
