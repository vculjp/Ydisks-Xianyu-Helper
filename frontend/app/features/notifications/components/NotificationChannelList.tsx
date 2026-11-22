import { Edit2,Loader2,Send,Trash2 } from 'lucide-react';
import React from 'react';
import type { NotificationChannel } from '../api';
import { notificationChannelTypes,notificationEventSummary } from '../state';
import type { NotificationAction } from '../types';

// NotificationChannelListProps 描述通知渠道列表的操作边界。
export interface NotificationChannelListProps {
  // channels 是当前可展示的通知渠道。
  channels: NotificationChannel[];
  // testingId 是当前正在测试发送的渠道 ID。
  testingId: string;
  // isActionPending 判断渠道动作是否仍在执行，用于单项禁用和防重复提交。
  isActionPending: (channelId: string, action: NotificationAction) => boolean;
  // onEdit 打开指定渠道的编辑弹窗。
  onEdit: (channel: NotificationChannel) => void;
  // onDelete 删除指定渠道。
  onDelete: (channel: NotificationChannel) => void | Promise<void>;
  // onToggleEnabled 切换指定渠道的启用状态。
  onToggleEnabled: (channel: NotificationChannel) => void | Promise<void>;
  // onTest 发送指定渠道的测试通知。
  onTest: (channel: NotificationChannel) => void | Promise<void>;
}

// NotificationChannelList 渲染渠道摘要、启用状态和操作按钮。
export const NotificationChannelList: React.FC<NotificationChannelListProps> = ({ channels, testingId, isActionPending, onEdit, onDelete, onToggleEnabled, onTest }) => {
  // findChannel 从按钮数据属性中查找对应渠道。
  const findChannel = (event: React.MouseEvent<HTMLButtonElement>): NotificationChannel | null => channels.find(
    // channel 是当前待匹配的渠道数据。
    channel => channel.id === event.currentTarget.dataset.channelId,
  ) || null;
  // handleToggleClick 处理渠道启用状态按钮点击。
  const handleToggleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // channel 是按钮对应的渠道数据。
    const channel = findChannel(event);
    if (channel) void onToggleEnabled(channel);
  };
  // handleTestClick 处理渠道测试按钮点击。
  const handleTestClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // channel 是按钮对应的渠道数据。
    const channel = findChannel(event);
    if (channel) void onTest(channel);
  };
  // handleEditClick 处理渠道编辑按钮点击。
  const handleEditClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // channel 是按钮对应的渠道数据。
    const channel = findChannel(event);
    if (channel) onEdit(channel);
  };
  // handleDeleteClick 处理渠道删除按钮点击。
  const handleDeleteClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // channel 是按钮对应的渠道数据。
    const channel = findChannel(event);
    if (channel) void onDelete(channel);
  };
  // renderChannel 渲染单个通知渠道行。
  const renderChannel = (channel: NotificationChannel) => {
    // meta 是当前渠道类型的静态展示配置。
    const meta = notificationChannelTypes[channel.type] || notificationChannelTypes.webhook;
    // Icon 是当前渠道类型对应的图标组件。
    const Icon = meta.icon;
    // togglePending 表示当前渠道启用状态正在提交。
    const togglePending = isActionPending(channel.id, 'toggle');
    // deletePending 表示当前渠道删除确认或删除请求正在执行。
    const deletePending = isActionPending(channel.id, 'delete');
    // testPending 表示当前渠道测试通知正在发送。
    const testPending = testingId === channel.id || isActionPending(channel.id, 'test');
    // mutationPending 表示当前渠道存在会改变服务端状态的动作，避免并发冲突。
    const mutationPending = togglePending || deletePending;
    return (
      <article key={channel.id} className="flex min-w-0 flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
            <Icon className="h-4 w-4 text-slate-600" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-900">{channel.name}</span>
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">{meta.label}</span>
              {!channel.enabled && <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">已停用</span>}
            </div>
            <div className="mt-1 truncate text-xs text-slate-500">
              {meta.fields.map(
                // field 是当前渠道摘要需要读取的配置字段。
                field => channel.config?.[field.key],
              ).filter(Boolean).map(
                // value 是渠道配置中非空的摘要值。
                (value, index) => <span key={index} className="mr-3">{String(value).length > 40 ? `${String(value).slice(0, 40)}…` : String(value)}</span>,
              )}
            </div>
            <div className="mt-1 truncate text-xs text-slate-400">订阅：{notificationEventSummary(channel.event_types)}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            data-channel-id={channel.id}
            onClick={handleToggleClick}
            disabled={mutationPending}
            aria-busy={togglePending}
            className={`inline-flex min-w-16 items-center justify-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${channel.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
          >
            {togglePending && <Loader2 className="h-3 w-3 animate-spin" />}
            {channel.enabled ? '启用中' : '已停用'}
          </button>
          <button
            type="button"
            data-channel-id={channel.id}
            onClick={handleTestClick}
            disabled={testPending || deletePending}
            aria-busy={testPending}
            className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-wait disabled:opacity-60"
          >
            {testPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            测试
          </button>
          <button
            type="button"
            data-channel-id={channel.id}
            onClick={handleEditClick}
            disabled={mutationPending}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
            title="编辑"
            aria-label={`编辑 ${channel.name}`}
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-channel-id={channel.id}
            onClick={handleDeleteClick}
            disabled={mutationPending}
            aria-busy={deletePending}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
            title="删除"
            aria-label={`删除 ${channel.name}`}
          >
            {deletePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </article>
    );
  };

  if (channels.length === 0) return null;
  return <div className="space-y-2">{channels.map(renderChannel)}</div>;
};
