package mtop

import "testing"

// TestPublishAddressDTOAllowsDistrictOnly 验证区县中心足以组成地址载荷，且不伪造兴趣点。
func TestPublishAddressDTOAllowsDistrictOnly(t *testing.T) {
	// location 是含真实区县中心坐标、没有详细地点的测试发货地。
	location := PublishLocation{Province: "浙江省", City: "杭州市", Area: "西湖区", DivisionID: "330106", Longitude: 120.12, Latitude: 30.25}
	if !validPublishLocation(location) {
		t.Fatal("区县中心坐标应满足现有发布地址校验")
	}
	// address 是平台所需的最小行政区位置载荷。
	address := publishAddressDTO(location)
	if address["divisionId"] != "330106" || address["gps"] != "30.25,120.12" || address["area"] != "西湖区" {
		t.Fatalf("行政区字段丢失: %+v", address)
	}
	// ok 表示无 POI 的区县载荷错误地包含了兴趣点标识。
	if _, ok := address["poiId"]; ok {
		t.Fatal("区县地址不应伪造 poiId")
	}
	// ok 表示无 POI 的区县载荷错误地包含了兴趣点名称。
	if _, ok := address["poiName"]; ok {
		t.Fatal("区县地址不应伪造 poiName")
	}
	// fullAddress 是用户明确选中详细兴趣点后的发布地址载荷。
	fullAddress := publishAddressDTO(PublishLocation{Province: "浙江省", City: "杭州市", Area: "西湖区", DivisionID: "330106", Longitude: 120.13, Latitude: 30.26, POIID: "B01", POIName: "某园区"})
	if fullAddress["poiId"] != "B01" || fullAddress["poiName"] != "某园区" {
		t.Fatalf("用户主动选中的 POI 必须保留: %+v", fullAddress)
	}
}
