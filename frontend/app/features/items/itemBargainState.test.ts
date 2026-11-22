import { describe, expect, test } from 'vitest';
import { itemBargainEnabled } from './itemBargainState';
import type { Item } from './api';

describe('商品 2 人小刀状态', /* itemBargainStateSuite 保证显式状态优先且标签回退可解析。 */ () => {
  test('显式 bargain_state 优先于列表标签快照', /* explicitBargainStateCase 验证本地确认后的状态不再被旧标签覆盖。 */ () => {
    // labelItem 同时带“2人小刀价”标签和显式关闭状态，必须按显式关闭处理。
    expect(itemBargainEnabled({ item_detail: '{"bargain_state":false,"item_label_data":{"labelData":{"r3":{"tagList":[{"data":{"content":"2人小刀价"}}]}}}}' } as Item)).toBe(false);
    // offItem 只有显式关闭状态，不带标签。
    expect(itemBargainEnabled({ item_detail: '{"bargain_state":false}' } as Item)).toBe(false);
    // onItem 只有显式开启状态。
    expect(itemBargainEnabled({ item_detail: '{"bargain_state":true}' } as Item)).toBe(true);
  });

  test('无显式状态时回退到平台“2人小刀价”标签', /* labelFallbackCase 验证历史同步数据仍能正确识别。 */ () => {
    expect(itemBargainEnabled({ item_detail: '{"item_label_data":{"labelData":{"r3":{"tagList":[{"data":{"content":"2人小刀价"}}]}}}}' } as Item)).toBe(true);
    expect(itemBargainEnabled({ item_detail: '{"item_label_data":{"labelData":{"r3":{"tagList":[{"data":{"content":"其它标签"}}]}}}}' } as Item)).toBe(false);
    expect(itemBargainEnabled({ item_detail: '{}' } as Item)).toBe(false);
    expect(itemBargainEnabled({ item_detail: '{invalid' } as Item)).toBe(false);
  });
});
