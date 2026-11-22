import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';

/** useDialogFocus 统一处理弹窗 Escape、遮罩外点击、焦点陷阱、页面滚动锁和关闭后焦点恢复。 */
export const useDialogFocus = (options: {
  /** open 表示弹窗是否可见。 */ open: boolean;
  /** onClose 是用户请求关闭弹窗时调用的回调。 */ onClose: () => void;
  /** closeDisabled 表示请求进行中或存在未保存草稿时禁止键盘与遮罩关闭。 */ closeDisabled?: boolean;
}): React.RefObject<HTMLDivElement | null> => {
  // panelRef 指向弹窗根节点，焦点陷阱只在该节点内部循环。
  const panelRef = useRef<HTMLDivElement | null>(null);
  // previousFocusRef 保存打开弹窗前拥有焦点的元素，关闭后恢复键盘位置。
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // onCloseRef 保存最新关闭回调，避免父组件每次渲染都重新绑定全局监听。
  const onCloseRef = useRef(options.onClose);
  // closeDisabledRef 保存最新关闭禁用状态，供稳定的键盘监听读取。
  const closeDisabledRef = useRef(options.closeDisabled === true);
  onCloseRef.current = options.onClose;
  closeDisabledRef.current = options.closeDisabled === true;

  useEffect(
    /* dialogEffect 在弹窗打开时锁定页面滚动并安装键盘监听，关闭时完整恢复原状态。 */
    () => {
      if (!options.open) return;
      // previousOverflow 保存打开前的 body overflow，关闭时恢复页面滚动能力。
      const previousOverflow = document.body.style.overflow;
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.body.style.overflow = 'hidden';
      /** focusFirst 把初始焦点放到弹窗内第一个可交互元素。 */
      const focusFirst = (): void => {
        // panel 是当前打开的弹窗面板。
        const panel = panelRef.current;
        if (!panel) return;
        // firstFocusable 是弹窗内第一个可键盘操作元素。
        const firstFocusable = panel.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        (firstFocusable ?? panel).focus();
      };
      // focusTimer 延后到 React 完成真实 DOM 挂载后设置初始焦点。
      const focusTimer = window.setTimeout(focusFirst, 0);
      /** handleKeyDown 处理 Escape 关闭和 Tab 焦点循环。 */
      const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && !closeDisabledRef.current) {
          event.preventDefault();
          onCloseRef.current();
          return;
        }
        if (event.key !== 'Tab') return;
        // panel 是当前焦点陷阱边界。
        const panel = panelRef.current;
        if (!panel) return;
        // focusable 是弹窗内所有可键盘操作元素。
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
          .filter(/* element 只保留当前可见元素。 */ element => element.offsetParent !== null || element === document.activeElement);
        if (focusable.length === 0) {
          event.preventDefault();
          panel.focus();
          return;
        }
        // first 与 last 是焦点循环的边界元素。
        const first = focusable[0];
        // last 是弹窗内最后一个可聚焦元素，用于 Shift+Tab 时回到末尾。
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return /* dialogCleanup 恢复滚动、移除监听并把焦点还给触发元素。 */ () => {
        window.clearTimeout(focusTimer);
        window.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = previousOverflow;
        previousFocusRef.current?.focus();
      };
    },
    [options.open],
  );
  return panelRef;
};

/** DialogFrameProps 描述统一对话框外壳所需的标题、内容和底部操作。 */
export interface DialogFrameProps {
  /** open 表示是否渲染对话框。 */ open: boolean;
  /** title 是对话框可访问名称和可见标题。 */ title: string;
  /** eyebrow 是标题上方的可选业务分组。 */ eyebrow?: string;
  /** onClose 是关闭按钮、Escape 或遮罩关闭时调用的回调。 */ onClose: () => void;
  /** closeDisabled 表示请求进行中或必须明确处理草稿时禁止关闭。 */ closeDisabled?: boolean;
  /** size 是参考控制台支持的对话框宽度。 */ size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** busy 表示底部操作正在提交，会显示统一加载条。 */ busy?: boolean;
  /** children 是对话框主体。 */ children: React.ReactNode;
  /** footer 是底部操作区；为空时不渲染。 */ footer?: React.ReactNode;
  /** className 是页面级补充样式，不替代通用对话框布局。 */ className?: string;
}

/** DialogFrame 提供可访问、可关闭且风格统一的业务对话框。 */
export const DialogFrame: React.FC<DialogFrameProps> = ({
  open,
  title,
  eyebrow,
  onClose,
  closeDisabled = false,
  size = 'lg',
  busy = false,
  children,
  footer,
  className = '',
}) => {
  // titleId 为每个对话框生成稳定标题关联。
  const titleId = useId();
  // panelRef 统一管理焦点循环、滚动锁和关闭后焦点恢复。
  const panelRef = useDialogFocus({ open, onClose, closeDisabled });
  /** requestClose 由遮罩和关闭按钮调用，关闭禁用时不执行。 */
  const requestClose = useCallback(/* requestClose 回调用户主动关闭统一对话框。 */ () => {
    if (!closeDisabled) onClose();
  }, [closeDisabled, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-overlay-centered console-dialog-overlay"
      onMouseDown={/* 点击遮罩本身时关闭，点击面板内部不冒泡到关闭逻辑。 */ event => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        className={`modal-container console-dialog console-dialog-${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="console-dialog-header">
          <div>
            {eyebrow && <span className="console-dialog-eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="console-dialog-close" aria-label="关闭对话框" disabled={closeDisabled} onClick={requestClose}>
            <X className="h-4 w-4" />
          </button>
        </header>
        {busy && <div className="console-dialog-busy" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在提交，请稍候</div>}
        <div className="console-dialog-body">{children}</div>
        {footer && <footer className="console-dialog-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};
