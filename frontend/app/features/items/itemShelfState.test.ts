import { describe, expect, test } from 'vitest';
import { itemShelfState } from './itemShelfState';
import type { Item } from './api';

describe('商品货架状态展示', /* itemShelfStateSuite 保证仅展示明确确认的上下架状态。 */ () => {
  test('识别上下架状态且忽略平台不确定的整数状态码', /* itemShelfStatesCase 测试显式和未知状态。 */ () => {
    expect(itemShelfState({ item_detail: '{"shelf_state":"off"}' } as Item)).toBe('off');
    expect(itemShelfState({ item_detail: '{"shelf_state":"on"}' } as Item)).toBe('on');
    expect(itemShelfState({ item_detail: '{"item_status":0}' } as Item)).toBe('unknown');
    expect(itemShelfState({ item_detail: '{invalid' } as Item)).toBe('unknown');
  });
});
