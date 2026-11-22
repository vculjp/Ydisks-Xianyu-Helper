/** SourceTransport 是公开商品来源快照在 UI 侧的结构边界。
 * 不跨越 shared API contract 层引用自动生成 schema，避免展示组件耦合服务端接口定义。 */
interface SourceTransport {
  /** item_id 是来源商品标识。 */ item_id?: string;
  /** web_url 是官方原商品链接。 */ web_url?: string;
  /** category 记录可用的原类目四元组，频道缺失时留空。 */ category?: {
    /** cat_id 是平台类目 ID。 */ cat_id?: string;
    /** cat_name 是平台类目名称。 */ cat_name?: string;
    /** channel_cat_id 是频道类目 ID。 */ channel_cat_id?: string;
    /** tb_cat_id 是可选淘宝类目 ID。 */ tb_cat_id?: string;
  };
  /** specs 是详情明确给出的来源规格维度。 */ specs?: Array<{
    /** name 是规格名称。 */ name: string;
    /** values 是规格值。 */ values: Array<{
      /** value 是规格值名称。 */ value: string;
      /** image_url 是原始图片链接。 */ image_url: string;
    }>;
  }>;
  /** skus 是来源商品完整 SKU 信息。 */ skus?: Array<{
    /** value_labels 是对应的规格名称组合。 */ value_labels: string[];
    /** price 是以元为单位的 SKU 售价。 */ price: string;
    /** quantity 是明确给出的 SKU 数量。 */ quantity: number;
  }>;
  /** quantity 是原商品已返回的库存值。 */ quantity?: number;
  /** postage_mode 是原商品实际运费方式。 */ postage_mode?: string;
  /** postage 是原运费金额。 */ postage?: string;
  /** area 是原卖家展示地区，不用于本店的发货地址。 */ area?: string;
  /** attributes 是公开属性列表。 */ attributes?: Array<{
    /** name 是属性名称。 */ name: string;
    /** value 是属性内容。 */ value: string;
  }>;
  /** missing 是明确缺失、需要人工核对的字段名称。 */ missing?: string[];
}

/** CompleteSourceTransport 是发送 API 时所有 JSON 字段均存在的来源快照。 */
type CompleteSourceTransport = Required<Omit<SourceTransport, 'category'>> & {
  /** category 是完整键集合，但字段内容依然允许空串表示待核实。 */
  category: Required<NonNullable<SourceTransport['category']>>;
};

/** SourcePublishInfo 是原商品可验证的发布信息以及哪些字段仍需人工确认的 UI 表示。 */
export interface SourcePublishInfo {
  /** itemId 是原商品数字标识。 */ itemId: string;
  /** webUrl 是原商品官方详情链接。 */ webUrl: string;
  /** category 的三个必需字段齐全才可自动用于发布。 */ category: {
    /** catId 是原类目数字标识。 */ catId: string;
    /** catName 是原类目名称。 */ catName: string;
    /** channelCatId 是原频道类目标识，缺失时不可推测。 */ channelCatId: string;
    /** tbCatId 是平台可选的淘宝类目标识。 */ tbCatId: string;
  };
  /** specs 是原始规格维度及其公开规格图片 URL。 */ specs: Array<{
    /** name 是来源规格维度的实际名称。 */ name: string;
    /** values 是来源规格值及图片。 */ values: Array<{
      /** value 是规格值文字。 */ value: string;
      /** imageUrl 是公开规格图片的 HTTPS 地址。 */ imageUrl: string;
    }>;
  }>;
  /** skus 是原商品公开的完整价格／数量组合；空数组不代表单规格。 */ skus: Array<{
    /** valueLabels 按维度顺序保存原规格值。 */ valueLabels: string[];
    /** price 是 SKU 原售价（元）。 */ price: string;
    /** quantity 是原 SKU 明确返回的库存。 */ quantity: number;
  }>;
  /** quantity 是原商品可用库存；0 表示未知，不是目标店铺的真实库存。 */ quantity: number;
  /** postageMode 是官方明确返回的运费方式，空串表示不确定。 */ postageMode: string;
  /** postage 是原运费，单位元；与运费方式分开保存。 */ postage: string;
  /** area 是原卖家展示地区，不能直接作为本店发布地址。 */ area: string;
  /** attributes 是原详情页可公开访问的商品属性。 */ attributes: Array<{
    /** name 是公开属性名称。 */ name: string;
    /** value 是对应公开属性值。 */ value: string;
  }>;
  /** missing 列出由于原接口没有返回而无法可靠复原的字段。 */ missing: string[];
}

/** sourceFromTransport 归一旧接口、部分响应与完整快照，缺失字段不填猜测值。 */
export const sourceFromTransport = (raw?: SourceTransport): SourcePublishInfo => ({
  itemId: raw?.item_id ?? '', webUrl: raw?.web_url ?? '',
  category: { catId: raw?.category?.cat_id ?? '', catName: raw?.category?.cat_name ?? '', channelCatId: raw?.category?.channel_cat_id ?? '', tbCatId: raw?.category?.tb_cat_id ?? '' },
  specs: (raw?.specs ?? []).map(/* spec 转换原始规格和对应图片链接。 */ spec => ({ name: spec.name, values: (spec.values ?? []).map(/* value 是该规格值。 */ value => ({ value: value.value, imageUrl: value.image_url })) })),
  skus: (raw?.skus ?? []).map(/* sku 转换原始组合及元单位售价。 */ sku => ({ valueLabels: [...(sku.value_labels ?? [])], price: sku.price, quantity: sku.quantity })),
  quantity: raw?.quantity ?? 0, postageMode: raw?.postage_mode ?? '', postage: raw?.postage ?? '', area: raw?.area ?? '',
  attributes: (raw?.attributes ?? []).map(/* attribute 是原详情的公开属性。 */ attribute => ({ name: attribute.name, value: attribute.value })),
  missing: [...(raw?.missing ?? [])],
});

/** sourceToTransport 将原商品快照转换为稳定契约格式，保留待核实状态用于后端二次校验。 */
export const sourceToTransport = (source?: SourcePublishInfo): CompleteSourceTransport => ({
  item_id: source?.itemId ?? '', web_url: source?.webUrl ?? '',
  category: { cat_id: source?.category.catId ?? '', cat_name: source?.category.catName ?? '', channel_cat_id: source?.category.channelCatId ?? '', tb_cat_id: source?.category.tbCatId ?? '' },
  specs: (source?.specs ?? []).map(/* spec 转换来源规格维度。 */ spec => ({ name: spec.name, values: spec.values.map(/* value 保存来源图片 URL 和规格值。 */ value => ({ value: value.value, image_url: value.imageUrl })) })),
  skus: (source?.skus ?? []).map(/* sku 传递该组合对应的实际商品信息。 */ sku => ({ value_labels: [...sku.valueLabels], price: sku.price, quantity: sku.quantity })),
  quantity: source?.quantity ?? 0, postage_mode: source?.postageMode ?? '', postage: source?.postage ?? '', area: source?.area ?? '',
  attributes: (source?.attributes ?? []).map(/* attribute 转换来源公共属性。 */ attribute => ({ name: attribute.name, value: attribute.value })),
  missing: [...(source?.missing ?? [])],
});

/** sourceCategoryComplete 判断原类目是否具备发布需要的三个关键字段。 */
export const sourceCategoryComplete = (source?: SourcePublishInfo): boolean =>
  !!source?.category.catId && !!source.category.catName && !!source.category.channelCatId;
