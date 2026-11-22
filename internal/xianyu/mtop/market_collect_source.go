package mtop

import (
	"strconv"
	"strings"

	"xianyu-go/internal/catalog"
)

// parseMarketSourceInfo 只从单次原商品详情响应提取明确公开的发布字段。
// 平台格式发生变化或字段缺失时标记待核实，不会猜测类目频道、规格库存或运费类型。
func parseMarketSourceInfo(data, itemDO map[string]any, itemID, area string) catalog.SourceInfo {
	// source 是与平台详情同一次请求取得的非敏感原商品发布快照。
	source := catalog.SourceInfo{ItemID: itemID, WebURL: "https://www.goofish.com/item?id=" + itemID, Area: area}
	// category 从平台详情原始分类字段按完整程度读取，不额外请求发布类目推荐接口。
	category := mapFromAny(itemDO["itemCatDTO"])
	if len(category) == 0 {
		category = mapFromAny(itemDO["categoryPredictResult"])
	}
	if len(category) == 0 {
		category = mapFromAny(data["categoryPredictResult"])
	}
	if len(category) == 0 {
		category = mapFromAny(data["itemCatDTO"])
	}
	source.Category = catalog.Category{
		CatID:        firstNonEmptyString(mtopString(category["catId"]), mtopString(itemDO["categoryId"]), mtopString(itemDO["catId"])),
		CatName:      firstNonEmptyString(mtopString(category["catName"]), mtopString(itemDO["categoryName"])),
		ChannelCatID: firstNonEmptyString(mtopString(category["channelCatId"]), mtopString(itemDO["channelCatId"])),
		TBCatID:      firstNonEmptyString(mtopString(category["tbCatId"]), mtopString(itemDO["tbCatId"])),
	}
	if !source.Category.Complete() {
		source.Missing = append(source.Missing, "完整类目（名称／频道类目 ID）")
	}
	// source.Quantity 仅保存明确的库存字段，不等同于买家需要填写的本店新商品库存。
	source.Quantity = positiveMTopInt(itemDO["quantity"])
	if source.Quantity == 0 {
		source.Quantity = positiveMTopInt(itemDO["stock"])
	}
	if source.Quantity == 0 {
		source.Missing = append(source.Missing, "原商品可用库存")
	}
	// fee 从详情价格字段读取；零邮费无法区分包邮与无需邮寄，因此不直接推断类型。
	fee := cleanPriceText(firstNonEmptyString(mtopString(itemDO["transportFee"]), mtopString(itemDO["postFee"])))
	feeDTO := mapFromAny(itemDO["itemPostFeeDTO"])
	source.PostageMode = strings.TrimSpace(mtopString(itemDO["postageMode"]))
	if source.PostageMode == "" {
		source.PostageMode = strings.TrimSpace(mtopString(feeDTO["mode"]))
	}
	if source.PostageMode != "free" && source.PostageMode != "fixed" && source.PostageMode != "none" && source.PostageMode != "distance" {
		source.PostageMode = ""
	}
	if fee != "" {
		source.Postage = fee
	}
	if source.PostageMode == "" && fee != "" && fee != "0" && fee != "0.00" {
		source.PostageMode = "fixed"
	}
	if source.PostageMode == "" {
		source.Missing = append(source.Missing, "运费方式（包邮／无需邮寄未能区分）")
	}
	// attrs 仅采集非私密、可明确识别的名称和值，禁止将整段商家原始请求转发给客户端。
	attributes, _ := itemDO["attributes"].([]any)
	if len(attributes) > 30 {
		attributes = attributes[:30]
	}
	for _, raw := range attributes {
		// entry 保存单条公开属性字段。
		entry := mapFromAny(raw)
		// name、value 是可能显示在商品详情的公开展示文本。
		name := strings.TrimSpace(firstNonEmptyString(mtopString(entry["name"]), mtopString(entry["propertyName"])))
		value := strings.TrimSpace(firstNonEmptyString(mtopString(entry["value"]), mtopString(entry["valueText"])))
		if name != "" && value != "" && len(name) <= 100 && len(value) <= 500 {
			source.Attributes = append(source.Attributes, catalog.Attribute{Name: name, Value: value})
		}
	}
	if len(source.Attributes) == 0 {
		source.Missing = append(source.Missing, "原商品公开属性（详情未返回）")
	}
	// source.Specs 与 source.SKUs 必须全部来自原响应的同一套规格协议，不能用 title 或 SKU 昵称补齐。
	source.Specs, source.SKUs = parseMarketSourceSpecs(itemDO)
	// hasSpec 表示原商品声明存在规格列表；只要数据缺失就让用户核实，不创建错误组合。
	hasSpec := lenArray(itemDO["skuList"]) > 0 || lenArray(itemDO["itemSkuList"]) > 0 || lenArray(itemDO["itemProperties"]) > 0 || mtopString(itemDO["isSKU"]) == "true"
	if hasSpec && (len(source.Specs) == 0 || len(source.SKUs) == 0) {
		source.Specs = []catalog.Spec{}
		source.SKUs = []catalog.SKU{}
		source.Missing = append(source.Missing, "完整规格和 SKU 售价／库存")
	}
	if !hasSpec && itemDO["isSKU"] == nil {
		source.Missing = append(source.Missing, "原商品是否包含多规格（详情未返回）")
	}
	if source.Area == "" {
		source.Missing = append(source.Missing, "来源商品展示地区")
	}
	source.NormalizeCollections()
	return source
}

// lenArray 返回接口动态字段为 JSON 数组时的元素数，其他类型视为缺失。
func lenArray(value any) int {
	// values 表示来源 JSON 中的数组。
	values, _ := value.([]any)
	return len(values)
}

// positiveMTopInt 只认可信赖的正整数库存字段，缺失、负数和浮点字符串都保持待核实。
func positiveMTopInt(value any) int {
	// count、err 是将数量文本转换为整数的结果。
	count, err := strconv.Atoi(strings.TrimSpace(mtopString(value)))
	if err != nil || count <= 0 {
		return 0
	}
	return count
}

// parseMarketSourceSpecs 从 itemProperties/itemSkuList（或旧版 skuList）提取发布需要的规格和完整 SKU。
// 只接受每条 SKU 明确给出价格、库存和全部规格组合的情况，否则返回空列表避免制造虚假的可发布配置。
func parseMarketSourceSpecs(itemDO map[string]any) ([]catalog.Spec, []catalog.SKU) {
	// rawProps 是公开的规格维度数组；旧版缺失时不凭 SKU 文本自动推断。
	rawProps, _ := itemDO["itemProperties"].([]any)
	if len(rawProps) == 0 || len(rawProps) > 2 {
		return nil, nil
	}
	// specs 顺序保存最多 2 个规格维度，遵循网页端发布能力边界。
	specs := make([]catalog.Spec, 0, len(rawProps))
	for _, raw := range rawProps {
		// property 保存当前维度的公开数据。
		property := mapFromAny(raw)
		// specName 是平台确认的规格名称。
		specName := strings.TrimSpace(firstNonEmptyString(mtopString(property["propertyName"]), mtopString(property["name"])))
		// values 是此维度的明确规格值列表。
		values, _ := property["values"].([]any)
		if len(values) == 0 {
			values, _ = property["valuesList"].([]any)
		}
		if specName == "" || len(values) == 0 || len(values) > 30 {
			return nil, nil
		}
		// spec 是可发布的单个规格维度，只有值和名称均有效才能加入。
		spec := catalog.Spec{Name: specName, Values: make([]catalog.SpecValue, 0, len(values))}
		// seen 禁止同一维度重复规格值。
		seen := make(map[string]bool)
		for _, rawValue := range values {
			// entry 是单个规格值对象；不同接口可能叫 valueText 或 value。
			entry := mapFromAny(rawValue)
			// value 是原始规格展示名，imageURL 只保留平台原有地址。
			value := strings.TrimSpace(firstNonEmptyString(mtopString(entry["valueText"]), mtopString(entry["value"]), mtopString(entry["name"])))
			if value == "" || seen[value] {
				return nil, nil
			}
			seen[value] = true
			spec.Values = append(spec.Values, catalog.SpecValue{Value: value, ImageURL: normalizeHTTPSImageURL(mtopString(entry["imageUrl"]))})
		}
		specs = append(specs, spec)
	}
	// rawSKUs 是平台公开的 SKU 组合列表。
	rawSKUs, _ := itemDO["itemSkuList"].([]any)
	if len(rawSKUs) == 0 {
		rawSKUs, _ = itemDO["skuList"].([]any)
	}
	if len(rawSKUs) == 0 || len(rawSKUs) > 300 {
		return nil, nil
	}
	// skus 必须包含正售价及非负库存，不完整的单行令整体组合待核实。
	skus := make([]catalog.SKU, 0, len(rawSKUs))
	for _, raw := range rawSKUs {
		// entry 是单个 SKU 响应。
		entry := mapFromAny(raw)
		// rawPrice 和 rawQuantity 不允许用商品顶层默认价推测。
		rawPrice := strings.TrimSpace(firstNonEmptyString(mtopString(entry["price"]), mtopString(entry["soldPrice"])))
		rawQuantity := strings.TrimSpace(firstNonEmptyString(mtopString(entry["quantity"]), mtopString(entry["stock"])))
		// price 是以元计价的明确 SKU 原价。
		price := cleanPriceText(rawPrice)
		// stockErr 是数量字段格式异常。
		quantity, stockErr := strconv.Atoi(rawQuantity)
		if price == "" || stockErr != nil || quantity < 0 {
			return nil, nil
		}
		// combinations 从 propertyList 数组按维度顺序获得所有规格值。
		props, _ := entry["propertyList"].([]any)
		if len(props) != len(specs) {
			return nil, nil
		}
		// labels 保存本 SKU 与维度顺序一致的规格值名称。
		labels := make([]string, len(specs))
		for idx, rawProp := range props {
			// pair 是单个规格名称和值的结构。
			pair := mapFromAny(rawProp)
			// name、value 是平台原始组合字段。
			name := strings.TrimSpace(mtopString(pair["propertyText"]))
			value := strings.TrimSpace(mtopString(pair["valueText"]))
			if name != specs[idx].Name || value == "" {
				return nil, nil
			}
			// found 仅接受所属维度内确实声明的规格值。
			found := false
			for _, candidate := range specs[idx].Values {
				if candidate.Value == value {
					found = true
					break
				}
			}
			if !found {
				return nil, nil
			}
			labels[idx] = value
		}
		skus = append(skus, catalog.SKU{ValueLabels: labels, Price: price, Quantity: quantity})
	}
	return specs, skus
}
