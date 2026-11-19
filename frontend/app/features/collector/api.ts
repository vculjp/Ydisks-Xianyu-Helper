import { contractClient, runContractRequest } from '../../../shared/api-contract/client';
import type {
  CollectedItemTransport,
  CollectorAIRewriteResponseTransport,
  CollectorDetailResponseTransport,
  CollectorManualVerifyCancelResponseTransport,
  CollectorManualVerifyCompleteResponseTransport,
  CollectorManualVerifyOpenResponseTransport,
  CollectorSaveTemplatesResponseTransport,
  CollectorSearchResponseTransport,
} from '../../../shared/api-contract/collector';
import { ApiError, type RequestControlOptions } from '../../../shared/http/client';
import type {
  CollectedProduct,
  CollectorAccountOption,
  CollectorDeliveryTemplateOption,
  CollectorDetailBatchResult,
  CollectorListResult,
  CollectorSaveTemplatesParams,
  CollectorSaveTemplatesSummary,
  CollectorSearchParams,
} from './types';

/** collectorErrorMessage 将 API 异常转换为可直接提示给用户的中文原因。 */
export const collectorErrorMessage = (failure: unknown, fallback: string): string => {
  if (failure instanceof ApiError) {
    return failure.message || fallback;
  }
  return failure instanceof Error ? failure.message : fallback;
};

/** toCollectedProduct 将契约传输商品对象映射为前端 UI 商品模型。 */
const toCollectedProduct = (dto: CollectedItemTransport): CollectedProduct => ({
  itemId: dto.item_id,
  title: dto.title,
  description: dto.description,
  price: dto.price,
  originalPrice: dto.original_price,
  picUrl: dto.pic_url,
  imageUrls: dto.image_urls.length > 0 ? [...dto.image_urls] : (dto.pic_url ? [dto.pic_url] : []),
  area: dto.area,
  sellerId: dto.seller_id,
  sellerNick: dto.seller_nick,
  wantCount: dto.want_count,
  browseCount: dto.browse_count,
  categoryId: dto.category_id,
  isFreeShipping: dto.is_free_shipping,
  isMultiSpec: dto.is_multi_spec,
  hasFullDetail: dto.has_full_detail,
  publishTimeUnix: dto.publish_time_unix,
  webUrl: dto.web_url,
});

/** toListResult 将搜索或店铺响应传输对象转换为前端列表结果。 */
const toListResult = (dto: CollectorSearchResponseTransport): CollectorListResult => ({
  items: dto.items.map(/* item 是传输层的单件采集商品。 */ item => toCollectedProduct(item)),
  pageNumber: dto.page_number,
  hasMore: dto.has_more,
  totalCount: dto.total_count,
  abortedByRisk: dto.aborted_by_risk,
  warning: dto.warning,
});

/** listCollectorAccounts 读取当前用户已启用且存有有效凭证的可选采集账号列表。 */
export const listCollectorAccounts = async (options?: RequestControlOptions): Promise<CollectorAccountOption[]> => {
  // accounts 是后端返回的账号详情摘要数组。
  const accounts = await runContractRequest(
    /* signal 控制账号摘要读取请求的取消生命周期。 */ signal => contractClient.GET('/api/v1/accounts/details', { signal }),
    options,
  );
  return accounts
    .filter(/* account 只保留启用且存有登录 Cookie 的账号。 */ account => account.enabled && account.has_cookie)
    .map(/* account 投影为下拉框选项。 */ account => ({
      id: account.id,
      label: account.remark ? `${account.remark} (${account.nickname || account.id})` : (account.nickname || account.id),
      online: Boolean(account.enabled && account.has_cookie && !account.profile_error),
    }));
};

/** listCollectorDeliveryTemplates 读取已启用且不含未绑定卡密槽位的纯自定义变量发货模板（适合网盘资源）。 */
export const listCollectorDeliveryTemplates = async (options?: RequestControlOptions): Promise<CollectorDeliveryTemplateOption[]> => {
  // response 是发货模板分页摘要。
  const response = await runContractRequest(
    /* signal 控制发货模板列表请求的取消生命周期。 */ signal => contractClient.GET('/api/v1/delivery-templates', { signal }),
    options,
  );
  return (response.data ?? [])
    .filter(/* tpl 只保留已启用且无需额外绑定卡密组 ID 的模板。 */ tpl => tpl.enabled && (tpl.keys ?? []).length === 0)
    .map(/* tpl 转换为前端下拉选项。 */ tpl => ({
      id: tpl.id,
      name: tpl.name,
      customKeys: [...(tpl.custom_keys ?? [])],
    }));
};

/** searchMarketProducts 调用全站关键词商品搜索接口。 */
export const searchMarketProducts = async (
  params: CollectorSearchParams,
  options?: RequestControlOptions,
): Promise<CollectorListResult> => {
  // response 是契约校验后的搜索响应传输对象。
  const response: CollectorSearchResponseTransport = await runContractRequest(
    /* signal 控制关键词搜索请求的超时与取消。 */ signal => contractClient.POST('/api/v1/collector/search', {
      body: {
        cookie_id: params.cookieId,
        keyword: params.keyword,
        page_number: params.pageNumber,
        rows_per_page: params.rowsPerPage,
        sort_mode: params.sortMode,
        min_price: params.minPrice,
        max_price: params.maxPrice,
        publish_days: params.publishDays,
        min_want_count: params.minWantCount,
      },
      signal,
    }),
    { timeoutMs: 60_000, ...options },
  );
  return toListResult(response);
};

/** collectProductDetails 按商品链接或商品 ID 批量抓取完整图文详情。 */
export const collectProductDetails = async (
  cookieId: string,
  inputs: string[],
  options?: RequestControlOptions,
): Promise<CollectorDetailBatchResult> => {
  // response 是详情采集传输响应。
  const response: CollectorDetailResponseTransport = await runContractRequest(
    /* signal 控制批量详情采集的取消信号。 */ signal => contractClient.POST('/api/v1/collector/item-detail', {
      body: { cookie_id: cookieId, inputs },
      signal,
    }),
    { timeoutMs: 120_000, ...options },
  );
  return {
    items: response.items.map(/* item 是成功提取详情的单件商品。 */ item => toCollectedProduct(item)),
    errors: response.errors.map(/* errItem 是单个失败条目的原因记录。 */ errItem => ({
      itemId: errItem.item_id,
      message: errItem.message,
    })),
    abortedByRisk: response.aborted_by_risk,
  };
};

/** collectSellerProducts 抓取对标同行店铺的在售商品列表。 */
export const collectSellerProducts = async (
  cookieId: string,
  sellerInput: string,
  maxPages: number,
  options?: RequestControlOptions,
): Promise<CollectorListResult> => {
  // response 是店铺商品分页传输响应。
  const response: CollectorSearchResponseTransport = await runContractRequest(
    /* signal 控制店铺在售列表请求的取消信号。 */ signal => contractClient.POST('/api/v1/collector/seller-items', {
      body: { cookie_id: cookieId, seller_input: sellerInput, max_pages: maxPages },
      signal,
    }),
    { timeoutMs: 120_000, ...options },
  );
  return toListResult(response);
};

/** rewriteProductWithAI 调用系统大模型接口对商品标题与描述进行防重改写。 */
export const rewriteProductWithAI = async (
  title: string,
  description: string,
  customInstruction: string,
  options?: RequestControlOptions,
): Promise<{ /** title 是改写后的新标题。 */ title: string; /** description 是改写后的新描述。 */ description: string }> => {
  // response 是 AI 改写传输响应。
  const response: CollectorAIRewriteResponseTransport = await runContractRequest(
    /* signal 控制大模型改写请求的取消与超时。 */ signal => contractClient.POST('/api/v1/collector/ai-rewrite', {
      body: { title, description, custom_instruction: customInstruction },
      signal,
    }),
    { timeoutMs: 60_000, ...options },
  );
  return { title: response.title, description: response.description };
};

/** saveProductsToTemplates 将勾选的采集商品下载主图并批量写入本地资源库商品模板。 */
export const saveProductsToTemplates = async (
  params: CollectorSaveTemplatesParams,
  options?: RequestControlOptions,
): Promise<CollectorSaveTemplatesSummary> => {
  // response 是批量转存传输响应。
  const response: CollectorSaveTemplatesResponseTransport = await runContractRequest(
    /* signal 控制长耗时下图与模板写入请求的取消信号。 */ signal => contractClient.POST('/api/v1/collector/save-templates', {
      body: {
        cookie_id: params.cookieId,
        fetch_detail_if_missing: params.fetchDetailIfMissing,
        enable_ai_rewrite: params.enableAiRewrite,
        custom_instruction: params.customInstruction,
        price_mode: params.priceMode,
        price_value: params.priceValue,
        quantity: params.quantity,
        postage_mode: params.postageMode,
        delivery_template_id: params.deliveryTemplateId,
        custom_variables: params.customVariables,
        items: params.items.map(/* item 转换为后端接收的待保存条目。 */ item => ({
          item_id: item.itemId,
          title: item.title,
          description: item.description,
          price: item.price,
          original_price: item.originalPrice,
          image_urls: item.imageUrls.length > 0 ? item.imageUrls : (item.picUrl ? [item.picUrl] : []),
          has_full_detail: item.hasFullDetail,
        })),
      },
      signal,
    }),
    { timeoutMs: 180_000, ...options },
  );
  return {
    total: response.total,
    succeeded: response.succeeded,
    failed: response.failed,
    abortedByRisk: response.aborted_by_risk,
    results: response.results.map(/* row 转换单件商品的转存结果。 */ row => ({
      itemId: row.item_id,
      title: row.title,
      success: row.success,
      templateId: row.template_id,
      imageCount: row.image_count,
      errorReason: row.error,
    })),
  };
};

/** openManualVerifyWindow 弹出注入当前账号登录态的可见闲鱼网页窗口供用户手动滑过验证。 */
export const openManualVerifyWindow = async (
  cookieId: string,
  scene: string,
  keyword: string,
  targetId: string,
  options?: RequestControlOptions,
): Promise<{ /** targetUrl 是已在桌面窗口打开的闲鱼网址。 */ targetUrl: string }> => {
  // response 是打开可见验证窗口的契约响应。
  const response: CollectorManualVerifyOpenResponseTransport = await runContractRequest(
    /* signal 控制打开桌面浏览器窗口请求的超时与取消。 */ signal => contractClient.POST('/api/v1/collector/manual-verify/open', {
      body: {
        cookie_id: cookieId,
        scene,
        keyword,
        target_id: targetId,
      },
      signal,
    }),
    { timeoutMs: 45_000, ...options },
  );
  return { targetUrl: response.target_url };
};

/** completeManualVerifyWindow 确认用户已在桌面窗口完成手动验证，自动读取完整 Cookie Jar 快照落库并关闭窗口。 */
export const completeManualVerifyWindow = async (
  cookieId: string,
  options?: RequestControlOptions,
): Promise<{ /** cookieId 是已恢复的账号标识。 */ cookieId: string; /** syncedCount 是已同步保存的完整 Cookie 项数。 */ syncedCount: number }> => {
  // response 是同步完整 Cookie 快照的契约响应。
  const response: CollectorManualVerifyCompleteResponseTransport = await runContractRequest(
    /* signal 控制提取并保存窗口 Cookie 快照请求的取消生命周期。 */ signal => contractClient.POST('/api/v1/collector/manual-verify/complete', {
      body: { cookie_id: cookieId },
      signal,
    }),
    { timeoutMs: 30_000, ...options },
  );
  return { cookieId: response.cookie_id, syncedCount: response.synced_count };
};

/** cancelManualVerifyWindow 关闭当前账号打开中的桌面验证窗口而不改动已存凭证。 */
export const cancelManualVerifyWindow = async (
  cookieId: string,
  options?: RequestControlOptions,
): Promise<boolean> => {
  // response 是关闭验证窗口的契约响应。
  const response: CollectorManualVerifyCancelResponseTransport = await runContractRequest(
    /* signal 控制关闭验证窗口请求的取消生命周期。 */ signal => contractClient.POST('/api/v1/collector/manual-verify/cancel', {
      body: { cookie_id: cookieId },
      signal,
    }),
    { timeoutMs: 15_000, ...options },
  );
  return response.canceled;
};
