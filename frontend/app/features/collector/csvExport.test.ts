import { describe, expect, test } from 'vitest';
import { buildLibraryImportTemplateRows, buildSelectionAnalysisRows, previewSelectionCsvText } from './csvExport';
import type { CollectedProduct } from './types';

// sampleItem 是单测复用的采集商品夹具。
const sampleItem: CollectedProduct = {
  itemId: '1099053019895',
  title: 'Excel常用函数速查手册',
  description: '高清整理，拍下自动发',
  price: '9.90',
  originalPrice: '19.90',
  picUrl: 'https://img.alicdn.com/1.jpg',
  imageUrls: ['https://img.alicdn.com/1.jpg', 'https://img.alicdn.com/2.jpg'],
  area: '浙江 杭州',
  sellerId: '2177750131',
  sellerNick: '土豆ai',
  wantCount: 168,
  browseCount: 920,
  categoryId: '50023914',
  isFreeShipping: true,
  isMultiSpec: false,
  hasFullDetail: true,
  webUrl: 'https://www.goofish.com/item?id=1099053019895',
};

describe('collector csvExport', /* 验证选品分析表与资源库铺货导入表两套导出列映射。 */ () => {
  test('选品分析表格包含想要人数、卖家信息和分号拼接主图', /* 校验首行表头与首条数据列对齐。 */ () => {
    // rows 是生成的二维数组。
    const rows = buildSelectionAnalysisRows([sampleItem]);
    expect(rows).toHaveLength(2);
    expect(rows[0][4]).toBe('想要人数');
    expect(rows[1][4]).toBe('168');
    expect(rows[1][13]).toBe('https://img.alicdn.com/1.jpg;https://img.alicdn.com/2.jpg');
    expect(previewSelectionCsvText([sampleItem])).toContain('"Excel常用函数速查手册"');
  });

  test('资源库铺货导入模板表自动预填共享网盘发货模板动作', /* 校验有默认发货模板主键时写入 T1 与无需邮寄。 */ () => {
    // rows 是生成的资源库导入格式行。
    const rows = buildLibraryImportTemplateRows([sampleItem], 1);
    expect(rows[0]).toContain('变量.link');
    expect(rows[1][6]).toBe('none');
    expect(rows[1][9]).toBe('是');
    expect(rows[1][10]).toBe('T1');
  });
});
