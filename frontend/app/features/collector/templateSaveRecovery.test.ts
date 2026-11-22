import { describe, expect, it } from 'vitest';
import { classifyTemplateSaveRecovery, incompleteDescriptionItems } from './templateSaveRecovery';
import type { CollectorSaveTemplatesSummary } from './types';

/** makeSummary 仅构造前端本地测试的转存结果，绝不访问闲鱼平台。 */
const makeSummary = (message: string, abortedByRisk = true): CollectorSaveTemplatesSummary => ({
  total: 2,
  succeeded: 0,
  failed: 2,
  abortedByRisk,
  results: [
    { itemId: 'item-1', title: '测试商品', success: false, templateId: 0, imageCount: 0, errorReason: message },
    { itemId: 'item-2', title: '另一个商品', success: false, templateId: 0, imageCount: 0, errorReason: '本批次已安全停止，本商品未执行，请人工核对' },
  ],
});

describe('classifyTemplateSaveRecovery', /* 验证任务冲突和平台验证各自显示准确恢复指导。 */ () => {
  it('已有同行整店采集占用时只提示任务冲突', /* 验证截图中的实际失败原因归类为 busy。 */ () => {
    expect(classifyTemplateSaveRecovery(makeSummary('补抓商品详情失败：已有采集操作正在运行，请等待完成并核对状态后再手动操作'))).toBe('busy');
  });

  it('RGV587 风控错误需要单独说明，不等同本地任务繁忙', /* 验证不误将平台风控归类为本地锁竞争。 */ () => {
    expect(classifyTemplateSaveRecovery(makeSummary('补抓商品详情失败：RGV587_ERROR'))).toBe('risk');
  });

  it('普通失败不展示任务冲突恢复入口', /* 验证只对被服务端熔断的异常提供特殊恢复流程。 */ () => {
    expect(classifyTemplateSaveRecovery(makeSummary('商品没有任何可用主图链接', false))).toBe(null);
    expect(classifyTemplateSaveRecovery(makeSummary('图片下载失败'))).toBe(null);
  });
});

describe('incompleteDescriptionItems', /* 验证只有标题的摘要不会被误判为可发布的完整商品内容。 */ () => {
  it('缺描述与标题复制的假描述都应提示补全', /* 防止选择跳过补抓时再次生成标题式商品。 */ () => {
    // items 构造列表摘要与已经填写真实详情的三个商品。
    const items = [
      { itemId: '1', title: '电影标题A', description: '' },
      { itemId: '2', title: '电影标题B', description: '电影标题B' },
      { itemId: '3', title: '电影标题C', description: '真实商品介绍，包含交付方式和其他必要说明' },
    ];
    expect(incompleteDescriptionItems(items)).toEqual(['1', '2']);
  });
});
