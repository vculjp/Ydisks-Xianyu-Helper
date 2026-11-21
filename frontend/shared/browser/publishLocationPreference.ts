/** RememberedPublishLocation 是上次手动选取的公开发货区域或 POI，不包含账号凭证。 */
export interface RememberedPublishLocation {
  /** province 是高德省级行政区名称。 */
  province: string;
  /** city 是高德城市名称。 */
  city: string;
  /** area 是已选区县名称。 */
  area: string;
  /** division_id 是高德区县行政区划编码。 */
  division_id: string;
  /** longitude、latitude 是高德返回的有效区县中心或 POI 坐标，不自行猜测。 */
  longitude: number;
  latitude: number;
  /** poi_id 是用户可选的具体兴趣点编号，为空表示仅选择区县。 */
  poi_id: string;
  /** poi_name 是用户可选的具体兴趣点名称，为空表示仅选择区县。 */
  poi_name: string;
}

/** LAST_PUBLISH_LOCATION_KEY 仅在当前浏览器保存非敏感的上次发货地，不上传服务端。 */
const LAST_PUBLISH_LOCATION_KEY = 'ydisks.publish.last_location.v1';

/** validRememberedLocation 拒绝损坏、越界及非结构化的浏览器缓存，避免错误发货地进入发布请求。 */
const validRememberedLocation = (value: unknown): value is RememberedPublishLocation => {
  if (!value || typeof value !== 'object') return false;
  // candidate 是尚未信任的浏览器存储内容，按精确字段和地理坐标范围进行检查。
  const candidate = value as Record<string, unknown>;
  // requiredNames 是跨发布入口共同要求的省、市、区及区划编码字段。
  const requiredNames = [candidate.province, candidate.city, candidate.area, candidate.division_id];
  if (!requiredNames.every(/* requiredName 是当前必须存在且长度合理的行政区字段。 */ requiredName => typeof requiredName === 'string' && requiredName.trim().length > 0 && requiredName.length <= 100)) return false;
  if (typeof candidate.poi_id !== 'string' || typeof candidate.poi_name !== 'string' || candidate.poi_id.length > 120 || candidate.poi_name.length > 120) return false;
  // longitude、latitude 是真实地图提供的坐标，不能由空值或字符串隐式转换。
  const { longitude, latitude } = candidate;
  return typeof longitude === 'number' && typeof latitude === 'number'
    && Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
    && !(longitude === 0 && latitude === 0);
};

/** readLastPublishLocation 在每次打开发布入口时恢复上次地址；浏览器禁用存储时安全退回未选择。 */
export const readLastPublishLocation = (): RememberedPublishLocation | null => {
  try {
    // raw 是当前浏览器本地保存的最后一次发货地 JSON。
    const raw = window.localStorage.getItem(LAST_PUBLISH_LOCATION_KEY);
    if (!raw || raw.length > 2048) return null;
    // parsed 是待校验的候选缓存，严格检查后才允许放入发布表单。
    const parsed: unknown = JSON.parse(raw);
    return validRememberedLocation(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** saveLastPublishLocation 仅在用户明确选中或清除地址时更新偏好，不在发布表单重置时覆盖缓存。 */
export const saveLastPublishLocation = (location: RememberedPublishLocation | null): void => {
  try {
    if (location === null) {
      window.localStorage.removeItem(LAST_PUBLISH_LOCATION_KEY);
    } else if (validRememberedLocation(location)) {
      window.localStorage.setItem(LAST_PUBLISH_LOCATION_KEY, JSON.stringify(location));
    }
  } catch {
    // 浏览器隐私模式或存储配额不足时只影响记忆，不阻断本次发布。
  }
};
