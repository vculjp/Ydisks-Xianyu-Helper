import { afterEach, expect, test, vi } from 'vitest';
import { getItemDetail, getItems, refreshItemMetrics } from './api';

afterEach(/* 当前回调清理 HTTP 替身，不保留测试间的商品响应。 */ () => vi.unstubAllGlobals());

test('商品列表适配保留真实零并从旧缓存提取想要人数，未知和错误类型不伪造零', /* 当前回调只替换 HTTP 传输，执行真实契约客户端与 feature adapter。 */ async () => {
  // fetchMock 是唯一 HTTP 边界替身，所有响应均为人工构造且不包含平台凭证。
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
    { cookie_id: 'account', item_id: 'known', exposure_count: 125, browse_count: 0, want_count: 7 },
    { cookie_id: 'account', item_id: 'legacy', item_detail: JSON.stringify({ item_label_data: { labelData: { r3: { tagList: [{ data: { content: '31人想要' } }] } } } }) },
    { cookie_id: 'account', item_id: 'unknown', item_detail: '{}' },
    { cookie_id: 'account', item_id: 'broken', item_detail: 'not-json' },
    { cookie_id: 'account', item_id: 'invalid', exposure_count: null, browse_count: -1, want_count: false },
    { cookie_id: 'account', item_id: 'zero', item_detail: '{"exposure_count":0,"browse_count":0,"want_count":0}' },
  ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  // items 是经过真实 API adapter 归一的 UI 商品模型。
  const items = await getItems('account');
  expect(items[0]).toMatchObject({ exposure_count: 125, browse_count: 0, want_count: 7 });
  expect(items[1]).toMatchObject({ exposure_count: undefined, browse_count: undefined, want_count: 31 });
  expect(items[2]).toMatchObject({ exposure_count: undefined, browse_count: undefined, want_count: undefined });
  expect(items[3]).toMatchObject({ exposure_count: undefined, browse_count: undefined, want_count: undefined });
  expect(items[4]).toMatchObject({ exposure_count: undefined, browse_count: undefined, want_count: undefined });
  expect(items[5]).toMatchObject({ exposure_count: 0, browse_count: 0, want_count: 0 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('本地商品详情适配与列表使用相同统计语义且只读取一次', /* 当前回调验证编辑器读取详情不会隐式同步或请求逐商品平台统计。 */ async () => {
  // fetchMock 返回仅携带旧详情缓存的本地 HTTP 响应。
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    cookie_id: 'account', item_id: 'item', item_detail: '{"item_label_data":{"content":"0人想要"}}',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  // item 是详情接口归一后的 UI 模型，旧标签中的零必须保持可见。
  const item = await getItemDetail('account', 'item');
  expect(item).toMatchObject({ exposure_count: undefined, browse_count: undefined, want_count: 0 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('只有显式单件刷新才POST指标接口，成功返回真实零，失败不自动重试', /* 当前回调验证用户单件动作的请求边界与错误行为。 */ async () => {
  // fetchMock 依次模拟一次成功与一次平台拒绝，均不连接真实平台。
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, cookie_id: 'account', item_id: 'item', browse_count: 0, want_count: 7 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'item_metrics_refresh_failed', message: '商品指标读取失败' }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  // item 是单件刷新返回的可直接替换表格行的 UI 模型。
  const item = await refreshItemMetrics('account', 'item');
  expect(item).toMatchObject({ browse_count: 0, want_count: 7, exposure_count: undefined });
  // request 是契约客户端构造的唯一 POST，不包含列表或多商品参数。
  const request = fetchMock.mock.calls[0][0] as Request;
  expect(request.method).toBe('POST');
  expect(new URL(request.url).pathname).toBe('/api/v1/items/account/item/metrics/refresh');
  await expect(refreshItemMetrics('account', 'item')).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
