import { describe, expect, it } from 'vitest';
import { sellerSortProducts } from './sellerSort';
import type { CollectedProduct, CollectorSortMode } from './types';

// originalItems 模拟同行前 3 页已汇总的商品数据：未知热度用 -1 表示，未知发布时间用 0 表示。
const originalItems = [
  { itemId: 'page1-unknown', wantCount: -1, price: '', publishTimeUnix: 0 },
  { itemId: 'page1-low', wantCount: 8, price: '50.00', publishTimeUnix: 1700000000 },
  { itemId: 'page2-high', wantCount: 100, price: '5.50', publishTimeUnix: 1800000000 },
  { itemId: 'page2-tie', wantCount: 100, price: '5.50', publishTimeUnix: 1750000000 },
  { itemId: 'page3-middle', wantCount: 50, price: '20', publishTimeUnix: 0 },
] as CollectedProduct[];

/** ids 将排序结果投影为 ID，验证跨页稳定顺序而不依赖展示文案。 */
const ids = (mode: CollectorSortMode): string[] =>
  sellerSortProducts(originalItems, mode).map(/* item 提取此商品的跨页原始 ID。 */ item => item.itemId);

describe('同行整店采集排序', /* 只排序已汇总商品，绝不触发额外平台请求。 */ () => {
  it('默认想要人数降序，跨页统一比较，同值保持采集顺序', /* 未知人数必须最后。 */ () => {
    expect(ids('want_desc')).toEqual(['page2-high', 'page2-tie', 'page3-middle', 'page1-low', 'page1-unknown']);
  });
  it('综合排序保留平台原始采集顺序', /* 让用户可切回店铺原有排序。 */ () => {
    expect(ids('default')).toEqual(originalItems.map(/* item 读取平台初始顺序。 */ item => item.itemId));
  });
  it('最新发布优先且未知时间靠后，未知时间之间保持稳定', /* 不凭热度推断发布日期。 */ () => {
    expect(ids('newest')).toEqual(['page2-high', 'page2-tie', 'page1-low', 'page1-unknown', 'page3-middle']);
  });
  it('价格升降都把缺失价格排在最后', /* 防止未知价格被误认为零元。 */ () => {
    expect(ids('price_asc')).toEqual(['page2-high', 'page2-tie', 'page3-middle', 'page1-low', 'page1-unknown']);
    expect(ids('price_desc')).toEqual(['page1-low', 'page3-middle', 'page2-high', 'page2-tie', 'page1-unknown']);
  });
  it('不修改原数组，重复切换无需重新采集', /* 表格和导出共用副本而不影响商品状态。 */ () => {
    // before 是原始 ID 顺序的只读快照。
    const before = originalItems.map(/* item 记录采集到的稳定顺序。 */ item => item.itemId);
    sellerSortProducts(originalItems, 'want_desc');
    sellerSortProducts(originalItems, 'default');
    expect(originalItems.map(/* item 验证未被更改。 */ item => item.itemId)).toEqual(before);
  });
});
