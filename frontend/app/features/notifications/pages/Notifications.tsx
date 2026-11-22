import { AlertCircle,Bell,Loader2,Plus,RefreshCw } from 'lucide-react';
import React from 'react';
import { AsyncStateView } from '../../../../shared/ui/feedback';
import { PageHeader } from '../../../../shared/ui/PageHeader';
import { NotificationChannelList } from '../components/NotificationChannelList';
import { NotificationChannelModal } from '../components/NotificationChannelModal';
import { NotificationSmtpSettings } from '../components/NotificationSmtpSettings';
import { useNotifications } from '../hooks';

// NotificationsProps 描述通知页面接收的权限上下文。
interface NotificationsProps {
  // isAdmin 表示当前用户是否可以查看和保存系统 SMTP 配置。
  isAdmin?: boolean;
}

// Notifications 渲染通知渠道列表、SMTP 配置和渠道编辑边界。
const Notifications: React.FC<NotificationsProps> = ({ isAdmin = false }) => {
  // notificationState 统一提供通知页面的数据、表单和异步动作。
  const notificationState = useNotifications(isAdmin);
  // hasLoadedChannels 表示页面已经有可保留的渠道数据，刷新失败时不应清空列表。
  const hasLoadedChannels = notificationState.channels.length > 0;

  return (
    <div className="min-w-0 space-y-6 animate-fade-in">
      <PageHeader title="通知设置" description="配置通知渠道，账号异常时主动推送告警">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={/* 用户点击刷新时重新读取渠道列表。 */ () => void notificationState.loadChannels()}
            disabled={notificationState.loading}
            className="ios-btn-secondary inline-flex items-center gap-2 disabled:cursor-wait disabled:opacity-60"
          >
            {notificationState.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </button>
          <button type="button" onClick={notificationState.openCreate} className="ios-btn-primary inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            新建渠道
          </button>
        </div>
      </PageHeader>

      <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-start gap-3">
          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <div className="text-sm leading-6 text-slate-700">
            配置通知渠道并在「账号管理 → 编辑」里绑定后，以下事件会主动推送到该账号绑定的渠道；自动化任务通知已拆分为四类，可按需单独关闭：
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              <li>拍下改价、付款发货、评价赠品、求评价：分别控制对应自动化任务结果</li>
              <li>账号 session 失效 / 自动恢复失败：账号状态告警</li>
              <li>触发风控验证：可能需要扫码完成验证</li>
            </ul>
          </div>
        </div>
      </section>

      {notificationState.loadError && hasLoadedChannels && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {notificationState.loadError}
          </span>
          <button type="button" className="ios-btn-secondary" onClick={/* 刷新失败后保留现有列表并允许重试。 */ () => void notificationState.loadChannels()}>
            重试
          </button>
        </div>
      )}

      <AsyncStateView
        loading={notificationState.loading && !hasLoadedChannels}
        error={!hasLoadedChannels && notificationState.loadError ? notificationState.loadError : undefined}
        empty={!notificationState.loading && !notificationState.loadError && !hasLoadedChannels}
        onRetry={/* 首次加载失败时由统一状态组件触发重试。 */ () => void notificationState.loadChannels()}
        loadingText="正在加载通知渠道"
        emptyTitle="还没有配置任何通知渠道"
        emptyDescription="点击右上角「新建渠道」开始配置。"
      >
        <NotificationChannelList
          channels={notificationState.channels}
          testingId={notificationState.testingId}
          isActionPending={notificationState.isActionPending}
          onEdit={notificationState.openEdit}
          onDelete={notificationState.handleDelete}
          onToggleEnabled={notificationState.handleToggleEnabled}
          onTest={notificationState.handleTest}
        />
      </AsyncStateView>

      {isAdmin && (
        <NotificationSmtpSettings
          smtp={notificationState.smtp}
          setSmtp={notificationState.setSmtp}
          loading={notificationState.smtpLoading}
          loadError={notificationState.smtpLoadError}
          smtpSaving={notificationState.smtpSaving}
          showPassword={notificationState.showSmtpPassword}
          setShowPassword={notificationState.setShowSmtpPassword}
          onRetry={/* SMTP 面板独立重试，不影响已加载的渠道列表。 */ () => void notificationState.loadSmtp()}
          onSave={notificationState.handleSaveSmtp}
        />
      )}

      <NotificationChannelModal
        showModal={notificationState.showModal}
        editing={notificationState.editing}
        form={notificationState.form}
        setForm={notificationState.setForm}
        smtp={notificationState.smtp}
        showChannelSmtpPassword={notificationState.showChannelSmtpPassword}
        setShowChannelSmtpPassword={notificationState.setShowChannelSmtpPassword}
        saving={notificationState.saving}
        onClose={notificationState.closeModal}
        onSave={notificationState.handleSave}
      />
    </div>
  );
};

export default Notifications;
