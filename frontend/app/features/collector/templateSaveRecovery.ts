import type { CollectedProduct, CollectorSaveTemplatesSummary } from './types';

/** TemplateSaveRecoveryKind 区分本地采集执行权冲突、平台风控与普通转存失败，防止把任务忙误判为滑块。 */
export type TemplateSaveRecoveryKind = 'busy' | 'risk' | null;

/** classifyTemplateSaveRecovery 根据已返回的逐件失败原因决定是否显示人工恢复入口，不会自动重新发起平台请求。 */
export const classifyTemplateSaveRecovery = (summary: CollectorSaveTemplatesSummary): TemplateSaveRecoveryKind => {
  if (!summary.abortedByRisk) return null;
  // failures 是本批次实际返回的逐件失败文案，不包含 Cookie 或其他凭证。
  const failures = summary.results.map(/* row 仅提取用户可见的本地失败原因。 */ row => row.errorReason ?? '');
  if (failures.some(/* reason 优先识别本地任务互斥，不引导用户去滑块验证。 */ reason => /已有采集操作正在运行|已有.*任务正在运行|本地任务冲突|其他任务正在运行|采集任务正在运行/.test(reason))) {
    return 'busy';
  }
  if (failures.some(/* reason 检查是否包含真实的官方安全验证或 RGV587 风控代码。 */ reason => /RGV587|USER_VALIDATE|安全验证|风控验证/.test(reason))) {
    return 'risk';
  }
  return null;
};

/** incompleteDescriptionItems 找出缺正文或把标题当正文的商品，避免摘要采集被默认为可直接发布。 */
export const incompleteDescriptionItems = (items: ReadonlyArray<Pick<CollectedProduct, 'itemId' | 'title' | 'description'>>): string[] =>
  items.filter(/* item 只有明确的独立正文才可视作已具备描述。 */ item =>
    !item.description.trim() || item.description.trim() === item.title.trim(),
  ).map(/* item 返回商品 ID 用于展示需补充的条目数量。 */ item => item.itemId);
