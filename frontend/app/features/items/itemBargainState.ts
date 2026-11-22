import type { Item } from './api';

// itemBargainEnabled 判断商品在闲鱼平台是否已开启“2 人小刀”。平台详情在商品标签
// item_label_data.labelData.<分组>.tagList 中提供“2人小刀价”标签，标签存在即视为已开启。
export const itemBargainEnabled = (item: Pick<Item, 'item_detail'>): boolean => {
  try {
    const detail: unknown = JSON.parse(item.item_detail || '{}');
    if (!detail || typeof detail !== 'object') return false;
    // bargain_state 是本地切换后平台确认写入的显式状态，优先于列表标签快照，避免切换后仍显示旧状态。
    const bargainState = (detail as { bargain_state?: unknown }).bargain_state;
    if (bargainState === true) return true;
    if (bargainState === false) return false;
    const labelData = (detail as { item_label_data?: { labelData?: unknown } }).item_label_data?.labelData;
    if (!labelData || typeof labelData !== 'object') return false;
    for (const group of Object.values(labelData)) {
      const tagList = (group as { tagList?: unknown })?.tagList;
      if (!Array.isArray(tagList)) continue;
      for (const tag of tagList) {
        if ((tag as { data?: { content?: string } })?.data?.content === '2人小刀价') return true;
      }
    }
  } catch {
    // 历史扩展字段格式不规范时按未开启处理，不猜测状态。
  }
  return false;
};
