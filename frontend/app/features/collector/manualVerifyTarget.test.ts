import { describe, expect, it } from 'vitest';
import { selectManualVerifyTarget } from './manualVerifyTarget';

describe('selectManualVerifyTarget', /* 验证人工打开浏览器页面时仅计算目标地址，不访问真实平台。 */ () => {
  it('同行整店选中商品后，应检查商品详情而非卖家主页', /* 验证转存补抓场景选择商品详情页。 */ () => {
    // target 是本地解析结果，不需要发起真实闲鱼平台请求。
    const target = selectManualVerifyTarget('seller', [{ itemId: '101' }, { itemId: '202' }], new Set(['202']), '', '888');
    expect(target).toEqual({ scene: 'detail', targetInput: '202' });
  });

  it('没有选择商品时保持同行店铺验证目标', /* 验证没有可定位商品时仍使用原卖家页面。 */ () => {
    // target 保持既有卖家主页定位逻辑。
    const target = selectManualVerifyTarget('seller', [{ itemId: '101' }], new Set(), '', '888');
    expect(target).toEqual({ scene: 'seller', targetInput: '888' });
  });

  it('单品详情输入保留用户原始 ID 或链接', /* 验证精准商品采集不改变原输入。 */ () => {
    // target 应保留用户粘贴的商品链接，不需要为其他页签改动逻辑。
    const target = selectManualVerifyTarget('detail', [], new Set(), '  https://www.goofish.com/item?id=101  ', '888');
    expect(target).toEqual({ scene: 'detail', targetInput: 'https://www.goofish.com/item?id=101' });
  });

  it('关键词检索保持搜索场景，不误改成商品或卖家', /* 验证关键词采集保留既有搜索场景。 */ () => {
    // target 的 scene 用于服务端在用户已输关键词时打开原搜索页。
    const target = selectManualVerifyTarget('search', [{ itemId: '101' }], new Set(['101']), '', '888');
    expect(target).toEqual({ scene: 'search', targetInput: '888' });
  });
});
