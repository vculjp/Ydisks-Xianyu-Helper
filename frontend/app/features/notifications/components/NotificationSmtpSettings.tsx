import { AlertCircle,Eye,EyeOff,Loader2,Mail,Save } from 'lucide-react';
import React from 'react';
import { AsyncStateView } from '../../../../shared/ui/feedback';
import type { SystemSettings } from '../api';

// NotificationSmtpSettingsProps 描述系统 SMTP 配置面板所需的状态和事件。
export interface NotificationSmtpSettingsProps {
  // smtp 是当前系统 SMTP 配置。
  smtp: SystemSettings;
  // setSmtp 更新 SMTP 配置字段。
  setSmtp: React.Dispatch<React.SetStateAction<SystemSettings>>;
  // loading 表示管理员 SMTP 配置是否正在读取。
  loading: boolean;
  // loadError 保存管理员 SMTP 配置加载失败的可展示文本。
  loadError: string;
  // smtpSaving 表示 SMTP 保存请求是否正在执行。
  smtpSaving: boolean;
  // showPassword 表示是否显示 SMTP 密码明文。
  showPassword: boolean;
  // setShowPassword 切换 SMTP 密码明文显示。
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>;
  // onRetry 重新加载系统 SMTP 配置。
  onRetry: () => void;
  // onSave 保存 SMTP 配置。
  onSave: () => void | Promise<void>;
}

// NotificationSmtpSettings 渲染管理员可见的系统级 SMTP 设置。
export const NotificationSmtpSettings: React.FC<NotificationSmtpSettingsProps> = ({ smtp, setSmtp, loading, loadError, smtpSaving, showPassword, setShowPassword, onRetry, onSave }) => {
  // hasSettings 表示服务端已返回至少一个 SMTP 字段，可保留表单继续编辑。
  const hasSettings = Object.keys(smtp).length > 0;
  // handleTextChange 更新 SMTP 文本字段。
  const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // key 是文本输入框数据属性中的 SMTP 字段名。
    const key = event.currentTarget.dataset.field as 'smtp_server' | 'smtp_user' | 'smtp_from_name' | 'smtp_from_address' | undefined;
    if (!key) return;
    setSmtp(
      // nextSettingsUpdater 使用函数式更新避免覆盖并发输入。
      current => ({ ...current, [key]: event.target.value }),
    );
  };
  // handlePortChange 更新 SMTP 端口并在非法输入时回退默认端口。
  const handlePortChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSmtp(
      // nextSettingsUpdater 使用函数式更新端口字段。
      current => ({ ...current, smtp_port: parseInt(event.target.value, 10) || 587 }),
    );
  };
  // handleTlsChange 切换 STARTTLS 并保持 TLS 与 SSL 互斥。
  const handleTlsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSmtp(
      // nextSettingsUpdater 使用函数式更新 TLS/SSL 互斥字段。
      current => ({ ...current, smtp_use_tls: event.target.checked, smtp_use_ssl: event.target.checked ? false : current.smtp_use_ssl }),
    );
  };
  // handleSslChange 切换直连 SSL 并保持 TLS 与 SSL 互斥。
  const handleSslChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSmtp(
      // nextSettingsUpdater 使用函数式更新 SSL/TLS 互斥字段。
      current => ({ ...current, smtp_use_ssl: event.target.checked, smtp_use_tls: event.target.checked ? false : current.smtp_use_tls }),
    );
  };
  // handlePasswordChange 更新系统 SMTP 密码。
  const handlePasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSmtp(
      // nextSettingsUpdater 使用函数式更新密码字段。
      current => ({ ...current, smtp_password: event.target.value }),
    );
  };
  // handleTogglePassword 切换系统 SMTP 密码明文展示。
  const handleTogglePassword = () => setShowPassword(
    // nextPasswordState 使用函数式更新密码显示状态。
    value => !value,
  );
  // formContent 是 SMTP 配置读取成功或保留已有表单时展示的字段区域。
  const formContent = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-700">SMTP 服务器</label><input data-field="smtp_server" type="text" value={typeof smtp.smtp_server === 'string' ? smtp.smtp_server : ''} onChange={handleTextChange} placeholder="smtp.qq.com" className="ios-input w-full rounded-lg px-3 py-2.5 text-sm" /></div>
        <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-700">SMTP 端口</label><input type="number" value={typeof smtp.smtp_port === 'number' ? smtp.smtp_port : 587} onChange={handlePortChange} placeholder="587" className="ios-input w-full rounded-lg px-3 py-2.5 text-sm" /></div>
      </div>
      <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-700">发件邮箱</label><input data-field="smtp_user" type="email" value={typeof smtp.smtp_user === 'string' ? smtp.smtp_user : ''} onChange={handleTextChange} placeholder="your-email@qq.com" className="ios-input w-full rounded-lg px-3 py-2.5 text-sm" /></div>
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-700">邮箱密码 / 授权码</label>
        <div className="relative">
          <input type={showPassword ? 'text' : 'password'} value={typeof smtp.smtp_password === 'string' ? smtp.smtp_password : ''} onChange={handlePasswordChange} placeholder={smtp.smtp_password_configured ? '已配置，如需替换请输入新密码' : '输入密码或授权码'} className="ios-input w-full rounded-lg px-3 py-2.5 pr-11 text-sm" />
          <button type="button" onClick={handleTogglePassword} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label={showPassword ? '隐藏 SMTP 密码' : '显示 SMTP 密码'}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        </div>
        <p className="text-xs text-slate-500">QQ 邮箱需使用授权码（QQ 邮箱设置 → 账号 → 开启 SMTP → 生成授权码）</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-700">发件人显示名（可选）</label><input data-field="smtp_from_name" type="text" value={typeof smtp.smtp_from_name === 'string' ? smtp.smtp_from_name : ''} onChange={handleTextChange} placeholder="闲鱼自动回复系统" className="ios-input w-full rounded-lg px-3 py-2.5 text-sm" /></div>
        <div className="space-y-1.5"><label className="block text-xs font-semibold text-slate-700">发件邮箱地址</label><input data-field="smtp_from_address" type="email" value={typeof smtp.smtp_from_address === 'string' ? smtp.smtp_from_address : (typeof smtp.smtp_user === 'string' ? smtp.smtp_user : '')} onChange={handleTextChange} placeholder="your-email@qq.com" className="ios-input w-full rounded-lg px-3 py-2.5 text-sm" /></div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-700"><input type="checkbox" checked={smtp.smtp_use_tls !== false} onChange={handleTlsChange} />STARTTLS（常用于 587 端口）</label>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-700"><input type="checkbox" checked={smtp.smtp_use_ssl === true} onChange={handleSslChange} />SSL/TLS 直连（常用于 465 端口）</label>
      </div>
      <button type="button" onClick={onSave} disabled={smtpSaving || loading} aria-busy={smtpSaving} className="ios-btn-primary inline-flex items-center gap-2 disabled:cursor-wait disabled:opacity-60">{smtpSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{smtpSaving ? '保存中...' : '保存 SMTP 配置'}</button>
    </div>
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">SMTP 邮件配置</h2>
          <p className="mt-1 text-xs text-slate-500">系统级邮件发送服务，供邮件通知渠道复用</p>
        </div>
        <span className="rounded-md border border-sky-200 bg-sky-50 p-2 text-sky-700"><Mail className="h-4 w-4" /></span>
      </div>
      {loadError && hasSettings && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{loadError}</span>
          <button type="button" className="ios-btn-secondary" onClick={onRetry}>重新加载</button>
        </div>
      )}
      <AsyncStateView
        loading={loading && !hasSettings}
        error={!hasSettings && loadError ? loadError : undefined}
        empty={false}
        onRetry={onRetry}
        compact
        loadingText="正在读取 SMTP 配置"
      >
        {formContent}
      </AsyncStateView>
    </section>
  );
};
