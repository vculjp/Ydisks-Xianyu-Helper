package mtop

import (
	"encoding/json"
	"testing"
)

// TestCollectorDecimalPriceAndNumberID 验证数值金额与大整数标识不会因通用字符串转换丢失精度。
func TestCollectorDecimalPriceAndNumberID(t *testing.T) {
	if mtopString(9.90) != "9.9" {
		t.Fatal("小数金额转换丢失小数")
	}
	// card 模拟扩展字段中的序列化商品对象，包含超过浮点精度的整数标识。
	card := decodeMapOrJSON(`{"itemId":9007199254740993,"price":0.99}`)
	if mtopString(card["itemId"]) != "9007199254740993" || mtopString(card["price"]) != "0.99" {
		t.Fatal("嵌套对象数字精度丢失")
	}
	// value 是保留原始十进制文本的 JSON 数值。
	value := json.Number("19.99")
	if mtopString(value) != "19.99" {
		t.Fatal("JSON 小数转换错误")
	}
}

// TestCollectorDetailIdentityAndCompleteness 使用合成响应验证商品身份和完整性，缺失价格保持未知。
func TestCollectorDetailIdentityAndCompleteness(t *testing.T) {
	// err 是商品身份不匹配的拒绝结果。
	if _, err := parseMarketItemDetailData(map[string]any{"itemId": "10002", "title": "测试"}, "10001"); err == nil {
		t.Fatal("接受了错误商品详情")
	}
	// detail、err 是仅包含标题的部分详情，不得补造正文和售价。
	detail, err := parseMarketItemDetailData(map[string]any{"itemId": "10001", "title": "测试"}, "10001")
	if err != nil || detail == nil || detail.HasFullDetail || detail.Price != "" || detail.Description != "" {
		t.Fatal("不完整详情被误报为完整或伪造价格")
	}
}

// TestCollectorNegativeShippingLabel 确认负向邮费标签不等同于包邮。
func TestCollectorNegativeShippingLabel(t *testing.T) {
	if extractFreeShippingFlag(map[string]any{"fishTags": []any{"不包邮"}}, nil) {
		t.Fatal("不包邮误判为包邮")
	}
	if !extractFreeShippingFlag(map[string]any{"fishTags": []any{"包邮"}}, nil) {
		t.Fatal("明确包邮标签丢失")
	}
}

// TestCollectorUnknownWantCount 验证真实零值与未知人数不会互相覆盖。
func TestCollectorUnknownWantCount(t *testing.T) {
	if extractWantCount(map[string]any{"wantCnt": 0, "favorCnt": 200}, nil, nil) != 0 {
		t.Fatal("零想要人数被覆盖")
	}
	if extractWantCount(map[string]any{"favorCnt": 200}, nil, nil) != -1 {
		t.Fatal("缺少想要数应视为未知")
	}
}

// TestCollectorSellerPaginationExplicitEnd 验证明确结束标志优先于历史总页数。
func TestCollectorSellerPaginationExplicitEnd(t *testing.T) {
	// data 模拟平台总量未及时更新但明确没有下一页的店铺响应。
	data := map[string]any{"cardList": []any{}, "totalCount": 200, "nextPage": false}
	// items、more、total、err 分别是空店铺结果、是否继续、报告数量和解析异常。
	items, more, total, err := parseSellerShopData(data, "12345", 1, 20)
	if err != nil || more || len(items) != 0 || total != 200 {
		t.Fatalf("明确结束标志未生效: more=%v total=%d err=%v", more, total, err)
	}
}
