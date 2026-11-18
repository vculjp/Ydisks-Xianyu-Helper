import { buildCsv, downloadCsv } from '../../../shared/browser/csvDownload';
import type { CollectedProduct } from './types';

/** buildSelectionAnalysisRows 生成包含热度、卖家和完整图片地址的选品分析表格二维数组。 */
export const buildSelectionAnalysisRows = (items: ReadonlyArray<CollectedProduct>): string[][] => {
  // header 是 Excel 可读的中文选品分析表头。
  const header = [
    '商品ID', '商品标题', '售价(元)', '原价(元)', '想要人数', '浏览量',
    '是否包邮', '是否多规格', '地区', '卖家昵称', '卖家ID', '闲鱼商品链接', '商品详情文案', '全部主图URL',
  ];
  // dataRows 将每个采集商品映射为一行字符串数组。
  const dataRows = items.map(/* item 是待导出的单件采集商品。 */ item => [
    item.itemId,
    item.title,
    item.price,
    item.originalPrice,
    String(item.wantCount),
    String(item.browseCount),
    item.isFreeShipping ? '是' : '否',
    item.isMultiSpec ? '是' : '否',
    item.area,
    item.sellerNick,
    item.sellerId,
    item.webUrl,
    item.description || item.title,
    item.imageUrls.join(';'),
  ]);
  return [header, ...dataRows];
};

/** buildLibraryImportTemplateRows 生成可直接用于「本地资源库 → 从 Excel 导入」的标准模板表格行。 */
export const buildLibraryImportTemplateRows = (
  items: ReadonlyArray<CollectedProduct>,
  deliveryTemplateId?: number,
): string[][] => {
  // header 完全对齐本地资源库商品模板导入表头规范（含共享网盘模板变量列）。
  const header = [
    '模板名称', '标题', '描述', '价格', '原价', '库存', '邮费模式', '邮费',
    '图片', '付款发货启用', '付款发货内容', '变量.link',
  ];
  // templateAction 在指定了默认发货模板主键时自动预填 T模板ID。
  const templateAction = deliveryTemplateId && deliveryTemplateId > 0 ? `T${deliveryTemplateId}` : '';
  // rows 将每件采集商品转换为一行待导入模板记录。
  const rows = items.map(/* item 是待转换为铺货模板行的采集商品。 */ item => [
    item.title.slice(0, 100),
    item.title,
    item.description || item.title,
    item.price || '9.90',
    item.originalPrice,
    '5',
    'none',
    '0',
    item.imageUrls.join(';'),
    templateAction ? '是' : '否',
    templateAction,
    '',
  ]);
  return [header, ...rows];
};

/** exportSelectionCsv 下载带 UTF-8 BOM 的选品分析 CSV 表格（Excel 双击直开不乱码）。 */
export const exportSelectionCsv = (items: ReadonlyArray<CollectedProduct>): void => {
  // stamp 是文件名中的日期标记。
  const stamp = new Date().toISOString().slice(0, 10);
  downloadCsv(`闲鱼选品采集_${stamp}_${items.length}件.csv`, buildSelectionAnalysisRows(items));
};

/** exportLibraryImportCsv 下载可直接上传至本地资源库批量导入的铺货模板 CSV。 */
export const exportLibraryImportCsv = (items: ReadonlyArray<CollectedProduct>, deliveryTemplateId?: number): void => {
  // stamp 是文件名中的日期标记。
  const stamp = new Date().toISOString().slice(0, 10);
  downloadCsv(`闲鱼铺货导入表_${stamp}_${items.length}件.csv`, buildLibraryImportTemplateRows(items, deliveryTemplateId));
};

/** previewSelectionCsvText 供单元测试校验 CSV 序列化内容。 */
export const previewSelectionCsvText = (items: ReadonlyArray<CollectedProduct>): string => buildCsv(buildSelectionAnalysisRows(items));
