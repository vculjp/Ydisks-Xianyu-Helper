import { useCallback, useRef, useState } from 'react';
import { notify, type ToastTone } from './feedback';

/** AsyncActionOptions 描述一次异步动作的开始、成功和失败提示。 */
export interface AsyncActionOptions<T> {
  /** successMessage 是动作成功后的用户提示。 */ successMessage?: string;
  /** successTitle 是成功提示标题。 */ successTitle?: string;
  /** errorMessage 是动作失败后的兜底提示。 */ errorMessage?: string;
  /** onSuccess 在动作成功后执行，可用于刷新列表或关闭弹窗。 */ onSuccess?: (result: T) => void | Promise<void>;
  /** onError 在动作失败后执行，可用于保留表单并写入行内错误。 */ onError?: (error: unknown) => void;
  /** tone 是成功提示语气，默认 success。 */ tone?: ToastTone;
}

/** useAsyncAction 提供按业务键隔离的防重复提交、加载状态和统一成功/失败提示。 */
export const useAsyncAction = (): {
  /** pendingKeys 是当前正在执行的业务键集合。 */ pendingKeys: ReadonlySet<string>;
  /** isPending 判断指定业务键是否正在提交。 */ isPending: (key: string) => boolean;
  /** run 执行一次异步动作并自动处理并发锁与提示。 */ run: <T>(key: string, task: () => Promise<T>, options?: AsyncActionOptions<T>) => Promise<T | undefined>;
} => {
  // pendingKeys 是当前请求中的业务键；只属于页面交互状态。
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  // pendingRef 是同步请求锁，避免同一渲染帧内快速双击绕过 React 状态更新。
  const pendingRef = useRef(new Set<string>());

  /** isPending 读取同步锁，保证按钮禁用状态与请求生命周期一致。 */
  const isPending = useCallback(/* isPending 回调查询指定业务键是否已经提交。 */ (key: string): boolean => pendingRef.current.has(key), []);

  /** run 在业务键空闲时执行任务，并把结果转换为可见提示。 */
  const run = useCallback(/* run 回调封装防重复提交和统一错误提示。 */ async <T,>(
    key: string,
    task: () => Promise<T>,
    options: AsyncActionOptions<T> = {},
  ): Promise<T | undefined> => {
    if (pendingRef.current.has(key)) return undefined;
    pendingRef.current.add(key);
    setPendingKeys(/* current 是更新前的忙碌业务键集合。 */ current => new Set(current).add(key));
    try {
      // result 是业务动作返回的已脱敏结果。
      const result = await task();
      if (options.successMessage) notify(options.tone ?? 'success', options.successMessage, options.successTitle);
      await options.onSuccess?.(result);
      return result;
    } catch (error /* error 是业务动作失败原因，提示前只读取可安全展示的 message。 */) {
      // message 是可展示给用户的失败说明。
      const message = error instanceof Error && error.message ? error.message : (options.errorMessage || '操作失败，请稍后重试');
      notify('error', message, options.errorMessage ? '操作失败' : undefined);
      options.onError?.(error);
      return undefined;
    } finally {
      pendingRef.current.delete(key);
      setPendingKeys(/* current 是更新前的忙碌业务键集合。 */ current => {
        // next 是移除当前业务键后的集合副本。
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, []);

  return { pendingKeys, isPending, run };
};
