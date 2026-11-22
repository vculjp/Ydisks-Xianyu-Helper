package mtop

import (
	"strings"
	"testing"
)

// TestSourcePublishDetailsExtractedFromSingleDetailResponse 校验类目、规格、SKU、运费、原库存和来源在同一次公开详情响应中提取。
func TestSourcePublishDetailsExtractedFromSingleDetailResponse(t *testing.T) {
	// data 模拟只含公开商品字段的详情接口，覆盖发布真正需要的三元类目与 SKU 组合。
	data := map[string]any{
		"itemDO": map[string]any{
			"itemId": "5566778899", "title": "原始商品", "desc": "真实描述", "soldPrice": "8.00", "quantity": "12",
			"itemCatDTO":  map[string]any{"catId": "100", "catName": "实际分类", "channelCatId": "200", "tbCatId": "300"},
			"postageMode": "fixed", "transportFee": "3.50",
			"imageInfos":     []any{map[string]any{"url": "https://img.alicdn.com/cover.jpg"}},
			"attributes":     []any{map[string]any{"name": "新旧程度", "value": "九成新"}},
			"itemProperties": []any{map[string]any{"propertyName": "颜色", "values": []any{map[string]any{"valueText": "蓝", "imageUrl": "https://img.alicdn.com/blue.jpg"}, map[string]any{"valueText": "黑"}}}},
			"itemSkuList": []any{
				map[string]any{"price": "8.00", "quantity": "7", "propertyList": []any{map[string]any{"propertyText": "颜色", "valueText": "蓝"}}},
				map[string]any{"price": "9.00", "quantity": "5", "propertyList": []any{map[string]any{"propertyText": "颜色", "valueText": "黑"}}},
			},
		},
		"sellerDO": map[string]any{"sellerId": "111", "city": "杭州"},
	}
	// parsed、err 是完整单次采集结果与解析失败原因。
	parsed, err := parseMarketItemDetailData(data, "5566778899")
	if err != nil {
		t.Fatal(err)
	}
	if !parsed.Source.Category.Complete() || parsed.Source.Category.ChannelCatID != "200" || parsed.Source.Category.TBCatID != "300" {
		t.Fatalf("原类目丢失：%+v", parsed.Source.Category)
	}
	if parsed.CategoryID != "100" || parsed.Source.Quantity != 12 || parsed.Source.PostageMode != "fixed" || parsed.Source.Postage != "3.50" {
		t.Fatalf("原商品库存／运费丢失：%+v", parsed.Source)
	}
	if len(parsed.Source.Specs) != 1 || len(parsed.Source.SKUs) != 2 || parsed.Source.SKUs[1].Quantity != 5 || parsed.Source.Specs[0].Values[0].ImageURL == "" {
		t.Fatalf("原商品 SKU 和规格图未采集完整：%+v", parsed.Source)
	}
	if len(parsed.Source.Attributes) != 1 || parsed.Source.WebURL != "https://www.goofish.com/item?id=5566778899" || len(parsed.Source.Missing) != 0 {
		t.Fatalf("公开来源属性与商品链接不正确：%+v", parsed.Source)
	}
}

// TestSourcePublishMissingInformationNotGuessed 校验类目 ID 不全、零运费、未返回 SKU 的情况下保留未知，避免猜测分类或运费。
func TestSourcePublishMissingInformationNotGuessed(t *testing.T) {
	// source 是信息欠缺的公开详情结果，不是用户发布表单。
	source := parseMarketSourceInfo(map[string]any{}, map[string]any{
		"categoryId": "777", "transportFee": "0.00", "skuList": []any{map[string]any{"skuId": "1"}},
	}, "998877", "")
	if source.Category.CatID != "777" || source.Category.Complete() || source.PostageMode != "" || len(source.SKUs) != 0 {
		t.Fatalf("缺失数据被猜测为完整发布信息：%+v", source)
	}
	if len(source.Missing) < 3 || !strings.Contains(strings.Join(source.Missing, "、"), "规格") {
		t.Fatalf("类目、规格、发货方式应明确待核实：%v", source.Missing)
	}
}
