import type React from 'react';
import { useCallback,useEffect,useRef,useState } from 'react';
import { confirmAction,notify } from '../../../shared/ui/feedback';
import type { SystemSettings } from './api';
import { fetchAIModels,getSystemSettings,testAIConnection,updateLoginCredentials,updateSystemSettings,verifySession } from './api';
import { DEFAULT_AI_API_URL } from './constants';
import { buildPersistableSettings,createCredentials,createCredentialsMessage,isCurrentAIConnectionTest,isCurrentSettingsRequest,isSettingsAbortError,settingsErrorMessage,validateCredentials } from './state';
import type { ConnectionTestMessage,CredentialsForm,CredentialsMessage,SettingsFeatureState,SettingsRequestStatus } from './types';

/** Settings feature 的 Hook 返回值。 */
export type UseSettingsResult = SettingsFeatureState & {
  /** 模型选择器 DOM 引用。 */
  modelPickerRef: React.RefObject<HTMLDivElement | null>;
  /** 重新加载系统配置；存在未保存草稿时会先请求用户确认。 */
  loadSettings: () => Promise<void>;
  /** 加载模型列表。 */
  loadAIModels: (source?: SystemSettings | null, openAfterLoad?: boolean) => void;
  /** 测试 AI 连接。 */
  testConnection: () => Promise<void>;
  /** 保存系统配置。 */
  handleSave: () => Promise<void>;
  /** 切换远程 Cookie 传递开关；变更前后均需要显式确认。 */
  handleRemoteCookieToggle: (enabled: boolean) => Promise<void>;
  /** 保存登录凭据。 */
  handleCredentialsSave: (event: React.FormEvent) => Promise<void>;
  /** 更新配置草稿并标记未保存状态。 */
  setSettings: React.Dispatch<React.SetStateAction<SystemSettings | null>>;
  /** 更新模型下拉框状态。 */
  setModelDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** 更新敏感字段显示状态。 */
  setShowApiKey: React.Dispatch<React.SetStateAction<boolean>>;
  /** 更新远程秘钥显示状态。 */
  setShowCaptchaSecret: React.Dispatch<React.SetStateAction<boolean>>;
  /** 更新当前密码显示状态。 */
  setShowCurrentPassword: React.Dispatch<React.SetStateAction<boolean>>;
  /** 更新新密码显示状态。 */
  setShowNewPassword: React.Dispatch<React.SetStateAction<boolean>>;
  /** 更新凭据表单。 */
  setCredentials: React.Dispatch<React.SetStateAction<CredentialsForm>>;
  /** 更新凭据提示。 */
  setCredentialsMessage: React.Dispatch<React.SetStateAction<CredentialsMessage>>;
};

/** 管理系统设置、AI 模型和登录凭据的请求与表单状态。 */
export const useSettings = (): UseSettingsResult => {
  // settings 保存当前系统配置草稿。
  const [settings, setSettingsState] = useState<SystemSettings | null>(null);
  // loading 表示系统配置是否正在加载。
  const [loading, setLoading] = useState(false);
  // loadError 保存系统配置加载失败信息。
  const [loadError, setLoadError] = useState('');
  // hasUnsavedChanges 表示用户是否编辑了尚未保存的系统配置。
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // saving 表示系统配置是否正在保存。
  const [saving, setSaving] = useState(false);
  // saveError 保存系统配置保存失败信息。
  const [saveError, setSaveError] = useState('');
  // aiModels 保存远端模型发现结果。
  const [aiModels, setAiModels] = useState<string[]>([]);
  // modelsLoading 表示模型发现请求是否进行中。
  const [modelsLoading, setModelsLoading] = useState(false);
  // modelError 保存模型发现失败信息。
  const [modelError, setModelError] = useState('');
  // modelDropdownOpen 表示模型选择下拉框是否展开。
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  // showApiKey 控制 AI API Key 是否明文显示。
  const [showApiKey, setShowApiKey] = useState(false);
  // showCaptchaSecret 控制远程验证秘钥是否明文显示。
  const [showCaptchaSecret, setShowCaptchaSecret] = useState(false);
  // showCurrentPassword 控制当前密码是否明文显示。
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  // showNewPassword 控制新密码是否明文显示。
  const [showNewPassword, setShowNewPassword] = useState(false);
  // credentialsSaving 表示登录凭据是否正在保存。
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  // credentialsMessage 保存登录凭据操作提示。
  const [credentialsMessage, setCredentialsMessage] = useState<CredentialsMessage>(null);
  // credentials 保存登录凭据编辑草稿。
  const [credentials, setCredentials] = useState<CredentialsForm>(/* 当前回调创建登录凭据初始表单。 */ () => createCredentials());
  // requestStatus 表示最近一次设置请求的阶段。
  const [requestStatus, setRequestStatus] = useState<SettingsRequestStatus>('idle');
  // connectionTestLoading 表示 AI 连接测试是否进行中。
  const [connectionTestLoading, setConnectionTestLoading] = useState(false);
  // connectionTestMessage 保存 AI 连接测试结果提示。
  const [connectionTestMessage, setConnectionTestMessage] = useState<ConnectionTestMessage>(null);
  // modelPickerRef 指向模型选择器根节点。
  const modelPickerRef = useRef<HTMLDivElement>(null);
  // settingsRef 保存最新配置供稳定回调读取。
  const settingsRef = useRef<SystemSettings | null>(null);
  // dirtyRef 保存同步未保存标记，防止在 React 状态刷新前误覆盖草稿。
  const dirtyRef = useRef(false);
  // savingRef 保存系统配置保存的同步请求锁，阻止同一渲染帧内重复提交。
  const savingRef = useRef(false);
  // credentialsSavingRef 保存登录凭据保存的同步请求锁。
  const credentialsSavingRef = useRef(false);
  // modelsLoadingRef 保存模型发现的同步请求锁。
  const modelsLoadingRef = useRef(false);
  // connectionTestLoadingRef 保存连接测试的同步请求锁。
  const connectionTestLoadingRef = useRef(false);
  // requestSequence 隔离刷新产生的旧响应。
  const requestSequence = useRef(0);
  // requestController 保存当前可取消的设置请求。
  const requestController = useRef<AbortController | null>(null);
  // credentialsRequestSequence 隔离登录凭据保存的旧响应，不与设置加载或保存共用代次。
  const credentialsRequestSequence = useRef(0);
  // credentialsRequestController 保存当前可取消的登录凭据保存请求。
  const credentialsRequestController = useRef<AbortController | null>(null);
  // modelRequestSequence 隔离模型发现的旧响应，防止其覆盖新配置对应的列表。
  const modelRequestSequence = useRef(0);
  // modelRequestController 保存当前模型发现请求的专属取消控制器。
  const modelRequestController = useRef<AbortController | null>(null);
  // testRequestSequence 隔离连接测试的旧响应。
  const testRequestSequence = useRef(0);
  // testRequestController 保存当前连接测试请求的取消控制器。
  const testRequestController = useRef<AbortController | null>(null);

  // settingsRef 保存最新配置，供稳定的模型加载回调读取。
  settingsRef.current = settings;

  // markDirty 同步更新草稿标记和页面提示，确保刷新守卫不依赖尚未提交的 React 状态。
  const markDirty = useCallback(
    // next 表示当前草稿是否包含尚未保存的用户修改。
    (next: boolean): void => {
      dirtyRef.current = next;
      setHasUnsavedChanges(next);
    },
    [],
  );

  // updateSettingsDraft 更新页面表单并标记为未保存；自动模型回填不应调用该函数。
  const updateSettingsDraft = useCallback(
    // action 是 React 状态更新动作，既可以是新草稿也可以是基于旧草稿的更新函数。
    (action: React.SetStateAction<SystemSettings | null>): void => {
      setSettingsState(action);
      markDirty(true);
    },
    [markDirty],
  );

  /** 取消当前设置请求并创建新的请求控制器。 */
  const beginRequest = useCallback(/* 当前回调封装设置读取和保存共用的取消代次。 */ () => {
    // controller 是本次请求的取消控制器。
    requestController.current?.abort();
    // controller 请求取消控制器。
    const controller = new AbortController();
    requestController.current = controller;
    requestSequence.current += 1;
    return { controller, sequence: requestSequence.current };
  }, []);

  /** 取消旧的登录凭据保存请求并创建独立的当前请求。 */
  const beginCredentialsRequest = useCallback(/* 当前回调隔离登录凭据保存的取消和晚到响应。 */ () => {
    credentialsRequestController.current?.abort();
    // controller 是本次登录凭据保存的取消控制器。
    const controller = new AbortController();
    credentialsRequestController.current = controller;
    credentialsRequestSequence.current += 1;
    return { controller, sequence: credentialsRequestSequence.current };
  }, []);

  /** 取消旧模型发现并创建当前唯一有效的模型发现请求。 */
  const beginModelRequest = useCallback(/* 当前回调封装模型发现独立代次和取消生命周期。 */ () => {
    modelRequestController.current?.abort();
    // controller 保存本次模型发现请求的独立取消控制器。
    const controller = new AbortController();
    modelRequestController.current = controller;
    modelRequestSequence.current += 1;
    return { controller, sequence: modelRequestSequence.current };
  }, []);

  /** 使当前模型发现请求失效并停止其网络活动。 */
  const cancelModelRequest = useCallback(/* 当前回调用于设置刷新和组件卸载时终止旧模型请求。 */ () => {
    modelRequestSequence.current += 1;
    modelRequestController.current?.abort();
    modelRequestController.current = null;
    modelsLoadingRef.current = false;
  }, []);

  // loadAIModels 读取当前配置对应服务的模型列表，并避免重复发现请求。
  const loadAIModels = useCallback(
    // source 是可选配置快照；openAfterLoad 指定成功后是否展开下拉列表。
    async (source?: SystemSettings | null, openAfterLoad = false) => {
      if (modelsLoadingRef.current) return;
      // current 是本次模型发现使用的配置快照。
      const current = source || settingsRef.current;
      // baseUrl 是兼容模型发现接口的服务地址。
      const baseUrl = current?.ai_api_url || current?.ai_base_url || DEFAULT_AI_API_URL;
      // request 保存本次模型发现独立的代次和取消控制器。
      const request = beginModelRequest();
      modelsLoadingRef.current = true;
      setModelsLoading(true);
      setModelError('');
      try {
        // models 模型列表。
        const models = await fetchAIModels(baseUrl, current?.ai_api_key || '', { signal: request.controller.signal });
        if (!isCurrentSettingsRequest(modelRequestSequence.current, request.sequence, request.controller.signal)) return;
        setAiModels(models);
        setModelDropdownOpen(openAfterLoad && models.length > 0);
        if (!current?.ai_model && models.length > 0) {
          setSettingsState(
            // previous 是自动回填前的配置草稿；自动选择不视为用户编辑。
            previous => previous ? { ...previous, ai_model: models[0] } : previous,
          );
        }
      } catch (/* error 保存模型发现请求的失败原因；取消请求不会进入页面错误状态。 */ error) {
        if (!isCurrentSettingsRequest(modelRequestSequence.current, request.sequence, request.controller.signal) || isSettingsAbortError(error)) return;
        setAiModels([]);
        setModelDropdownOpen(false);
        setModelError(settingsErrorMessage(error, '读取模型失败'));
      } finally {
        if (isCurrentSettingsRequest(modelRequestSequence.current, request.sequence, request.controller.signal)) {
          modelsLoadingRef.current = false;
          setModelsLoading(false);
        }
      }
    },
    [beginModelRequest],
  );

  // testConnection 发送一次最小对话请求验证 AI API 可用性。
  const testConnection = useCallback(
    // 当前回调由用户点击触发，使用取消器与配置快照拒绝旧测试结果。
    async () => {
      // current 是用户点击按钮时的配置草稿，后续响应必须与其保持一致才可显示。
      const current = settingsRef.current;
      if (!current || connectionTestLoadingRef.current) return;
      // baseUrl 是本次连接测试使用的服务端点。
      const baseUrl = current.ai_api_url || current.ai_base_url || DEFAULT_AI_API_URL;
      // apiKey 是本次连接测试使用的临时或已保存 API Key；它只进入请求作用域。
      const apiKey = current.ai_api_key || '';
      // model 是本次连接测试使用的模型名称，空值交由服务端回退默认模型。
      const model = current.ai_model || '';
      // snapshot 绑定本次连接测试的端点、密钥和模型，避免编辑后仍展示旧配置结果。
      const snapshot = { baseURL: baseUrl, apiKey, model };
      testRequestController.current?.abort();
      // controller 只管理本次连接测试，组件卸载或后续测试会取消它。
      const controller = new AbortController();
      testRequestController.current = controller;
      testRequestSequence.current += 1;
      // sequence 隔离连续点击或卸载后的旧响应。
      const sequence = testRequestSequence.current;
      connectionTestLoadingRef.current = true;
      setConnectionTestLoading(true);
      setConnectionTestMessage(null);
      try {
        // result 是服务端确认实际完成一次 chat completion 后返回的诊断摘要。
        const result = await testAIConnection(baseUrl, apiKey, model, { signal: controller.signal });
        if (testRequestSequence.current !== sequence || !isCurrentAIConnectionTest(settingsRef.current, snapshot, DEFAULT_AI_API_URL)) return;
        setConnectionTestMessage({ type: 'success', text: `连接正常 · 模型 ${result.model} · 耗时 ${(result.latency_ms / 1000).toFixed(1)}s · 回复：${result.reply}` });
      } catch (/* error 是连接测试的上游、网络或取消错误；过期和主动取消请求不展示提示。 */ error) {
        if (testRequestSequence.current !== sequence || isSettingsAbortError(error)) return;
        setConnectionTestMessage({ type: 'error', text: settingsErrorMessage(error, '连接失败') });
      } finally {
        if (testRequestSequence.current === sequence) {
          connectionTestLoadingRef.current = false;
          setConnectionTestLoading(false);
        }
      }
    },
    [],
  );

  // loadSettingsInternal 执行远端配置读取；用户主动刷新时先保护未保存草稿。
  const loadSettingsInternal = useCallback(
    // force 为真表示组件首次加载，不提示覆盖；为假表示用户刷新。
    async (force: boolean): Promise<void> => {
      if (!force && dirtyRef.current) {
        // confirmed 表示用户是否同意放弃当前未保存草稿并读取远端配置。
        const confirmed = await confirmAction({
          title: '覆盖未保存的修改？',
          message: '刷新会使用服务端最新配置覆盖当前尚未保存的修改。',
          confirmText: '放弃并刷新',
          danger: true,
        });
        if (!confirmed) return;
      }
      // request 是本次设置读取的代次与控制器。
      const { controller, sequence } = beginRequest();
      // testSequence 使重新读取设置前尚未完成的连接测试结果失效。
      testRequestSequence.current += 1;
      testRequestController.current?.abort();
      testRequestController.current = null;
      connectionTestLoadingRef.current = false;
      setConnectionTestLoading(false);
      setConnectionTestMessage(null);
      cancelModelRequest();
      setModelsLoading(false);
      setLoading(true);
      setRequestStatus('loading');
      setLoadError('');
      await Promise.all([
        getSystemSettings({ signal: controller.signal }),
        verifySession({ signal: controller.signal }),
      ]).then(
        // 当前回调在最新请求成功时替换配置并清除未保存标记。
        ([data, session]) => {
          if (!isCurrentSettingsRequest(requestSequence.current, sequence, controller.signal)) return;
          setSettingsState(data);
          markDirty(false);
          if (session.username) setCredentials(
            // previous 是会话用户名回填前的凭据草稿。
            previous => ({ ...previous, new_username: session.username || '' }),
          );
          void loadAIModels(data, false);
          setRequestStatus('success');
        },
      ).catch(
        // 加载失败回调保留已有配置和草稿，只显示可见错误供用户重试。
        error => {
          if (!isCurrentSettingsRequest(requestSequence.current, sequence, controller.signal) || isSettingsAbortError(error)) return;
          setLoadError(settingsErrorMessage(error, '加载配置失败'));
          setRequestStatus('error');
        },
      ).finally(
        // 当前请求收束加载状态；旧请求不得覆盖新请求。
        () => {
          if (isCurrentSettingsRequest(requestSequence.current, sequence, controller.signal)) setLoading(false);
        },
      );
    },
    [beginRequest, cancelModelRequest, loadAIModels, markDirty],
  );

  // loadSettings 是页面刷新入口，返回 Promise 以便调用方在确认和请求结束后继续处理。
  const loadSettings = useCallback(
    // 当前回调默认不绕过未保存草稿确认。
    async (): Promise<void> => loadSettingsInternal(false),
    [loadSettingsInternal],
  );

  useEffect(
    // 设置数据副作用执行首次强制加载，并在卸载时取消所有独立请求。
    () => {
      void loadSettingsInternal(true);
      return (
        // 设置数据清理回调终止设置、凭据、模型和连接测试请求。
        () => {
          requestController.current?.abort();
          credentialsRequestController.current?.abort();
          cancelModelRequest();
          testRequestController.current?.abort();
          testRequestSequence.current += 1;
          testRequestController.current = null;
          connectionTestLoadingRef.current = false;
        }
      );
    },
    [cancelModelRequest, loadSettingsInternal],
  );

  useEffect(
    // 模型选择器副作用在点击外部时关闭下拉框。
    () => {
      // handlePointerDown 负责点击模型选择器外部时关闭下拉框。
      const handlePointerDown = (event: MouseEvent) => {
        if (!modelPickerRef.current?.contains(event.target as Node)) setModelDropdownOpen(false);
      };
      document.addEventListener('mousedown', handlePointerDown);
      return /* 模型选择器清理回调移除文档级点击监听。 */ () => document.removeEventListener('mousedown', handlePointerDown);
    },
    [],
  );

  // handleSave 提交当前配置草稿，并在远程 Cookie 开启时再次要求危险确认。
  const handleSave = useCallback(
    // 当前回调由保存按钮触发，成功和失败都通过全局通知反馈。
    async (): Promise<void> => {
      if (!settings || savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setSaveError('');
      // saveController 保存实际设置提交的取消控制器，用于忽略被刷新动作取代的失败。
      let saveController: AbortController | null = null;
      // saveSequence 保存实际设置提交的代次，旧请求不得写入错误提示。
      let saveSequence = 0;
      try {
        // remoteCookieEnabled 表示当前草稿是否允许把账号 Cookie 发送到远程服务。
        const remoteCookieEnabled = settings['captcha.remote_pass_cookies'] === true
          || String(settings['captcha.remote_pass_cookies'] || '').toLowerCase() === 'true';
        if (remoteCookieEnabled) {
          // confirmed 表示用户是否确认继续保存包含敏感 Cookie 传递开关的配置。
          const confirmed = await confirmAction({
            title: '确认保存远程 Cookie 配置',
            message: '保存后会允许向远程验证服务传递账号 Cookie，请确认远程地址可信。',
            confirmText: '确认保存',
            danger: true,
          });
          if (!confirmed) return;
        }
        // testSequence 使保存前基于旧草稿发出的连接测试不再影响新的已保存配置。
        testRequestSequence.current += 1;
        testRequestController.current?.abort();
        testRequestController.current = null;
        connectionTestLoadingRef.current = false;
        setConnectionTestLoading(false);
        setConnectionTestMessage(null);
        cancelModelRequest();
        setAiModels([]);
        setModelsLoading(false);
        setModelDropdownOpen(false);
        setModelError('');
        // request 是本次保存动作的代次与控制器。
        const { controller, sequence } = beginRequest();
        saveController = controller;
        saveSequence = sequence;
        // result 由后端确认实际持久化是否成功，不能只以 HTTP 请求返回作为保存成功依据。
        const result = await updateSystemSettings(buildPersistableSettings(settings), { signal: controller.signal });
        if (!isCurrentSettingsRequest(requestSequence.current, sequence, controller.signal)) return;
        if (!result.success) throw new Error(result.message || '保存配置失败');
        // 保存后立刻擦除表单中的明文密钥，仅保留已配置标记。下次进入由数据库恢复设置，空输入不再清除它。
        setSettingsState(
          // savedSettings 回显保存状态而不让密钥明文停留在页面内存。
          previous => previous ? {
            ...previous,
            ai_api_key: previous.ai_api_key === settings.ai_api_key ? '' : previous.ai_api_key,
            ai_api_key_configured: previous.ai_api_key_configured === true || Boolean(settings.ai_api_key?.trim()),
            'captcha.remote_secret_key': previous['captcha.remote_secret_key'] === settings['captcha.remote_secret_key'] ? '' : previous['captcha.remote_secret_key'],
            'captcha.remote_secret_key_configured': previous['captcha.remote_secret_key_configured'] === true || Boolean(settings['captcha.remote_secret_key']?.trim()),
          } : previous,
        );
        markDirty(false);
        setLoadError('');
        notify('success', '系统配置已保存');
      } catch (/* error 保存系统设置提交请求的失败原因；过期响应不会覆盖当前表单。 */ error) {
        if (!saveController || !isCurrentSettingsRequest(requestSequence.current, saveSequence, saveController.signal) || isSettingsAbortError(error)) return;
        // message 是保存失败时可安全展示给用户的错误说明。
        const message = settingsErrorMessage(error, '保存配置失败');
        setSaveError(message);
        notify('error', message, '保存失败');
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [cancelModelRequest, markDirty, settings],
  );

  // handleRemoteCookieToggle 在写入敏感 Cookie 开关前确认影响，取消时保持原值。
  const handleRemoteCookieToggle = useCallback(
    // enabled 是用户请求切换到的远程 Cookie 传递状态。
    async (enabled: boolean): Promise<void> => {
      // confirmed 表示用户是否确认改变账号 Cookie 的外发权限。
      const confirmed = await confirmAction({
        title: enabled ? '开启远程 Cookie 传递？' : '关闭远程 Cookie 传递？',
        message: enabled
          ? '开启后，远程验证服务可接收当前账号 Cookie；仅应在信任服务地址时使用。'
          : '关闭后，远程验证服务将不再接收当前账号 Cookie。',
        confirmText: enabled ? '确认开启' : '确认关闭',
        danger: enabled,
      });
      if (!confirmed) return;
      updateSettingsDraft(
        // previous 是切换前的配置草稿，仅更新远程 Cookie 开关字段。
        previous => previous ? { ...previous, 'captcha.remote_pass_cookies': enabled } : previous,
      );
    },
    [updateSettingsDraft],
  );

  // handleCredentialsSave 校验并提交登录凭据表单。
  const handleCredentialsSave = useCallback(
    // event 是凭据表单提交事件，用于阻止浏览器默认导航。
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (credentialsSavingRef.current) return;
      setCredentialsMessage(null);
      // validationError 是前端校验得到的第一条可见错误。
      const validationError = validateCredentials(credentials);
      if (validationError) {
        setCredentialsMessage(createCredentialsMessage('error', validationError));
        return;
      }
      credentialsSavingRef.current = true;
      // request 是本次凭据保存动作的专属代次与控制器。
      const { controller, sequence } = beginCredentialsRequest();
      setCredentialsSaving(true);
      try {
        // result 是后端返回的凭据更新结果。
        const result = await updateLoginCredentials({
          current_password: credentials.current_password,
          new_username: credentials.new_username.trim(),
          new_password: credentials.new_password || undefined,
        }, { signal: controller.signal });
        if (!isCurrentSettingsRequest(credentialsRequestSequence.current, sequence, controller.signal)) return;
        if (!result.success) {
          // message 是后端拒绝凭据更新时的可展示说明。
          const message = result.message || '登录凭据更新失败';
          setCredentialsMessage(createCredentialsMessage('error', message));
          notify('error', message, '凭据更新失败');
          return;
        }
        // message 是凭据更新成功后的服务端说明或本地兜底文案。
        const message = result.message || '登录凭据已更新';
        setCredentialsMessage(createCredentialsMessage('success', message));
        notify('success', message);
        window.setTimeout(/* 凭据更新成功后延迟刷新页面以应用新会话。 */ () => window.location.reload(), 1400);
      } catch (/* error 保存登录凭据提交请求的失败原因；不写入日志或持久化状态。 */ error) {
        if (!isCurrentSettingsRequest(credentialsRequestSequence.current, sequence, controller.signal) || isSettingsAbortError(error)) return;
        // message 是凭据请求失败时可安全展示的错误说明。
        const message = settingsErrorMessage(error, '登录凭据更新失败');
        setCredentialsMessage(createCredentialsMessage('error', message));
        notify('error', message, '凭据更新失败');
      } finally {
        credentialsSavingRef.current = false;
        if (isCurrentSettingsRequest(credentialsRequestSequence.current, sequence, controller.signal)) setCredentialsSaving(false);
      }
    },
    [beginCredentialsRequest, credentials],
  );

  return {
    settings, loading, loadError, hasUnsavedChanges, saving, saveError, aiModels, modelsLoading, modelError, modelDropdownOpen,
    showApiKey, showCaptchaSecret, showCurrentPassword, showNewPassword, credentialsSaving, credentialsMessage,
    credentials, requestStatus, modelPickerRef, loadSettings, loadAIModels: /* source 是可选设置快照；openAfterLoad 指定成功后是否展开下拉列表。 */ (source, openAfterLoad) => void loadAIModels(source, openAfterLoad),
    testConnection, connectionTestLoading, connectionTestMessage, handleSave, handleRemoteCookieToggle, handleCredentialsSave,
    setSettings: updateSettingsDraft, setModelDropdownOpen, setShowApiKey, setShowCaptchaSecret,
    setShowCurrentPassword, setShowNewPassword, setCredentials, setCredentialsMessage,
  };
};
