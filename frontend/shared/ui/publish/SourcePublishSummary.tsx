import type { SourcePublishInfo } from './sourceInfo';
import { sourceCategoryComplete } from './sourceInfo';

/** SourcePublishSummaryProps 表示从原商品详情采集到的发布资料及待核实字段的只读视图。 */
export interface SourcePublishSummaryProps {
  /** source 是原商品平台实际返回的公开发布资料；缺失时不可假装已经采集完整。 */
  source?: SourcePublishInfo;
}

/** SourcePublishSummary 可视化原商品的类目、运费、原库存、规格 SKU 和商品属性，并明确显示未取得的字段。 */
export const SourcePublishSummary = ({ source }: SourcePublishSummaryProps) => {
  if (!source?.itemId) {
    return <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">当前只有商品列表摘要，尚未采集到原商品的完整发布信息。请先补抓详情；风控时需在官方闲鱼完成验证，不会自动重试。</section>;
  }
  // missing 保留接口原本记录的缺失字段，即使已展示若干资料也不能暗示能够无差异复制发布。
  const missing = source.missing ?? [];
  // originalCategoryReady 仅表示原类目拥有平台发布所需三个字段，目标商品是否允许该类目仍需核实。
  const originalCategoryReady = sourceCategoryComplete(source);
  return <section aria-label="原商品发布资料" className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 text-xs text-slate-700">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <strong className="text-sm text-slate-900">原商品发布资料</strong>
      <a className="font-semibold text-sky-700 underline" href={source.webUrl} target="_blank" rel="noreferrer">查看原商品</a>
    </div>
    <div className="grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">
      <div>原商品 ID：<span className="font-semibold">{source.itemId}</span></div>
      <div>类目：<span className="font-semibold">{source.category.catName || '名称待获取'}（{source.category.catId || 'ID 待获取'}）</span></div>
      <div>频道类目 ID：<span className="font-semibold">{source.category.channelCatId || '待获取'}</span></div>
      <div>淘宝类目 ID：{source.category.tbCatId || '平台未返回'}</div>
      <div>原商品公开库存：{source.quantity > 0 ? source.quantity : '待获取'}</div>
      <div>原商品运费：{source.postageMode || '待核实'}{source.postage ? `，金额 ¥${source.postage}` : ''}</div>
      <div>原卖家展示地区：{source.area || '待获取'}（不等于本店发货地）</div>
      <div>类目可复用完整度：{originalCategoryReady ? '字段齐全，仍需核对商品类型' : '不完整，需要人工重新选择'}</div>
    </div>
    {source.specs.length > 0 && <div className="mt-3">
      <strong>原商品规格</strong>
      <p className="mt-1">{source.specs.map(/* spec 汇总一个原生规格维度的所有值。 */ spec => `${spec.name}：${spec.values.map(/* value 提取规格值。 */ value => value.value).join('、')}`).join('；')}</p>
    </div>}
    {source.skus.length > 0 && <div className="mt-3">
      <strong>原 SKU 明细（{source.skus.length} 条）</strong>
      <div className="mt-1 max-h-36 overflow-auto rounded-lg border border-sky-100 bg-white">
        <table className="w-full text-left text-xs">
          <thead><tr><th className="px-2 py-1">组合</th><th className="px-2 py-1">原价</th><th className="px-2 py-1">原库存</th></tr></thead>
          <tbody>{source.skus.map(/* sku、index 是平台真实返回的每个规格组合与顺序。 */ (sku, index) => <tr key={index}><td className="px-2 py-1">{sku.valueLabels.join(' / ')}</td><td className="px-2 py-1">¥{sku.price}</td><td className="px-2 py-1">{sku.quantity}</td></tr>)}</tbody>
        </table>
      </div>
    </div>}
    {source.attributes.length > 0 && <div className="mt-3">
      <strong>原商品公开属性</strong>
      <p className="mt-1">{source.attributes.map(/* item 转换为可读属性名和值。 */ item => `${item.name}：${item.value}`).join('；')}</p>
    </div>}
    <div className={`mt-3 rounded-lg px-3 py-2 ${missing.length ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
      {missing.length ? `仍待核实：${missing.join('、')}。未取得的字段不会自动推断。` : '已保存平台本次返回的发布字段，目标店铺的库存、发货地、类目可用性仍须自行核对。'}
    </div>
  </section>;
};
