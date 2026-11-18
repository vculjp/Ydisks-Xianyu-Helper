// collector 只公开 OpenAPI 生成的全站商品采集传输类型；UI 模型属于 collector feature。
import type { components } from './generated/schema';

/** CollectedItemTransport 表示生成的单件采集商品传输对象。 */
export type CollectedItemTransport = components['schemas']['CollectedItem'];
/** CollectorSearchRequestTransport 表示生成的关键词搜索请求。 */
export type CollectorSearchRequestTransport = components['schemas']['CollectorSearchRequest'];
/** CollectorSearchResponseTransport 表示生成的搜索或店铺商品响应。 */
export type CollectorSearchResponseTransport = components['schemas']['CollectorSearchResponse'];
/** CollectorDetailRequestTransport 表示生成的精准详情采集请求。 */
export type CollectorDetailRequestTransport = components['schemas']['CollectorDetailRequest'];
/** CollectorDetailResponseTransport 表示生成的精准详情采集响应。 */
export type CollectorDetailResponseTransport = components['schemas']['CollectorDetailResponse'];
/** CollectorSellerRequestTransport 表示生成的同行店铺采集请求。 */
export type CollectorSellerRequestTransport = components['schemas']['CollectorSellerRequest'];
/** CollectorAIRewriteRequestTransport 表示生成的 AI 标题文案改写请求。 */
export type CollectorAIRewriteRequestTransport = components['schemas']['CollectorAIRewriteRequest'];
/** CollectorAIRewriteResponseTransport 表示生成的 AI 标题文案改写响应。 */
export type CollectorAIRewriteResponseTransport = components['schemas']['CollectorAIRewriteResponse'];
/** CollectorSaveTemplatesRequestTransport 表示生成的批量转存模板请求。 */
export type CollectorSaveTemplatesRequestTransport = components['schemas']['CollectorSaveTemplatesRequest'];
/** CollectorSaveTemplatesResponseTransport 表示生成的批量转存模板响应。 */
export type CollectorSaveTemplatesResponseTransport = components['schemas']['CollectorSaveTemplatesResponse'];
/** CollectorManualVerifyOpenRequestTransport 表示生成的弹出可见验证窗口请求。 */
export type CollectorManualVerifyOpenRequestTransport = components['schemas']['CollectorManualVerifyOpenRequest'];
/** CollectorManualVerifyOpenResponseTransport 表示生成的弹出可见验证窗口响应。 */
export type CollectorManualVerifyOpenResponseTransport = components['schemas']['CollectorManualVerifyOpenResponse'];
/** CollectorManualVerifyCompleteResponseTransport 表示生成的确认验证并同步完整 Cookie 响应。 */
export type CollectorManualVerifyCompleteResponseTransport = components['schemas']['CollectorManualVerifyCompleteResponse'];
/** CollectorManualVerifyCancelResponseTransport 表示生成的关闭验证窗口响应。 */
export type CollectorManualVerifyCancelResponseTransport = components['schemas']['CollectorManualVerifyCancelResponse'];
