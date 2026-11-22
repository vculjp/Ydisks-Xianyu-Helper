import { describe, expect, it } from 'vitest';
import { sourceCategoryComplete, sourceFromTransport, sourceToTransport } from './sourceInfo';

describe('原商品发布资料快照', /* 覆盖完整来源字段和旧响应中字段缺失的兼容行为。 */ () => {
  it('保留类目 ID、频道、来源链接、运费、规格及组合库存', /* 转存前后不能丢掉重新发布所需信息。 */ () => {
    // source 是真实接口返回格式的完整来源数据。
    const source = sourceFromTransport({
      item_id: '112233', web_url: 'https://www.goofish.com/item?id=112233',
      category: { cat_id: '5', cat_name: '实物类目', channel_cat_id: '6', tb_cat_id: '7' },
      specs: [{ name: '颜色', values: [{ value: '红', image_url: 'https://img.example.test/red.png' }] }],
      skus: [{ value_labels: ['红'], price: '6.00', quantity: 9 }],
      quantity: 9, postage_mode: 'fixed', postage: '3.00', area: '杭州',
      attributes: [{ name: '成色', value: '九成新' }], missing: [],
    });
    expect(sourceCategoryComplete(source)).toBe(true);
    expect(sourceToTransport(source)).toEqual({
      item_id: '112233', web_url: 'https://www.goofish.com/item?id=112233',
      category: { cat_id: '5', cat_name: '实物类目', channel_cat_id: '6', tb_cat_id: '7' },
      specs: [{ name: '颜色', values: [{ value: '红', image_url: 'https://img.example.test/red.png' }] }],
      skus: [{ value_labels: ['红'], price: '6.00', quantity: 9 }],
      quantity: 9, postage_mode: 'fixed', postage: '3.00', area: '杭州',
      attributes: [{ name: '成色', value: '九成新' }], missing: [],
    });
  });

  it('仅有类目 ID 的老商品不会被猜成完整发布类目', /* 未获取的字段需明确暴露为空。 */ () => {
    // source 通过不完整 DTO 构造，不能补出假频道。
    const source = sourceFromTransport({ item_id: '7788', category: { cat_id: '500', cat_name: '', channel_cat_id: '', tb_cat_id: '' } });
    expect(sourceCategoryComplete(source)).toBe(false);
    expect(source.postageMode).toBe('');
    expect(source.skus).toEqual([]);
    expect(sourceToTransport(source).category?.channel_cat_id).toBe('');
  });
});
