import { expect, test } from 'vitest';
import { itemMetrics } from './itemMetrics';

test('统计解析保持顶层DTO优先、零值与未知，并拒绝坏缓存和近似人数', /* 当前回调验证表格可直接调用的公开解析函数，不需要任何请求或状态。 */ () => {
  expect(itemMetrics({ exposure_count: 0, browse_count: 7, want_count: 0, item_detail: '{"want_count":31}' })).toEqual({
    exposure_count: 0, browse_count: 7, want_count: 0,
  });
  expect(itemMetrics({ item_detail: '{"exposure_count":-1,"browse_count":1.5,"want_count":0}' })).toEqual({
    exposure_count: undefined, browse_count: undefined, want_count: 0,
  });
  expect(itemMetrics({ item_detail: '{"exposure_count":"7","browse_count":null,"want_count":false}' })).toEqual({
    exposure_count: undefined, browse_count: undefined, want_count: undefined,
  });
  expect(itemMetrics({ item_detail: '{"exposure_count":9007199254740991,"browse_count":9007199254740992}' })).toEqual({
    exposure_count: 9007199254740991, browse_count: undefined, want_count: undefined,
  });
  expect(itemMetrics({ item_detail: '{"item_label_data":{"tagList":[{"data":{"content":"0人想要"}}]}}' }).want_count).toBe(0);
  expect(itemMetrics({ item_detail: '{"item_label_data":["7人想要","7人想要"]}' }).want_count).toBe(7);
  expect(itemMetrics({ item_detail: '{"item_label_data":["7人想要","8人想要"]}' }).want_count).toBeUndefined();
  expect(itemMetrics({ item_detail: '{"item_label_data":{"content":"1.2万人想要"}}' }).want_count).toBeUndefined();
  expect(itemMetrics({ item_detail: '{"title":"7人想要"}' }).want_count).toBeUndefined();
  expect(itemMetrics({ item_detail: '{"want_count":null,"item_label_data":{"content":"7人想要"}}' }).want_count).toBeUndefined();
  expect(itemMetrics({ item_detail: 'not-json', browse_count: 0 })).toEqual({
    exposure_count: undefined, browse_count: 0, want_count: undefined,
  });
  expect(itemMetrics({ item_detail: '[]' })).toEqual({
    exposure_count: undefined, browse_count: undefined, want_count: undefined,
  });
});
