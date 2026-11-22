import type { OrderRefreshResponse } from './models';

/** 将 result 转成同步完成提示；失败以结构化标记和计数为准，成功保留原消息并追加恢复修正统计。 */
export const formatOrderSyncResult = (result: OrderRefreshResponse): string => {
  // restored、reassigned 是互不重复的恢复和错绑修正数；兼容历史调用方缺少统计的结果。
  const restored = result.summary?.restored ?? 0, reassigned = result.summary?.reassigned ?? 0;
  // recovery 是实际发生恢复或修正时才附加的说明，零统计不改变原成功文案。
  const recovery = restored > 0 || reassigned > 0 ? `恢复 ${restored} 单，修正 ${reassigned} 单` : '';
  // failed 是结构化失败数量，独立于旧后端可能不准确的 partial_failure 和 message。
  const failed = result.summary?.failed ?? 0;
  if (!result.partial_failure && failed === 0) return [result.message, recovery].filter(Boolean).join('\n');
  // lines 首行固定显示未完成，不使用旧后端可能误报成功的顶层文案。
  const lines = [failed > 0 ? `订单同步未完成（失败 ${failed} 项）` : '订单同步未完成'];
  if (recovery) lines.push(recovery);
  // item 是当前失败账号或订单；成功结果不混入失败诊断。
  for (const /* item 是当前需要判断成功或展示失败原因的账号或订单结果。 */ item of result.results) {
    if (item.success) continue;
    // identity 按明细可用字段标识账号和订单，账号级失败不虚构订单号。
    const identity = [item.cookie_id ? `账号 ${item.cookie_id}` : '', item.order_id ? `订单 ${item.order_id}` : ''].filter(Boolean).join('，');
    // detail 同时保留技术错误与操作说明；完全相同的文案只展示一次，并明确标出失败原因。
    const detail = [item.error ? `失败原因：${item.error}` : '', item.message !== item.error ? item.message : ''].filter(Boolean).join('；');
    lines.push(`${identity ? `${identity}：` : ''}${detail || '未提供失败原因'}`);
  }
  // accessDenied 表示平台明确拒绝卖家订单列表，前端需要告知其无法靠重复刷新补全数据。
  const accessDenied = result.results.some(/* item 只检查失败条目中的脱敏诊断文本。 */ item =>
    !item.success && /PERMISSION_EXCEPTION|无权限访问/.test(`${item.error || ''} ${item.message || ''}`));
  if (accessDenied) {
    lines.push('闲鱼平台拒绝访问卖家订单列表。请在闲鱼官方卖家中心检查账号权限及登录验证；订单金额与状态未核实前，请勿据此重复发货。');
  }
  return lines.join('\n');
};
