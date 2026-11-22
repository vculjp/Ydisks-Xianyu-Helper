import type { CollectedProduct, CollectorTab } from './types';

/** selectManualVerifyTarget 根据当前采集模式与已勾选商品选择真实失败场景的官方页面，不触发任何平台请求。 */
export const selectManualVerifyTarget = (
  tab: CollectorTab,
  items: Pick<CollectedProduct, 'itemId'>[],
  selectedIds: ReadonlySet<string>,
  detailInput: string,
  sellerInput: string,
): { /** scene 是需要打开的闲鱼官方页面类型。 */ scene: CollectorTab; /** targetInput 是对应商品 ID 或卖家标识。 */ targetInput: string } => {
  // selectedDetail 是此次用户实际选中、可能在转存补抓详情时触发风控的首件商品。
  const selectedDetail = items.find(/* item 检查当前商品是否被用户选入转存批次。 */ item => selectedIds.has(item.itemId));
  // scene 在同行整店勾选商品后切为详情，避免把详情风控错误导向不相关的卖家主页。
  const scene = tab === 'seller' && selectedDetail ? 'detail' : tab;
  // targetInput 仅使用已知商品 ID 或用户输入，绝不包含平台登录凭证。
  const targetInput = scene === 'detail' ? (selectedDetail?.itemId ?? detailInput.trim()) : sellerInput.trim();
  return { scene, targetInput };
};
