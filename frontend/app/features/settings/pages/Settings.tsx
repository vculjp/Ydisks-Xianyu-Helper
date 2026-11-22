import {
  AlertCircle,
Check,
ChevronDown,
Database,
Eye,EyeOff,
  Loader2,
LockKeyhole,
RefreshCw,
Save,
ShieldCheck,
Sparkles,
UserRound,
Zap
} from 'lucide-react';
import React from 'react';
import { DEFAULT_AI_API_URL,LOG_LEVELS } from '../constants';
import { useNotificationSoundPreference } from '../../../../shared/browser/notificationSound';
import { useSettings } from '../hooks';
import { AsyncStateView } from '../../../../shared/ui/feedback';
import { PageHeader } from '../../../../shared/ui/PageHeader';

// Settings 展示系统配置、AI 模型和登录凭据编辑页面。
const Settings: React.FC = () => {
  // featureState 是 Settings Hook 提供的状态与动作集合。
  const {
    settings, loading, loadError, hasUnsavedChanges, saving, saveError, aiModels, modelsLoading, modelError, modelDropdownOpen,
    showApiKey, showCaptchaSecret, showCurrentPassword, showNewPassword, credentialsSaving, credentialsMessage,
    credentials, modelPickerRef, loadSettings, loadAIModels, testConnection, connectionTestLoading,
    connectionTestMessage, handleSave, handleRemoteCookieToggle, handleCredentialsSave,
    setSettings, setModelDropdownOpen, setShowApiKey, setShowCaptchaSecret, setShowCurrentPassword,
    setShowNewPassword, setCredentials,
  } = useSettings();
  // notificationSound 保存当前浏览器的新消息提示音偏好，仅存于本机浏览器，不随系统配置保存。
  const notificationSound = useNotificationSoundPreference();

  if (!settings) {
    return (
      <AsyncStateView
        loading={loading}
        error={loadError || undefined}
        empty={!loading && !loadError}
        onRetry={/* 首次读取失败或空配置时允许用户重新请求系统设置。 */ () => void loadSettings()}
        loadingText="正在加载系统配置"
        emptyTitle="暂无系统配置"
        emptyDescription="服务端尚未返回可编辑的系统配置。"
      />
    );
  }

  // currentModel 是当前配置中的模型名称。
  const currentModel = settings.ai_model || '';
  // visibleAIModels 是模型下拉框当前展示的候选列表。
  const visibleAIModels = aiModels;

  return (
    <div className="min-w-0 space-y-6 animate-fade-in">
      <PageHeader title="系统设置" description="配置全局自动化规则与系统参数">
        <div className="flex flex-wrap items-center gap-2">
          {hasUnsavedChanges && <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">有未保存修改</span>}
          <button
            type="button"
            onClick={/* 用户刷新远端配置时由 Hook 检查未保存草稿并请求确认。 */ () => void loadSettings()}
            disabled={loading}
            className="ios-btn-secondary inline-flex items-center gap-2 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </PageHeader>

      {loadError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            刷新远端配置失败：{loadError}
          </span>
          <button type="button" className="ios-btn-secondary" onClick={/* 刷新失败后保留当前草稿并允许重试。 */ () => void loadSettings()}>重新加载</button>
        </div>
      )}

      {saveError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <span>{saveError}</span>
          <button type="button" className="font-bold underline" onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => void handleSave()}>重试保存</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Column */}
        <div className="space-y-8">
          {/* Basic Settings */}
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
                <div className="p-1.5 rounded-lg bg-gray-100 text-gray-600">
                    <Database className="w-4 h-4" />
                </div>
                基础设置
            </h3>

            <div className="ios-card space-y-4 rounded-lg bg-white p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="block text-sm font-bold text-gray-800">日志输出等级</label>
                  <select
                    value={settings.log_level || 'info'}
                    onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setSettings({ ...settings, log_level: event.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  >
                    {LOG_LEVELS.map(/* 当前回调处理集合中的单个元素。 */ level => (
                      <option key={level.value} value={level.value}>{level.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500">等级越低输出越详细，Debug 适合排查问题</p>
                </div>
                <div className="space-y-3">
                  <label className="block text-sm font-bold text-gray-800">日志输出格式</label>
                  <select
                    value={settings.log_format || 'text'}
                    onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setSettings({ ...settings, log_format: event.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  >
                    <option value="text">Text</option>
                    <option value="json">JSON</option>
                  </select>
                  <p className="text-xs text-gray-500">JSON 适合接入集中式日志系统，保存后需重启服务生效</p>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-bold text-gray-800">续期日志保留天数</label>
                <input
                  type="number"
                  value={settings.renewal_log_retention_days ?? 10}
                  onChange={/* 当前回调处理用户交互或异步状态变化。 */ (e) => setSettings({ ...settings, renewal_log_retention_days: parseInt(e.target.value) || 0 })}
                  className="w-full ios-input px-4 py-3 rounded-xl"
                  min="0"
                  max="365"
                />
                <p className="text-xs text-gray-500">0 表示不自动清理续期日志</p>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 cursor-pointer">
                <input type="checkbox" className="mt-1" aria-label="新消息提示音" checked={notificationSound.enabled} onChange={/* 当前回调写入本机提示音偏好，开启时试听。 */ event => notificationSound.setEnabled(event.target.checked)} />
                <span>
                  <span className="block text-sm font-bold text-gray-800">新消息浏览器通知提示音</span>
                  <span className="mt-1 block text-xs leading-5 text-gray-500">收到买家新消息并弹出浏览器通知时播放默认提示音。仅对当前浏览器生效，需要先在在线聊天页开启浏览器提醒；浏览器可能要求页面至少交互过一次才允许发声。</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={settings.outbound_http_public_only || false} onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setSettings({ ...settings, outbound_http_public_only: event.target.checked })} />
                <span>
                  <span className="block text-sm font-bold text-amber-900">限制用户配置的 HTTP 出站请求只能访问公网</span>
                  <span className="mt-1 block text-xs leading-5 text-amber-800">开启后会同时约束 API 发货、AI、HTTP 通知、远程图片和远程滑块服务；保存后立即生效，可能使内网服务不可用。</span>
                </span>
              </label>
            </div>
          </section>

          {/* AI Configuration */}
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
                <div className="p-1.5 rounded-lg bg-brand text-white">
                    <Sparkles className="w-4 h-4" />
                </div>
                AI 智能回复配置
            </h3>

            <div className="ios-card space-y-5 rounded-lg bg-white p-5">
              <div className="space-y-3">
                <label className="block text-sm font-bold text-gray-800">API 地址</label>
                <input
                  type="text"
                  value={settings.ai_api_url || DEFAULT_AI_API_URL}
                  onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setSettings({...settings, ai_api_url: e.target.value})}
                  className="w-full ios-input px-4 py-3 rounded-xl text-sm"
                  placeholder="https://api.openai.com/v1"
                />
                <p className="text-xs text-gray-500">无需补全 /chat/completions</p>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-bold text-gray-800">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={settings.ai_api_key || ''}
                    onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => setSettings({...settings, ai_api_key: e.target.value})}
                    className="w-full ios-input px-4 py-3 pr-12 rounded-xl font-mono text-sm"
                    placeholder={settings.ai_api_key_configured ? '已配置，如需替换请输入新密钥' : 'sk-...'}
                  />
                  <button
                    type="button"
                    onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  {settings.ai_api_key_configured ? '密钥已安全保存到系统，留空会保留原密钥；仅更换时需填写新密钥并保存。' : '首次填写密钥后点击保存配置，之后无需重复输入。'}
                </p>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-bold text-gray-800">模型</label>
                <div ref={modelPickerRef} className="relative flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <input
                      value={currentModel}
                      onFocus={/* 当前回调处理用户交互或异步状态变化。 */ () => aiModels.length > 0 && setModelDropdownOpen(true)}
                      onChange={/* 当前回调处理用户交互或异步状态变化。 */ e => {
                        setSettings({...settings, ai_model: e.target.value});
                        if (aiModels.length > 0) setModelDropdownOpen(true);
                      }}
                      onKeyDown={/* 当前回调处理用户交互或异步状态变化。 */ e => {
                        if (e.key === 'Escape') setModelDropdownOpen(false);
                        if (e.key === 'ArrowDown' && aiModels.length > 0) setModelDropdownOpen(true);
                      }}
                      className="w-full ios-input px-4 py-3 pr-10 rounded-xl"
                      placeholder="从接口读取或手动输入模型名"
                    />
                    <button
                      type="button"
                      onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => aiModels.length > 0 && setModelDropdownOpen(/* 当前回调处理用户交互或异步状态变化。 */ open => !open)}
                      disabled={aiModels.length === 0}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      aria-label="展开模型列表"
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {modelDropdownOpen && (
                      <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                        {visibleAIModels.length > 0 ? (
                          visibleAIModels.map(/* 当前回调处理集合中的单个元素。 */ model => (
                            <button
                              key={model}
                              type="button"
                              onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => {
                                setSettings({...settings, ai_model: model});
                                setModelDropdownOpen(false);
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-brand flex items-center justify-between gap-3"
                            >
                              <span className="truncate">{model}</span>
                              {model === currentModel && <Check className="w-4 h-4 shrink-0 text-brand" />}
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-gray-400">没有匹配的模型</div>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => loadAIModels(undefined, true)}
                    disabled={modelsLoading}
                    className="px-4 py-3 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60 font-bold flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-4 h-4 ${modelsLoading ? 'animate-spin' : ''}`} />
                    读取模型
                  </button>
                  <button
                    type="button"
                    onClick={testConnection}
                    disabled={connectionTestLoading}
                    className="px-4 py-3 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60 font-bold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <Zap className={`w-4 h-4 ${connectionTestLoading ? 'animate-spin' : ''}`} />
                    测试连接
                  </button>
                </div>
                {modelError ? (
                  <p className="text-xs text-red-500">{modelError}</p>
                ) : (
                  <p className="text-xs text-gray-500">
                    {aiModels.length > 0 ? `已从当前 API 地址读取到 ${aiModels.length} 个模型` : '模型列表从当前 API 地址读取，也可以手动输入模型名'}
                  </p>
                )}
                {connectionTestMessage && (
                  <div className={`rounded-lg px-3 py-2 text-xs font-medium ${connectionTestMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                    {connectionTestMessage.type === 'success' ? '✓ ' : '✗ '}{connectionTestMessage.text}
                  </div>
                )}
              </div>

              <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
                <strong>常见 AI 服务:</strong>
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  <li>阿里云通义千问: https://dashscope.aliyuncs.com/compatible-mode/v1</li>
                  <li>OpenAI: https://api.openai.com/v1</li>
                </ul>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="space-y-8">
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
              <div className="p-1.5 rounded-lg bg-amber-500 text-white">
                <ShieldCheck className="w-4 h-4" />
              </div>
              远程过滑块配置
            </h3>

            <div className="ios-card space-y-4 rounded-lg bg-white p-5">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-800">服务地址</label>
                <input
                  type="url"
                  value={settings['captcha.remote_service_url'] || ''}
                  onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setSettings({...settings, 'captcha.remote_service_url': event.target.value})}
                  className="w-full ios-input px-4 py-3 rounded-xl text-sm"
                  placeholder="https://example.com/internal/captcha/solve"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-800">服务秘钥</label>
                <div className="relative">
                  <input
                    type={showCaptchaSecret ? 'text' : 'password'}
                    value={settings['captcha.remote_secret_key'] || ''}
                    onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setSettings({...settings, 'captcha.remote_secret_key': event.target.value})}
                    className="w-full ios-input px-4 py-3 pr-12 rounded-xl font-mono text-sm"
                    autoComplete="off"
                    placeholder={settings['captcha.remote_secret_key_configured'] ? '已配置，如需替换请输入新密钥' : '请输入服务秘钥'}
                  />
                  <button
                    type="button"
                    onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setShowCaptchaSecret(!showCaptchaSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600"
                    title={showCaptchaSecret ? '隐藏秘钥' : '显示秘钥'}
                  >
                    {showCaptchaSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={String(settings['captcha.remote_pass_cookies'] || '').toLowerCase() === 'true'}
                  onChange={/* 切换远程 Cookie 传递前由 Hook 弹出危险确认。 */ event => void handleRemoteCookieToggle(event.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300"
                />
                <span>
                  <span className="block text-sm font-bold text-amber-900">允许向远程服务传递账号 Cookie</span>
                  <span className="block mt-1 text-xs text-amber-700">默认关闭。仅在信任远程服务且需要由其自动重取过期验证链接时开启。</span>
                </span>
              </label>

              <p className="text-xs text-gray-500">
                配置地址和秘钥后优先调用远程服务；只有网络不可用或超时才回退本机引擎，远程明确返回失败时不会重复触发本机验证。
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
              <div className="p-1.5 rounded-lg bg-gray-900 text-white">
                <LockKeyhole className="w-4 h-4" />
              </div>
              登录凭据
            </h3>

            <form onSubmit={handleCredentialsSave} className="ios-card space-y-4 rounded-lg bg-white p-5">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-800">登录用户名</label>
                <div className="relative">
                  <UserRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={credentials.new_username}
                    onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setCredentials({...credentials, new_username: event.target.value})}
                    className="w-full ios-input pl-11 pr-4 py-3 rounded-xl text-sm"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-800">当前密码</label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={credentials.current_password}
                    onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setCredentials({...credentials, current_password: event.target.value})}
                    className="w-full ios-input px-4 py-3 pr-12 rounded-xl text-sm"
                    placeholder="用于确认当前身份"
                    autoComplete="current-password"
                  />
                  <button type="button" onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setShowCurrentPassword(!showCurrentPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600" title={showCurrentPassword ? '隐藏密码' : '显示密码'}>
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-800">新密码</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={credentials.new_password}
                      onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setCredentials({...credentials, new_password: event.target.value})}
                      className="w-full ios-input px-4 py-3 pr-11 rounded-xl text-sm"
                      placeholder="不修改则留空"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setShowNewPassword(!showNewPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600" title={showNewPassword ? '隐藏密码' : '显示密码'}>
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-800">确认新密码</label>
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={credentials.confirm_password}
                    onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setCredentials({...credentials, confirm_password: event.target.value})}
                    className="w-full ios-input px-4 py-3 rounded-xl text-sm"
                    placeholder="再次输入新密码"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              {credentialsMessage && (
                <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${credentialsMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{credentialsMessage.text}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={credentialsSaving || !credentials.new_username || !credentials.current_password}
                className="w-full bg-gray-900 hover:bg-black text-white px-5 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
              >
                <LockKeyhole className="w-4 h-4" />
                {credentialsSaving ? '正在更新...' : '更新登录凭据'}
              </button>
            </form>
          </section>

          {/* SMTP 配置已移至「通知设置」页面 */}
        </div>
      </div>

      {/* Save Button */}
      <div
        className="fixed z-30"
        style={/* 固定保存按钮避开移动端底部安全区和右侧手势区。 */ {
          bottom: 'calc(1.25rem + env(safe-area-inset-bottom))',
          right: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <button
            type="button"
            onClick={/* 提交当前系统配置草稿并触发确认及全局提示。 */ () => void handleSave()}
            disabled={saving}
            aria-busy={saving}
            className="ios-btn-primary inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm shadow-lg disabled:cursor-wait disabled:opacity-70"
        >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? '保存中...' : '保存所有配置'}
        </button>
      </div>
    </div>
  );
};

export default Settings;
