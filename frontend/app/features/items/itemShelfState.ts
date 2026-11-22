import type { Item } from './api';

// itemShelfState 先解析助手已明确操作过的货架标记；缺失时回退到列表同步的 item_status：列表接口固定
// 请求“在售”分组，因此 item_status 为 0 表示平台上正在出售。
export const itemShelfState = (item: Pick<Item, 'item_detail'>): 'on' | 'off' | 'unknown' => {
  try {
    // detail 是本地保存的商品非敏感扩展对象。
    const detail: unknown = JSON.parse(item.item_detail || '{}');
    if (detail && typeof detail === 'object' && 'shelf_state' in detail) {
      // state 是经平台回执确认后写入的字符串。
      const state = (detail as { /** shelf_state 是最近一次平台确认的上下架标记。 */ shelf_state?: unknown }).shelf_state;
      if (state === 'on' || state === 'off') return state;
    }
    if (detail && typeof detail === 'object' && (detail as { /** item_status 是列表卡片同步的平台状态整数。 */ item_status?: unknown }).item_status === 0) {
      return 'on';
    }
  } catch {
    // 历史扩展字段格式不规范时保持未知状态，不作任何上下架推断。
  }
  return 'unknown';
};
