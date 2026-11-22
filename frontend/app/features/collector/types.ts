/** CollectorTab 表示普通采集和本地雷达工作台入口。 */
export type CollectorTab = 'search' | 'detail' | 'seller' | 'radar';

/** CollectorSortMode 表示全站搜索支持的热度、时间与价格排序枚举。 */
export type CollectorSortMode = 'default' | 'want_desc' | 'newest' | 'price_asc' | 'price_desc';

/** CollectorPriceMode 表示转存为商品模板时的定价换算模式。 */
export type CollectorPriceMode = 'keep' | 'offset' | 'fixed';

import type { SourcePublishInfo } from '../../../shared/ui/publish/sourceInfo';

/** CollectorAccountOption 描述可供用户选择执行采集的闲鱼账号摘要。 */
export interface CollectorAccountOption {
  /** id 是账号唯一标识（cookie_id）。 */
  id: string;
  /** label 是优先使用备注或昵称组合的可读名称。 */
  label: string;
  /** online 表示账号当前运行时是否处于在线状态。 */
  online: boolean;
}

/** CollectorDeliveryTemplateOption 描述转存模板时可选绑定的自动发货模板。 */
export interface CollectorDeliveryTemplateOption {
  /** id 是发货模板主键。 */
  id: number;
  /** name 是发货模板名称。 */
  name: string;
  /** customKeys 是模板需要填写的自定义变量键列表（如 link）。 */
  customKeys: string[];
}

/** CollectedProduct 是前端列表与详情编辑弹窗使用的商品模型。 */
export interface CollectedProduct {
  /** itemId 是闲鱼商品唯一数字标识。 */
  itemId: string;
  /** title 是当前标题（可能已被用户或 AI 修改）。 */
  title: string;
  /** description 是当前详情文案。 */
  description: string;
  /** price 是当前展示售价文本（元）。 */
  price: string;
  /** originalPrice 是划线原价文本（元）。 */
  originalPrice: string;
  /** picUrl 是主图封面 HTTPS 地址。 */
  picUrl: string;
  /** imageUrls 是全部已采集主图地址列表（最多 9 张）。 */
  imageUrls: string[];
  /** area 是商品所在地区文本。 */
  area: string;
  /** sellerId 是卖家数字 userId。 */
  sellerId: string;
  /** sellerNick 是卖家展示昵称。 */
  sellerNick: string;
  /** wantCount 是想要人数指标，-1 表示平台未返回有效数值。 */
  wantCount: number;
  /** browseCount 是浏览次数指标。 */
  browseCount: number;
  /** categoryId 是平台原始类目 ID。 */
  categoryId: string;
  /** source 是从原闲鱼商品详情核实的完整发布资料快照，列表摘要可能不具备。 */
  source?: SourcePublishInfo;
  /** isFreeShipping 表示是否包邮。 */
  isFreeShipping: boolean;
  /** isMultiSpec 表示是否包含多规格。 */
  isMultiSpec: boolean;
  /** hasFullDetail 表示是否已拉取完整详情文案与多张原图。 */
  hasFullDetail: boolean;
  /** publishTimeUnix 是后端观测到的商品发布时间（Unix 秒），未知时为 0。 */
  publishTimeUnix?: number;
  /** webUrl 是闲鱼网页版商品链接。 */
  webUrl: string;
}

/** CollectorSearchParams 描述全站关键词挖品表单参数。 */
export interface CollectorSearchParams {
  /** cookieId 是用户选定的采集账号标识。 */
  cookieId: string;
  /** keyword 是非空搜索词。 */
  keyword: string;
  /** pageNumber 是从 1 开始的分页页号。 */
  pageNumber: number;
  /** rowsPerPage 是单页条数预算。 */
  rowsPerPage: number;
  /** sortMode 是排序策略。 */
  sortMode: CollectorSortMode;
  /** minPrice 是最低价过滤文本。 */
  minPrice: string;
  /** maxPrice 是最高价过滤文本。 */
  maxPrice: string;
  /** publishDays 是近 N 天发布过滤（0 为不限）。 */
  publishDays: number;
  /** minWantCount 是最低想要人数过滤阈值（0 为不限）。 */
  minWantCount: number;
}

/** CollectorListResult 是关键词搜索或同行店铺采集的列表结果。 */
export interface CollectorListResult {
  /** items 是当前页商品集合。 */
  items: CollectedProduct[];
  /** pageNumber 是当前页码。 */
  pageNumber: number;
  /** hasMore 表示是否仍有后续分页。 */
  hasMore: boolean;
  /** totalCount 是总条数估计值。 */
  totalCount: number;
  /** abortedByRisk 表示多页拉取时是否因平台风控提前熔断。 */
  abortedByRisk: boolean;
  /** warning 是提前中止时的提醒文案。 */
  warning: string;
}

/** CollectorDetailBatchError 记录单品精准采集失败项的原因。 */
export interface CollectorDetailBatchError {
  /** itemId 是识别出的目标商品 ID。 */
  itemId: string;
  /** message 是失败说明。 */
  message: string;
}

/** CollectorDetailBatchResult 是单品或多链接精准详情采集的结果。 */
export interface CollectorDetailBatchResult {
  /** items 是成功提取完整详情的商品列表。 */
  items: CollectedProduct[];
  /** errors 是单品失败记录列表。 */
  errors: CollectorDetailBatchError[];
  /** abortedByRisk 表示是否因风控立即终止剩余项。 */
  abortedByRisk: boolean;
}

/** CollectorSaveTemplatesParams 描述批量转存到本地资源库商品模板的配置。 */
export interface CollectorSaveTemplatesParams {
  /** cookieId 是按需补抓缺失详情时使用的采集账号标识。 */
  cookieId: string;
  /** fetchDetailIfMissing 表示缺少完整多图或文案时是否先自动补抓详情。 */
  fetchDetailIfMissing: boolean;
  /** enableAiRewrite 表示入库前是否自动调用系统 AI 做防重改写。 */
  enableAiRewrite: boolean;
  /** customInstruction 是附加的 AI 改写风格要求。 */
  customInstruction: string;
  /** priceMode 是定价换算策略。 */
  priceMode: CollectorPriceMode;
  /** priceValue 是加减价差额或固定售价文本。 */
  priceValue: string;
  /** quantity 是默认上架库存。 */
  quantity: number;
  /** postageMode 是邮费方式（none 无需邮寄 / free 包邮）。 */
  postageMode: 'none' | 'free' | 'source';
  /** deliveryTemplateId 是可选自动绑定的发货模板 ID（0 表示不绑定）。 */
  deliveryTemplateId: number;
  /** customVariables 是绑定发货模板时填充的自定义变量键值。 */
  customVariables: Record<string, string>;
  /** items 是选中的待转存商品快照。 */
  items: CollectedProduct[];
}

/** SavedTemplateItemOutcome 描述单条转存为本地模板的结果。 */
export interface SavedTemplateItemOutcome {
  /** itemId 是源商品标识。 */
  itemId: string;
  /** title 是最终落库标题。 */
  title: string;
  /** success 表示是否转存成功。 */
  success: boolean;
  /** templateId 是创建成功后的本地商品模板 ID。 */
  templateId: number;
  /** imageCount 是成功下载并关联的图片张数。 */
  imageCount: number;
  /** errorReason 是失败时的具体原因文本。 */
  errorReason: string;
}

/** CollectorSaveTemplatesSummary 汇总整批转存商品模板的统计与明细。 */
export interface CollectorSaveTemplatesSummary {
  /** total 是提交总件数。 */
  total: number;
  /** succeeded 是成功创建模板件数。 */
  succeeded: number;
  /** failed 是失败件数。 */
  failed: number;
  /** abortedByRisk 表示补抓详情时是否触发了风控熔断。 */
  abortedByRisk: boolean;
  /** results 是逐件转存明细。 */
  results: SavedTemplateItemOutcome[];
}
