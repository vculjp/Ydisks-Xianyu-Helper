import type { CollectedProduct, CollectorSortMode } from './types';

/** normalizedPositivePrice 将平台明确返回的非负价格转换为数值，缺失或非法价格在价格排序时置底。 */
const normalizedPositivePrice = (price: string): number | null => {
  // trimmed 是原价文本去除两侧空白后的格式。
  const trimmed = price.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  // parsed 是通过合法数值格式校验的售价（元）。
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/** sellerSortProducts 对已采集的整个同行店铺结果进行稳定排序，不改变平台原始数据和采集分页。 */
export const sellerSortProducts = (products: readonly CollectedProduct[], mode: CollectorSortMode): CollectedProduct[] => {
  // ordered 是可安全重排的副本；综合排序直接保留平台原始返回顺序。
  const ordered = [...products];
  if (mode === 'default') return ordered;
  if (mode === 'want_desc') {
    // 想要人数 -1 代表接口未返回有效数据，始终排在已知人数之后。
    return ordered.sort(/* left、right 比较已知想要人数，原始顺序作为相同热度的稳定次序。 */ (left, right) => right.wantCount - left.wantCount);
  }
  if (mode === 'newest') {
    // 发布时间 0 代表未知，比任何明确返回的时间都靠后。
    return ordered.sort(/* left、right 比较发布时间（Unix 秒），相同时保留采集顺序。 */ (left, right) => (right.publishTimeUnix ?? 0) - (left.publishTimeUnix ?? 0));
  }
  // direction 决定数值比较方向：降价为 -1，升价为 1。
  const direction = mode === 'price_asc' ? 1 : -1;
  return ordered.sort(/* left、right 按已知价格比较，未知价格无论升降都排在列表最后。 */ (left, right) => {
    // leftPrice 是左侧商品在平台返回的可解析售价（元），缺失时为 null。
    const leftPrice = normalizedPositivePrice(left.price);
    // rightPrice 是右侧商品在平台返回的可解析售价（元），缺失时为 null。
    const rightPrice = normalizedPositivePrice(right.price);
    if (leftPrice === null) return rightPrice === null ? 0 : 1;
    if (rightPrice === null) return -1;
    return direction * (leftPrice - rightPrice);
  });
};
