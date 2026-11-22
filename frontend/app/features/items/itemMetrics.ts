import type { Item } from './models';

/** 商品统计 UI 模型；每项 undefined 表示未知，0 表示明确的真实零值。 */
export interface ItemMetrics {
  /** 平台明确返回的精确曝光次数。 */
  exposure_count: number | undefined;
  /** 平台明确返回的精确浏览次数。 */
  browse_count: number | undefined;
  /** 平台明确返回或旧缓存精确标签中的想要人数。 */
  want_count: number | undefined;
}

/** ItemMetricSource 限定解析器读取的非敏感属性，列表模型和详情模型均可使用。 */
type ItemMetricSource = Pick<Item, 'item_detail' | 'exposure_count' | 'browse_count' | 'want_count'>;

/** exactCount 仅接受 value 中可无损表达的非负整数，拒绝 null、布尔、字符串、负数、小数及溢出。 */
const exactCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** cachedDetail 解析 item 的本地扩展缓存，格式错误或非对象时返回空对象，不发起同步请求。 */
const cachedDetail = (item: ItemMetricSource): Record<string, unknown> => {
  try {
    // detail 是历史缓存的非敏感 JSON，仅用于兼容旧版本服务端缺少统计字段的响应。
    const detail: unknown = JSON.parse(item.item_detail || '{}');
    return detail !== null && typeof detail === 'object' && !Array.isArray(detail) ? detail as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

/** cachedWantCount 只扫描 labels 标签树中的完整精确人数文本；矛盾标签、缩略文本及不存在的统计均返回 undefined。 */
const cachedWantCount = (labels: unknown): number | undefined => {
  // counts 对标签与埋点里重复出现的同一人数去重，避免对象字段顺序影响结果。
  const counts = new Set<number>();
  // visit 递归读取 node 标签；depth 限制损坏缓存的递归深度，不扫描商品标题或描述。
  const visit = (node: unknown, depth: number): void => {
    if (depth > 12) return;
    if (typeof node === 'string') {
      // match 必须覆盖整个标签，防止把“1.2万人想要”误截取成 2。
      const match = /^([0-9]+)\s*人想要$/.exec(node.trim());
      if (match) {
        // count 是经安全整数校验的人数；真实 0 同样进入集合。
        const count = exactCount(Number(match[1]));
        if (count !== undefined) counts.add(count);
      }
    } else if (node !== null && typeof node === 'object') {
      for (const /* child 是当前待扫描标签节点的数组元素或对象字段值。 */ child of Object.values(node)) {
        visit(child, depth + 1);
      }
    }
  };
  visit(labels, 0);
  return counts.size === 1 ? counts.values().next().value : undefined;
};

/** metricCount 优先校验 item 的 key 字段；仅旧响应缺少此字段时使用 detail，显式无效值不得被旧缓存覆盖。 */
const metricCount = (item: ItemMetricSource, detail: Record<string, unknown>, key: keyof ItemMetrics): number | undefined =>
  exactCount(Object.prototype.hasOwnProperty.call(item, key) ? item[key] : detail[key]);

/** itemMetrics 将 item 的统计 DTO 转为三项 UI 数值；兼容既有本地缓存，不把未知伪造为零，不产生额外平台请求。 */
export const itemMetrics = (item: ItemMetricSource): ItemMetrics => {
  // detail 是需要兼容的旧版本缓存；即便 JSON 损坏，响应顶层的有效指标仍可使用。
  const detail = cachedDetail(item);
  // hasWant 区分明确的统计字段与旧缓存只提供人数标签的情况。
  const hasWant = Object.prototype.hasOwnProperty.call(item, 'want_count') || Object.prototype.hasOwnProperty.call(detail, 'want_count');
  return {
    exposure_count: metricCount(item, detail, 'exposure_count'),
    browse_count: metricCount(item, detail, 'browse_count'),
    want_count: hasWant ? metricCount(item, detail, 'want_count') : cachedWantCount(detail.item_label_data),
  };
};
