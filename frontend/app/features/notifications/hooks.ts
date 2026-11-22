import { useCallback,useEffect,useRef,useState } from 'react';
import { confirmAction,notify } from '../../../shared/ui/feedback';
import type { NotificationChannel,SystemSettings } from './api';
import { createNotificationChannel,deleteNotificationChannel,getNotificationChannel,getNotificationChannels,getSystemSettings,testNotificationChannel,updateNotificationChannel,updateSystemSettings } from './api';
import { buildNotificationPayload,emptyNotificationForm,isCurrentNotificationRequest,normalizeNotificationForm,notificationActionKey,notificationErrorMessage,validateNotificationForm } from './state';
import type { NotificationAction,NotificationForm,NotificationState } from './types';

// useNotifications 统一管理通知渠道、事件订阅和系统 SMTP 的异步状态。
export const useNotifications = (isAdmin: boolean): NotificationState => {
  // channels 保存当前用户可用的通知渠道。
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  // loading 表示通知渠道列表是否正在加载。
  const [loading, setLoading] = useState(true);
  // loadError 保存渠道列表最近一次加载失败的可展示文本，供页面重试。
  const [loadError, setLoadError] = useState('');
  // showModal 表示渠道新建或编辑弹窗是否打开。
  const [showModal, setShowModal] = useState(false);
  // editing 保存当前正在编辑的渠道。
  const [editing, setEditing] = useState<NotificationChannel | null>(null);
  // saving 表示渠道表单保存动作是否正在执行。
  const [saving, setSaving] = useState(false);
  // testingId 保存当前正在测试发送的渠道 ID，兼容原有列表高亮语义。
  const [testingId, setTestingId] = useState('');
  // toast 保存最近一次提示状态，真实展示由全局 notify 宿主负责。
  const [toast, setToast] = useState<NotificationState['toast']>(null);
  // pendingActionKeys 保存所有正在执行的渠道动作键，驱动单项按钮忙碌状态。
  const [pendingActionKeys, setPendingActionKeys] = useState<ReadonlySet<string>>(
    // pendingActionSetFactory 为首次渲染创建独立的空动作键集合。
    () => new Set(),
  );
  // smtp 保存系统级邮件发送配置。
  const [smtp, setSmtp] = useState<SystemSettings>({});
  // smtpLoading 表示管理员 SMTP 配置是否正在加载。
  const [smtpLoading, setSmtpLoading] = useState(isAdmin);
  // smtpLoadError 保存管理员 SMTP 配置加载失败的可展示文本。
  const [smtpLoadError, setSmtpLoadError] = useState('');
  // smtpSaving 表示系统 SMTP 保存是否正在执行。
  const [smtpSaving, setSmtpSaving] = useState(false);
  // showSmtpPassword 控制系统 SMTP 密码是否明文显示。
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  // showChannelSmtpPassword 控制独立 SMTP 密码是否明文显示。
  const [showChannelSmtpPassword, setShowChannelSmtpPassword] = useState(false);
  // form 保存渠道编辑弹窗的当前表单。
  const [form, setForm] = useState<NotificationForm>(emptyNotificationForm);
  // channelGeneration 隔离渠道加载和刷新产生的旧响应。
  const channelGeneration = useRef(0);
  // channelAbort 保存当前渠道列表请求的取消控制器。
  const channelAbort = useRef<AbortController | null>(null);
  // smtpGeneration 隔离 SMTP 设置切换管理员状态后的旧响应。
  const smtpGeneration = useRef(0);
  // smtpAbort 保存当前 SMTP 设置请求的取消控制器。
  const smtpAbort = useRef<AbortController | null>(null);
  // actionGeneration 隔离保存、删除和测试动作的旧响应。
  const actionGeneration = useRef(0);
  // actionAbort 保存当前渠道变更动作的取消控制器。
  const actionAbort = useRef<AbortController | null>(null);
  // pendingActionRef 保存同步动作锁，防止同一渲染帧内快速双击绕过 React 状态更新。
  const pendingActionRef = useRef(new Set<string>());
  // toastTimer 保存提示自动消失的定时器句柄。
  const toastTimer = useRef<number | null>(null);
  // editorGeneration 隔离连续打开不同渠道时产生的旧编辑配置响应。
  const editorGeneration = useRef(0);
  // editorAbort 保存当前编辑配置请求的取消控制器。
  const editorAbort = useRef<AbortController | null>(null);

  // showToast 发布全局提示，并保留三秒本地状态以兼容既有页面测试。
  const showToast = useCallback(
    // type 是提示语义等级，text 是已经脱敏且可直接展示的提示文本。
    (type: NonNullable<NotificationState['toast']>['type'], text: string) => {
      notify(type, text);
      setToast({ type, text });
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(
        // toastCleanup 在提示展示三秒后清理本地兼容状态。
        () => {
          toastTimer.current = null;
          setToast(null);
        },
        3000,
      );
    },
    [],
  );

  // beginAction 在业务键空闲时登记同步锁和可见忙碌状态，返回是否获得执行权。
  const beginAction = useCallback(
    // actionKey 由动作类型和渠道 ID 组成，同一键在请求结束前不能再次提交。
    (actionKey: string): boolean => {
      if (pendingActionRef.current.has(actionKey)) return false;
      pendingActionRef.current.add(actionKey);
      setPendingActionKeys(
        // current 是登记前的动作键集合。
        current => new Set(current).add(actionKey),
      );
      return true;
    },
    [],
  );

  // finishAction 释放业务键；即使请求已被新动作取代也必须释放，避免忙碌状态泄漏。
  const finishAction = useCallback(
    // actionKey 是本次请求开始时的唯一动作键。
    (actionKey: string): void => {
      pendingActionRef.current.delete(actionKey);
      setPendingActionKeys(
        // current 是释放前的动作键集合。
        current => {
          if (!current.has(actionKey)) return current;
          // next 是移除当前业务键后的集合副本。
          const next = new Set(current);
          next.delete(actionKey);
          return next;
        },
      );
    },
    [],
  );

  // clearPendingActions 在弹窗关闭或卸载时立即清除所有按钮忙碌状态。
  const clearPendingActions = useCallback(
    // clearPendingActionsCallback 清空同步锁和所有按钮的可见忙碌状态。
    (): void => {
      pendingActionRef.current.clear();
      setPendingActionKeys(new Set());
    },
    [],
  );

  // isActionPending 读取同步动作锁，保证按钮禁用状态与请求生命周期一致。
  const isActionPending = useCallback(
    // channelId 是通知渠道标识，action 是当前要检查的渠道动作。
    (channelId: string, action: NotificationAction): boolean => pendingActionRef.current.has(notificationActionKey(channelId, action)),
    [],
  );

  // loadChannels 加载通知渠道、写入可重试错误并丢弃过期响应。
  const loadChannels = useCallback(
    // 渠道加载回调读取最新通知渠道列表。
    async () => {
      // generation 标记本次渠道查询的代次。
      const generation = ++channelGeneration.current;
      channelAbort.current?.abort();
      // controller 允许刷新或卸载时取消渠道请求。
      const controller = new AbortController();
      channelAbort.current = controller;
      setLoading(true);
      setLoadError('');
      try {
        // result 是当前用户的通知渠道列表响应。
        const result = await getNotificationChannels({ signal: controller.signal });
        if (!isCurrentNotificationRequest(generation, channelGeneration.current)) return;
        setChannels(result.data || []);
        setLoadError('');
      } catch (error: unknown /* 渠道加载异常 */) {
        if (isCurrentNotificationRequest(generation, channelGeneration.current) && !controller.signal.aborted) {
          setLoadError(notificationErrorMessage(error, '加载通知渠道失败'));
        }
      } finally {
        if (isCurrentNotificationRequest(generation, channelGeneration.current)) setLoading(false);
      }
    },
    [],
  );

  // loadSmtp 加载管理员可见的系统 SMTP 配置并暴露独立加载错误。
  const loadSmtp = useCallback(
    // SMTP 加载回调读取管理员系统设置。
    async () => {
      // generation 标记本次 SMTP 查询的代次。
      const generation = ++smtpGeneration.current;
      smtpAbort.current?.abort();
      // controller 允许管理员状态变化或保存动作取消 SMTP 查询。
      const controller = new AbortController();
      smtpAbort.current = controller;
      setSmtpLoading(true);
      setSmtpLoadError('');
      try {
        // settings 是系统 SMTP 配置快照。
        const settings = await getSystemSettings({ signal: controller.signal });
        if (!isCurrentNotificationRequest(generation, smtpGeneration.current)) return;
        setSmtp(settings || {});
        setSmtpLoadError('');
      } catch (error: unknown /* SMTP 加载异常 */) {
        if (isCurrentNotificationRequest(generation, smtpGeneration.current) && !controller.signal.aborted) {
          setSmtpLoadError(notificationErrorMessage(error, '加载 SMTP 配置失败'));
        }
      } finally {
        if (isCurrentNotificationRequest(generation, smtpGeneration.current)) setSmtpLoading(false);
      }
    },
    [],
  );

  useEffect(
    // 通知数据副作用并行加载渠道和管理员 SMTP 配置。
    () => {
      void loadChannels();
      if (isAdmin) {
        void loadSmtp();
      } else {
        smtpGeneration.current += 1;
        smtpAbort.current?.abort();
        setSmtp({});
        setSmtpLoading(false);
        setSmtpLoadError('');
      }
      return (
        // 通知数据清理回调取消渠道和 SMTP 请求。
        () => {
          channelGeneration.current += 1;
          channelAbort.current?.abort();
          smtpGeneration.current += 1;
          smtpAbort.current?.abort();
          editorGeneration.current += 1;
          editorAbort.current?.abort();
        }
      );
    },
    [isAdmin, loadChannels, loadSmtp],
  );

  useEffect(
    // 卸载清理负责终止渠道动作的展示生命周期并释放提示定时器。
    () => (
      // toastCleanup 在页面卸载时取消渠道动作、使旧结果失效并释放定时器。
      () => {
        actionGeneration.current += 1;
        actionAbort.current?.abort();
        pendingActionRef.current.clear();
        if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
      }
    ),
    [],
  );

  // openCreate 打开新建渠道表单并清理上一次编辑状态。
  const openCreate = useCallback(
    // 新建回调重置表单并打开渠道弹窗。
    () => {
      editorGeneration.current += 1;
      editorAbort.current?.abort();
      setEditing(null);
      setForm(emptyNotificationForm());
      setShowChannelSmtpPassword(false);
      setShowModal(true);
    },
    [],
  );

  // openEdit 先读取脱敏编辑配置再开放表单；关闭、切换或新建使旧请求失效，避免晚到响应覆盖输入。
  const openEdit = useCallback(
    // channel 是本次编辑对象；加载期间关闭旧表单，只有仍属于当前代次的响应能打开新表单。
    async (channel: NotificationChannel) => {
      // generation 标记本次编辑加载，隔离取消与连续打开不同渠道的结果。
      const generation = ++editorGeneration.current;
      editorAbort.current?.abort();
      // controller 控制当前读取的取消，不参与保存请求的生命周期。
      const controller = new AbortController();
      editorAbort.current = controller;
      setShowModal(false);
      try {
        // editor 只含收件地址与模式标记，SMTP 秘密始终留在服务端。
        const editor = await getNotificationChannel(channel.id, { signal: controller.signal });
        if (generation !== editorGeneration.current || controller.signal.aborted) return;
        // initialForm 是读取完成后一次性建立的表单，之后不再由该请求回填。
        const initialForm = normalizeNotificationForm(channel, smtp);
        setEditing(channel);
        setForm(channel.type === 'email' ? {
          ...initialForm, preserveSMTP: true,
          config: { to_email: editor.to_email || '', use_custom_smtp: editor.use_custom_smtp === true },
        } : initialForm);
        setShowChannelSmtpPassword(false);
        setShowModal(true);
      } catch (error: unknown /* 编辑读取失败时仅显示可读错误，不开放缺少配置的表单。 */) {
        if (generation === editorGeneration.current && !controller.signal.aborted) showToast('error', notificationErrorMessage(error, '读取渠道配置失败'));
      }
    },
    [showToast, smtp],
  );

  // closeModal 关闭渠道弹窗并取消未完成的保存动作。
  const closeModal = useCallback(
    // 关闭回调使保存请求失效并隐藏弹窗。
    () => {
      actionGeneration.current += 1;
      setTestingId('');
      actionAbort.current?.abort();
      clearPendingActions();
      editorGeneration.current += 1;
      editorAbort.current?.abort();
      setSaving(false);
      setShowModal(false);
    },
    [clearPendingActions],
  );

  // handleSave 校验并保存当前渠道表单，失败时保留表单供重试。
  const handleSave = useCallback(
    // 保存回调执行渠道校验、请求和成功刷新。
    async () => {
      // validationError 是渠道表单预检失败时的用户提示。
      const validationError = validateNotificationForm(form);
      if (validationError) {
        showToast('error', validationError);
        return;
      }
      // saveKey 唯一标识当前新建或编辑渠道的保存动作。
      const saveKey = notificationActionKey(editing?.id ?? 'new', 'save');
      if (!beginAction(saveKey)) return;
      // generation 标记当前渠道保存动作的代次。
      const generation = ++actionGeneration.current;
      // 替换动作时主动清理被取消测试的忙碌状态；旧 finally 已没有当前代次。
      setTestingId('');
      actionAbort.current?.abort();
      // controller 允许关闭弹窗时取消保存请求。
      const controller = new AbortController();
      actionAbort.current = controller;
      setSaving(true);
      try {
        // payload 是后端渠道接口使用的规范化请求体。
        const payload = buildNotificationPayload(form);
        if (editing) {
          await updateNotificationChannel(editing.id, payload, { signal: controller.signal });
        } else {
          await createNotificationChannel({ ...payload, config: payload.config || {} }, { signal: controller.signal });
        }
        if (!isCurrentNotificationRequest(generation, actionGeneration.current)) return;
        setShowModal(false);
        await loadChannels();
        if (!isCurrentNotificationRequest(generation, actionGeneration.current)) return;
        showToast('success', editing ? '已更新' : '已创建');
      } catch (error: unknown /* 渠道保存异常 */) {
        if (isCurrentNotificationRequest(generation, actionGeneration.current) && !controller.signal.aborted) {
          showToast('error', notificationErrorMessage(error, '保存失败'));
        }
      } finally {
        finishAction(saveKey);
        if (isCurrentNotificationRequest(generation, actionGeneration.current)) setSaving(false);
      }
    },
    [beginAction, editing, finishAction, form, loadChannels, showToast],
  );

  // handleDelete 先使用统一确认框确认，再删除渠道并刷新列表。
  const handleDelete = useCallback(
    // 删除回调执行危险动作确认、渠道删除请求和列表刷新。
    async (channel: NotificationChannel) => {
      // deleteKey 唯一标识当前渠道的删除确认和请求生命周期。
      const deleteKey = notificationActionKey(channel.id, 'delete');
      if (!beginAction(deleteKey)) return;
      // confirmed 表示用户是否确认执行不可逆的渠道删除。
      const confirmed = await confirmAction({
        title: '删除通知渠道',
        message: `确认删除渠道「${channel.name}」吗？已绑定该渠道的账号会自动解绑。`,
        confirmText: '删除渠道',
        danger: true,
      });
      if (!confirmed) {
        finishAction(deleteKey);
        return;
      }
      // generation 标记当前删除动作的代次。
      const generation = ++actionGeneration.current;
      // 替换动作时主动清理被取消测试的忙碌状态；旧 finally 已没有当前代次。
      setTestingId('');
      setSaving(false);
      actionAbort.current?.abort();
      // controller 允许刷新页面时取消删除请求。
      const controller = new AbortController();
      actionAbort.current = controller;
      try {
        await deleteNotificationChannel(channel.id, { signal: controller.signal });
        if (!isCurrentNotificationRequest(generation, actionGeneration.current)) return;
        await loadChannels();
        if (!isCurrentNotificationRequest(generation, actionGeneration.current)) return;
        showToast('success', '已删除');
      } catch (error: unknown /* 渠道删除异常 */) {
        if (isCurrentNotificationRequest(generation, actionGeneration.current) && !controller.signal.aborted) {
          showToast('error', notificationErrorMessage(error, '删除失败'));
        }
      } finally {
        finishAction(deleteKey);
      }
    },
    [beginAction, finishAction, loadChannels, showToast],
  );

  // handleToggleEnabled 更新渠道启用状态并采用函数式局部更新。
  const handleToggleEnabled = useCallback(
    // 启用切换回调更新渠道状态并保留最新响应。
    async (channel: NotificationChannel) => {
      // toggleKey 唯一标识当前渠道的启用状态切换动作。
      const toggleKey = notificationActionKey(channel.id, 'toggle');
      if (!beginAction(toggleKey)) return;
      // generation 标记当前启用状态动作的代次。
      const generation = ++actionGeneration.current;
      // 替换动作时主动清理被取消测试的忙碌状态；旧 finally 已没有当前代次。
      setTestingId('');
      setSaving(false);
      actionAbort.current?.abort();
      // controller 允许新的渠道动作取消旧请求。
      const controller = new AbortController();
      actionAbort.current = controller;
      try {
        await updateNotificationChannel(channel.id, { enabled: !channel.enabled }, { signal: controller.signal });
        if (!isCurrentNotificationRequest(generation, actionGeneration.current)) return;
        setChannels(
          // nextChannelsUpdater 使用函数式更新渠道列表。
          current => current.map(
            // item 是当前待更新的渠道项。
            item => item.id === channel.id ? { ...item, enabled: !item.enabled } : item,
          ),
        );
        showToast('success', channel.enabled ? '渠道已停用' : '渠道已启用');
      } catch (error: unknown /* 渠道状态异常 */) {
        if (isCurrentNotificationRequest(generation, actionGeneration.current) && !controller.signal.aborted) {
          showToast('error', notificationErrorMessage(error, '切换失败'));
        }
      } finally {
        finishAction(toggleKey);
      }
    },
    [beginAction, finishAction, showToast],
  );

  // handleTest 发送渠道测试通知并按渠道阻止重复提交。
  const handleTest = useCallback(
    // 测试回调发送测试通知并显示结果。
    async (channel: NotificationChannel) => {
      // testKey 唯一标识当前渠道的测试通知动作。
      const testKey = notificationActionKey(channel.id, 'test');
      if (!beginAction(testKey)) return;
      setTestingId(channel.id);
      // generation 标记当前测试通知动作的代次。
      const generation = ++actionGeneration.current;
      setSaving(false);
      actionAbort.current?.abort();
      // controller 允许新动作取消旧的测试发送。
      const controller = new AbortController();
      actionAbort.current = controller;
      try {
        await testNotificationChannel(channel.id, { signal: controller.signal });
        if (isCurrentNotificationRequest(generation, actionGeneration.current)) showToast('success', '测试通知已发送，请检查对应渠道');
      } catch (error: unknown /* 测试通知异常 */) {
        if (isCurrentNotificationRequest(generation, actionGeneration.current) && !controller.signal.aborted) {
          showToast('error', notificationErrorMessage(error, '发送失败'));
        }
      } finally {
        finishAction(testKey);
        if (isCurrentNotificationRequest(generation, actionGeneration.current)) setTestingId('');
      }
    },
    [beginAction, finishAction, showToast],
  );

  // handleSaveSmtp 保存系统 SMTP 配置并支持取消旧保存请求。
  const handleSaveSmtp = useCallback(
    // SMTP 保存回调提交系统邮件配置。
    async () => {
      // smtpSaveKey 是系统 SMTP 保存动作的固定同步锁键。
      const smtpSaveKey = notificationActionKey('smtp', 'save');
      if (!beginAction(smtpSaveKey)) return;
      // generation 标记当前 SMTP 保存动作的代次。
      const generation = ++smtpGeneration.current;
      smtpAbort.current?.abort();
      // controller 允许重复保存时取消上一轮请求。
      const controller = new AbortController();
      smtpAbort.current = controller;
      setSmtpLoading(false);
      setSmtpSaving(true);
      try {
        const payload: SystemSettings = {
          smtp_server: smtp.smtp_server || '', smtp_port: smtp.smtp_port || 587, smtp_user: smtp.smtp_user || '',
          smtp_from_name: smtp.smtp_from_name || '',
          smtp_from_address: smtp.smtp_from_address || smtp.smtp_user || '', smtp_use_tls: smtp.smtp_use_tls !== false,
          smtp_use_ssl: smtp.smtp_use_ssl === true,
        };
        // 仅在管理员主动编辑过密码字段时提交，避免加载配置后意外清空服务端秘密。
        if (Object.prototype.hasOwnProperty.call(smtp, 'smtp_password')) {
          payload.smtp_password = smtp.smtp_password;
        }
        await updateSystemSettings(payload, { signal: controller.signal });
        if (isCurrentNotificationRequest(generation, smtpGeneration.current)) showToast('success', 'SMTP 配置已保存');
      } catch (error: unknown /* SMTP 保存异常 */) {
        if (isCurrentNotificationRequest(generation, smtpGeneration.current) && !controller.signal.aborted) {
          showToast('error', notificationErrorMessage(error, '保存失败'));
        }
      } finally {
        finishAction(smtpSaveKey);
        if (isCurrentNotificationRequest(generation, smtpGeneration.current)) setSmtpSaving(false);
      }
    },
    [beginAction, finishAction, showToast, smtp],
  );

  return {
    channels, loading, loadError, showModal, editing, saving, testingId, toast, pendingActionKeys, isActionPending,
    smtp, smtpLoading, smtpLoadError, smtpSaving,
    showSmtpPassword, showChannelSmtpPassword, form, setForm, setSmtp, setShowSmtpPassword,
    setShowChannelSmtpPassword, loadChannels, loadSmtp, openCreate, openEdit, closeModal, showToast,
    handleSave, handleDelete, handleToggleEnabled, handleTest, handleSaveSmtp,
  };
};
