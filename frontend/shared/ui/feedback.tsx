import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from './Dialog';

/** ToastTone 是业务提示使用的语义等级。 */
export type ToastTone = 'success' | 'error' | 'warning' | 'info';

/** ToastMessage 描述一条等待展示的用户提示。 */
export interface ToastMessage {
  /** id 是提示队列中的唯一标识。 */
  id: string;
  /** tone 决定图标、颜色和可访问性播报语气。 */
  tone: ToastTone;
  /** text 是已经脱敏、可直接展示给用户的提示文本。 */
  text: string;
  /** title 是提示的可选短标题。 */
  title?: string;
}

/** ConfirmOptions 描述统一确认框的标题、正文和危险操作文案。 */
export interface ConfirmOptions {
  /** title 是确认框标题；缺省时使用“请确认操作”。 */
  title?: string;
  /** message 是此次操作的影响说明，不允许包含敏感凭证。 */
  message: string;
  /** confirmText 是确认按钮文案。 */
  confirmText?: string;
  /** cancelText 是取消按钮文案。 */
  cancelText?: string;
  /** danger 表示确认后执行不可逆或高风险动作。 */
  danger?: boolean;
}

/** ToastEventDetail 是 notify 与 ToastHost 之间传输提示的稳定事件载荷。 */
interface ToastEventDetail extends ToastMessage {}

/** ConfirmRequestDetail 是 confirmAction 发出的确认请求载荷。 */
interface ConfirmRequestDetail extends ConfirmOptions {
  /** id 用于把用户选择准确回传给唯一一个等待中的 Promise。 */
  id: string;
}

/** ConfirmResponseDetail 是确认框关闭后回传的用户选择。 */
interface ConfirmResponseDetail {
  /** id 对应发起确认的请求。 */
  id: string;
  /** confirmed 表示用户是否确认执行。 */
  confirmed: boolean;
}

/** TOAST_EVENT 是所有业务模块发布轻提示的浏览器事件名。 */
const TOAST_EVENT = 'ydisks:toast';
/** CONFIRM_REQUEST_EVENT 是业务模块请求统一确认框的事件名。 */
const CONFIRM_REQUEST_EVENT = 'ydisks:confirm-request';
/** CONFIRM_RESPONSE_EVENT 是确认框回传用户选择的事件名。 */
const CONFIRM_RESPONSE_EVENT = 'ydisks:confirm-response';
/** toastSequence 为同一页面生命周期内的提示生成单调递增标识。 */
let toastSequence = 0;
/** confirmSequence 为并发确认请求生成单调递增标识。 */
let confirmSequence = 0;
/** confirmHostCount 记录当前挂载的统一确认框宿主数量；为零时保留测试和独立组件渲染兼容。 */
let confirmHostCount = 0;

/** createEventId 生成仅在当前浏览器页面内唯一的提示或确认标识。 */
const createEventId = (prefix: string, sequence: number): string => `${prefix}-${Date.now()}-${sequence}`;

/** notify 发布一条业务提示；应用根节点挂载 ToastHost 后不再使用原生 alert。 */
export const notify = (tone: ToastTone, text: string, title?: string): void => {
  if (typeof window === 'undefined') return;
  // detail 是提示事件中不可变的展示内容。
  const detail: ToastEventDetail = {
    id: createEventId('toast', ++toastSequence),
    tone,
    text,
    title,
  };
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT, { detail }));
};

/** confirmAction 优先使用统一确认框；独立渲染的测试或组件未挂载宿主时回退原生 confirm。 */
export const confirmAction = (options: ConfirmOptions): Promise<boolean> => {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (confirmHostCount === 0) return Promise.resolve(window.confirm(options.message));
  return new Promise(/* resolver 在用户确认或取消后结束等待。 */ resolver => {
    // id 绑定本次确认请求与唯一响应。
    const id = createEventId('confirm', ++confirmSequence);
    /** handleResponse 只接收与当前请求 id 相同的用户选择。 */
    const handleResponse = (event: Event): void => {
      // response 是确认框回传的事件载荷。
      const response = (event as CustomEvent<ConfirmResponseDetail>).detail;
      if (!response || response.id !== id) return;
      window.removeEventListener(CONFIRM_RESPONSE_EVENT, handleResponse);
      resolver(response.confirmed);
    };
    window.addEventListener(CONFIRM_RESPONSE_EVENT, handleResponse);
    // request 是包含稳定 id 的确认请求。
    const request: ConfirmRequestDetail = { ...options, id };
    window.dispatchEvent(new CustomEvent<ConfirmRequestDetail>(CONFIRM_REQUEST_EVENT, { detail: request }));
  });
};

/** toastIcon 根据语义等级选择提示图标。 */
const toastIcon = (tone: ToastTone): React.ReactNode => {
  if (tone === 'success') return <CheckCircle2 className="h-4 w-4" />;
  if (tone === 'error') return <AlertCircle className="h-4 w-4" />;
  if (tone === 'warning') return <TriangleAlert className="h-4 w-4" />;
  return <Info className="h-4 w-4" />;
};

/** ToastItem 渲染单条提示，并在展示时间结束后通知宿主清理。 */
const ToastItem: React.FC<{ /** message 是待展示的提示。 */ message: ToastMessage; /** onDismiss 清除指定提示。 */ onDismiss: (id: string) => void }> = ({ message, onDismiss }) => {
  useEffect(
    /* durationEffect 在提示展示三点四秒后自动关闭，卸载时清理计时器。 */
    () => {
      // timer 是当前提示的自动关闭计时器。
      const timer = window.setTimeout(/* 自动关闭回调只清理本条提示。 */ () => onDismiss(message.id), 3400);
      return /* timerCleanup 防止提示被手动关闭后仍触发旧计时器。 */ () => window.clearTimeout(timer);
    },
    [message.id, onDismiss],
  );
  return (
    <div className={`console-toast console-toast-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'} aria-live={message.tone === 'error' ? 'assertive' : 'polite'}>
      <span className="console-toast-icon">{toastIcon(message.tone)}</span>
      <span className="console-toast-copy">
        {message.title && <strong>{message.title}</strong>}
        <span>{message.text}</span>
      </span>
      <button type="button" className="console-toast-close" aria-label="关闭提示" onClick={/* 手动关闭只移除当前提示。 */ () => onDismiss(message.id)}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

/** ToastHost 订阅全局提示事件，并在应用右下角渲染最多四条提示。 */
export const ToastHost: React.FC = () => {
  // messages 是当前排队展示的提示；只属于页面展示状态。
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  // dismissTimer 保存清理已关闭提示状态的短延迟计时器。
  const dismissTimer = useRef<number | null>(null);

  useEffect(
    /* toastSubscription 订阅业务提示并限制队列长度；卸载时移除监听。 */
    () => {
      /** handleToast 把新提示追加到队列并保留最近四条。 */
      const handleToast = (event: Event): void => {
        // message 是业务模块发布的提示载荷。
        const message = (event as CustomEvent<ToastEventDetail>).detail;
        if (!message?.text) return;
        setMessages(/* current 是追加前的提示队列。 */ current => [...current.slice(-3), message]);
      };
      window.addEventListener(TOAST_EVENT, handleToast);
      return /* toastCleanup 移除全局提示监听并释放关闭计时器。 */ () => {
        window.removeEventListener(TOAST_EVENT, handleToast);
        if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
      };
    },
    [],
  );

  /** dismissToast 按标识移除提示，找不到时不改变其他排队提示。 */
  const dismissToast = (id: string): void => {
    setMessages(/* current 是当前提示队列。 */ current => current.filter(/* message 是待判断的提示。 */ message => message.id !== id));
  };

  if (messages.length === 0) return null;
  return createPortal(
    <div className="console-toast-stack" aria-label="操作提示">
      {messages.map(/* message 是当前待展示提示。 */ message => <ToastItem key={message.id} message={message} onDismiss={dismissToast} />)}
    </div>,
    document.body,
  );
};

/** ConfirmDialogHost 订阅确认请求并渲染统一确认框，再把用户选择通过事件回传。 */
export const ConfirmDialogHost: React.FC = () => {
  // queue 是等待用户处理的确认请求队列，避免多个危险动作叠加。.
  const [queue, setQueue] = useState<ConfirmRequestDetail[]>([]);
  // active 是队列头部正在展示的确认请求。
  const active = queue[0] ?? null;

  useEffect(
    /* confirmSubscription 登记宿主并接收确认请求；卸载时恢复无宿主回退行为。 */
    () => {
      confirmHostCount += 1;
      /** handleRequest 把新确认请求加入队列。 */
      const handleRequest = (event: Event): void => {
        // request 是等待用户确认的完整请求。
        const request = (event as CustomEvent<ConfirmRequestDetail>).detail;
        if (!request?.id || !request.message) return;
        setQueue(/* current 是追加前的确认队列。 */ current => [...current, request]);
      };
      window.addEventListener(CONFIRM_REQUEST_EVENT, handleRequest);
      return /* confirmCleanup 减少宿主计数并移除监听。 */ () => {
        confirmHostCount = Math.max(0, confirmHostCount - 1);
        window.removeEventListener(CONFIRM_REQUEST_EVENT, handleRequest);
      };
    },
    [],
  );

  /** resolveActive 回传当前确认结果并推进队列。 */
  const resolveActive = (confirmed: boolean): void => {
    if (!active) return;
    window.dispatchEvent(new CustomEvent<ConfirmResponseDetail>(CONFIRM_RESPONSE_EVENT, {
      detail: { id: active.id, confirmed },
    }));
    setQueue(/* current 是当前确认队列。 */ current => current.slice(1));
  };

  if (!active) return null;
  return createPortal(
    <ConfirmSurface request={active} onResolve={resolveActive} />,
    document.body,
  );
};

/** ConfirmSurface 渲染单个确认框并管理焦点、Escape 与遮罩关闭。 */
const ConfirmSurface: React.FC<{
  /** request 是当前确认请求。 */ request: ConfirmRequestDetail;
  /** onResolve 回传确认结果为真或取消为假。 */ onResolve: (confirmed: boolean) => void;
}> = ({ request, onResolve }) => {
  // panelRef 指向确认框面板，供焦点陷阱和初始聚焦使用。
  const panelRef = useDialogFocus({
    open: true,
    onClose: /* Escape 与点击遮罩都按取消处理。 */ () => onResolve(false),
  });
  /** closeCanceled 由取消按钮和关闭图标调用。 */
  const closeCanceled = (): void => onResolve(false);
  return (
    <div
      className="modal-overlay-centered console-confirm-overlay"
      onMouseDown={/* 仅点击遮罩本身时取消，点击面板内部不触发。 */ event => {
        if (event.target === event.currentTarget) closeCanceled();
      }}
    >
      <div ref={panelRef} className="console-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="console-confirm-title">
        <div className="console-confirm-head">
          <span className={`console-confirm-symbol ${request.danger ? 'is-danger' : ''}`}><TriangleAlert className="h-5 w-5" /></span>
          <div>
            <h2 id="console-confirm-title">{request.title || '请确认操作'}</h2>
            <p>{request.message}</p>
          </div>
        </div>
        <div className="console-confirm-actions">
          <button type="button" className="ios-btn-secondary" onClick={closeCanceled}>{request.cancelText || '取消'}</button>
          <button type="button" className={request.danger ? 'ios-btn-danger' : 'ios-btn-primary'} onClick={/* 确认后立即回传并推进队列。 */ () => onResolve(true)}>
            {request.confirmText || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** AsyncStateView 统一渲染加载、错误和空数据状态，避免把请求失败伪装成没有数据。 */
export const AsyncStateView: React.FC<{
  /** loading 表示资源首次读取或刷新是否仍在进行。 */ loading: boolean;
  /** error 是已脱敏的加载失败说明，非空时优先于空态展示。 */ error?: string;
  /** empty 表示资源读取成功但没有可展示记录。 */ empty: boolean;
  /** onRetry 是错误态提供的重试回调。 */ onRetry?: () => void;
  /** emptyTitle 是空态标题。 */ emptyTitle?: string;
  /** emptyDescription 是空态说明。 */ emptyDescription?: string;
  /** compact 表示表格内使用的紧凑占位。 */ compact?: boolean;
  /** loadingText 是加载占位说明。 */ loadingText?: string;
  /** children 是资源可用时渲染的业务内容。 */ children?: React.ReactNode;
}> = ({ loading, error, empty, onRetry, emptyTitle = '暂无数据', emptyDescription = '当前条件下没有可展示的数据。', compact = false, loadingText = '正在加载数据', children }) => {
  if (loading && !children) {
    return (
      <div className={`console-async-state ${compact ? 'is-compact' : ''}`} role="status" aria-label={loadingText}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <strong>{loadingText}</strong>
        <span>请稍候，正在读取服务端数据。</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className={`console-async-state is-error ${compact ? 'is-compact' : ''}`} role="alert">
        <AlertCircle className="h-5 w-5" />
        <strong>数据加载失败</strong>
        <span>{error}</span>
        {onRetry && <button type="button" className="ios-btn-secondary" onClick={onRetry}>重新加载</button>}
      </div>
    );
  }
  if (empty) {
    return (
      <div className={`console-async-state is-empty ${compact ? 'is-compact' : ''}`}>
        <Info className="h-5 w-5" />
        <strong>{emptyTitle}</strong>
        <span>{emptyDescription}</span>
      </div>
    );
  }
  return <>{children}</>;
};
