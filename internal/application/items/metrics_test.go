package items

import (
	"reflect"
	"testing"
)

// TestMetricsFromDetailPreservesKnownAndUnknown 验证公开缓存解析接口的精确值、坏值与旧标签边界；t 不读取用户数据库。
func TestMetricsFromDetailPreservesKnownAndUnknown(t *testing.T) {
	// zero、seven、maximum 是测试期望的独立精确人数或次数。
	zero, seven, thirteen, maximum := int64(0), int64(7), int64(13), int64(9007199254740991)
	// cases 覆盖未知不能变零、坏指标不拖累其他指标及历史人数标签的安全解析。
	cases := []struct {
		// name 说明当前公开接口需要满足的业务语义。
		name string
		// detail 是人工构造的本地缓存 JSON。
		detail string
		// expected 是应返回的三项统计，不依赖被测解析过程生成。
		expected Metrics
	}{
		{"空缓存", "", Metrics{}},
		{"损坏缓存", "not-json", Metrics{}},
		{"非对象缓存", "[]", Metrics{}},
		{"空对象", "{}", Metrics{}},
		{"真实零", `{"exposure_count":0,"browse_count":0,"want_count":0}`, Metrics{&zero, &zero, &zero}},
		{"单项无效不影响其他项", `{"exposure_count":false,"browse_count":1.5,"want_count":7}`, Metrics{WantCount: &seven}},
		{"字符串和null保持未知", `{"exposure_count":"7","browse_count":null,"want_count":-1}`, Metrics{}},
		{"安全整数上限", `{"exposure_count":9007199254740991,"browse_count":9007199254740992}`, Metrics{ExposureCount: &maximum}},
		{"旧人数标签", `{"item_label_data":{"labelData":{"r3":{"tagList":[{"data":{"content":"7人想要"}}]}}}}`, Metrics{WantCount: &seven}},
		{"埋点JSON字符串标签", `{"track_params":{"serviceUtParams":"[{\"args\":{\"content\":\"13人想要\"}}]"}}`, Metrics{WantCount: &thirteen}},
		{"旧人数零标签", `{"item_label_data":{"content":"0人想要"}}`, Metrics{WantCount: &zero}},
		{"零优先于旧标签", `{"want_count":0,"item_label_data":{"content":"7人想要"}}`, Metrics{WantCount: &zero}},
		{"显式坏值不借旧标签恢复", `{"want_count":null,"item_label_data":{"content":"7人想要"}}`, Metrics{}},
		{"拒绝缩略或矛盾人数", `{"item_label_data":["1.2万人想要","7人想要","8人想要"]}`, Metrics{}},
		{"忽略标题中的人数", `{"title":"7人想要"}`, Metrics{}},
	}
	// testCase 是本轮待验证的输入及独立期望。
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			// actual 是公开解析函数返回的精确统计指针，DeepEqual 会比较所指的值。
			actual := MetricsFromDetail(testCase.detail)
			if !reflect.DeepEqual(actual, testCase.expected) {
				t.Fatalf("缓存指标不符合精确值/未知值契约: got=%+v want=%+v", actual, testCase.expected)
			}
		})
	}
}
