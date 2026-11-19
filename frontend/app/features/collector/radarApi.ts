import { contractClient, runContractRequest } from '../../../shared/api-contract/client';
import type { CollectorRadarItemTransport, CollectorRadarStatusTransport, CollectorRadarTargetTransport } from '../../../shared/api-contract/collector';

/** RadarSort 是雷达榜单可选排序，不触发任何平台请求。 */
export type RadarSort = 'score' | 'delta' | 'velocity' | 'seller_new';

/** toTarget 将监控配置契约转换为页面使用的可读字段。 */
const toTarget = (dto: CollectorRadarTargetTransport) => ({
  id: dto.id, type: dto.target_type, value: dto.target_value, label: dto.label,
  enabled: dto.enabled, publishDays: dto.publish_days, lastScannedAt: dto.last_scanned_at, lastHitCount: dto.last_hit_count,
});

/** toRadarItem 将最近一次商品观测转换为榜单模型。 */
const toRadarItem = (dto: CollectorRadarItemTransport) => ({
  id: dto.item_id, title: dto.title, price: dto.price, image: dto.pic_url, seller: dto.seller_nick,
  source: dto.source_label, wants: dto.latest_want_count, delta: dto.delta_want,
  velocity: dto.daily_velocity, score: dto.viral_score, seenAt: dto.latest_seen_at, url: dto.web_url,
});

/** toStatus 将运行状态与定时计划投影为 UI 模型。 */
const toStatus = (dto: CollectorRadarStatusTransport) => ({
  running: dto.running, completed: dto.completed_targets, total: dto.total_targets,
  currentTarget: dto.current_target, updated: dto.updated_items, rising: dto.rising_items,
  aborted: dto.aborted_by_risk, error: dto.last_error,
  schedule: { enabled: dto.schedule.enabled, cookieId: dto.schedule.cookie_id, interval: dto.schedule.interval_hours },
});

/** RadarData 汇总只读本地雷达面板数据，不含账号凭证。 */
export type RadarData = {
  targets: ReturnType<typeof toTarget>[];
  items: ReturnType<typeof toRadarItem>[];
  status: ReturnType<typeof toStatus>;
};

/** loadRadar 并行读取本地数据库榜单及任务进度，signal 负责页面切换时取消。 */
export async function loadRadar(sort: RadarSort, signal: AbortSignal): Promise<RadarData> {
  // targets、items、status 分别是监控池、榜单和任务的 HTTP 转换前结果。
  const [targets, items, status] = await Promise.all([
    runContractRequest(/* requestSignal 接收统一取消和超时控制。 */ requestSignal => contractClient.GET('/api/v1/collector/radar/targets', { signal: requestSignal }), { signal }),
    runContractRequest(/* requestSignal 控制本地榜单读取。 */ requestSignal => contractClient.GET('/api/v1/collector/radar/items', { params: { query: { sort_by: sort, limit: 200 } }, signal: requestSignal }), { signal }),
    runContractRequest(/* requestSignal 控制状态读取。 */ requestSignal => contractClient.GET('/api/v1/collector/radar/scan/status', { signal: requestSignal }), { signal }),
  ]);
  return { targets: targets.targets.map(toTarget), items: items.items.map(toRadarItem), status: toStatus(status) };
}

/** addRadarTargets 添加用户指定的监控目标或导入内置种子包，不直接执行采集。 */
export async function addRadarTargets(type: 'keyword' | 'seller', value: string, days: number, seed: boolean, signal: AbortSignal): Promise<void> {
  await runContractRequest(/* requestSignal 控制本次目标保存请求。 */ requestSignal => contractClient.POST('/api/v1/collector/radar/targets', {
    body: { targets: seed ? [] : [{ target_type: type, raw_value: value, label: '', publish_days: days }], import_virtual_seed_pack: seed },
    signal: requestSignal,
  }), { signal });
}

/** toggleRadarTarget 更新已有目标启用状态。 */
export async function toggleRadarTarget(id: number, enabled: boolean, signal: AbortSignal): Promise<void> {
  await runContractRequest(/* requestSignal 控制启停保存请求。 */ requestSignal => contractClient.PATCH('/api/v1/collector/radar/targets/{id}', {
    params: { path: { id } }, body: { enabled }, signal: requestSignal,
  }), { signal });
}

/** deleteRadarTarget 删除用户指定的本地监控项。 */
export async function deleteRadarTarget(id: number, signal: AbortSignal): Promise<void> {
  await runContractRequest(/* requestSignal 控制本地删除请求。 */ requestSignal => contractClient.DELETE('/api/v1/collector/radar/targets/{id}', {
    params: { path: { id } }, signal: requestSignal,
  }), { signal });
}

/** startRadar 仅由用户点击触发一次受后端节流保护的巡检任务。 */
export async function startRadar(cookieId: string, signal: AbortSignal): Promise<void> {
  await runContractRequest(/* requestSignal 控制任务创建 HTTP 请求。 */ requestSignal => contractClient.POST('/api/v1/collector/radar/scan/start', {
    body: { cookie_id: cookieId }, signal: requestSignal,
  }), { signal });
}

/** stopRadar 请求取消当前巡检，不重试已中断的平台请求。 */
export async function stopRadar(signal: AbortSignal): Promise<void> {
  await runContractRequest(/* requestSignal 控制停止任务请求。 */ requestSignal => contractClient.POST('/api/v1/collector/radar/scan/stop', { signal: requestSignal }), { signal });
}

/** saveRadarSchedule 仅根据用户明确选择保存低频计划。 */
export async function saveRadarSchedule(enabled: boolean, cookieId: string, interval: number, signal: AbortSignal): Promise<void> {
  await runContractRequest(/* requestSignal 控制定时设置写入。 */ requestSignal => contractClient.PUT('/api/v1/collector/radar/schedule', {
    body: { enabled, cookie_id: cookieId, interval_hours: interval }, signal: requestSignal,
  }), { signal });
}

/** clearRadarItems 删除本地历史榜单，运行中的扫描由服务端拒绝。 */
export async function clearRadarItems(signal: AbortSignal): Promise<void> {
  await runContractRequest(/* requestSignal 控制清空榜单请求。 */ requestSignal => contractClient.DELETE('/api/v1/collector/radar/items', { signal: requestSignal }), { signal });
}
