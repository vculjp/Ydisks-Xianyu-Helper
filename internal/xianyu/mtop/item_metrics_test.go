package mtop

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// TestFetchItemsPageCachesMetrics 验证单次列表响应中的统计随详情缓存，真实零值和缺失值保持不同；t 管理本地 HTTP 夹具。
func TestFetchItemsPageCachesMetrics(t *testing.T) {
	// calls 只记录本地替身收到的请求数，禁止为统计补发详情请求。
	var calls atomic.Int32
	// fixture 是人工构造的列表协议夹具，不代表真实账号当前必然返回这些可选字段。
	const fixture = `{"ret":["SUCCESS::调用成功"],"data":{"cardList":[
		{"cardData":{"id":"metrics","exposureCount":"125","browseCount":0,"wantNum":"7"}},
		{"cardData":{"id":"unknown","itemStatus":0}},
		{"cardData":{"id":"label","trackParams":{"wantNum":0},"itemLabelDataVO":{"text":"9人想要"}}},
		{"cardData":{"id":"nested","detailParams":{"exposureCnt":44,"browseCnt":12},"itemLabelDataVO":{"labelData":{"r3":{"tagList":[{"data":{"content":"13人想要"}}]}}}}}
	]}}`
	// server 仅响应本测试的列表请求；writer 输出夹具，request 不含真实账号信息。
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		fmt.Fprint(writer, fixture)
	}))
	defer server.Close()
	// client 将所有平台传输重写到本地替身，不触达真实平台。
	client := &ClientImpl{HTTPClient: &http.Client{Transport: &rewriteTransport{base: server.Client().Transport, target: server.URL}}}
	// result、fetchErr 保存一次分页读取结果与协议错误。
	result, fetchErr := client.FetchItemsPage(context.Background(), consignCookies, 1, 20)
	if fetchErr != nil || len(result.Items) != 4 {
		t.Fatalf("列表读取失败: %v", fetchErr)
	}
	// expected 是各商品应持久化的独立统计事实；nil 表示不应伪造任何统计。
	expected := []map[string]any{
		{"exposure_count": float64(125), "browse_count": float64(0), "want_count": float64(7)},
		{},
		{"want_count": float64(0)},
		{"exposure_count": float64(44), "browse_count": float64(12), "want_count": float64(13)},
	}
	// index、item 遍历列表结果，验证缓存中统计字段的存在性和值。
	for index, item := range result.Items {
		// detail 是即将交给既有同步仓储保存的非敏感商品详情。
		var detail map[string]any
		if /* decodeErr 是将列表缓存重新解码时的格式错误。 */ decodeErr := json.Unmarshal([]byte(item.ItemDetail), &detail); decodeErr != nil {
			t.Fatal(decodeErr)
		}
		// key 逐一核对规范化字段，不把缺失字段当作零值。
		for _, key := range []string{"exposure_count", "browse_count", "want_count"} {
			// actual、present 是缓存中的统计值和存在性；wanted、known 是夹具明确要求的值和存在性。
			actual, present := detail[key]
			// wanted、known 区分未知指标与真实零指标。
			wanted, known := expected[index][key]
			if present != known || actual != wanted {
				t.Errorf("商品 %d 的 %s = %v（存在=%v），期望 %v（存在=%v）", index, key, actual, present, wanted, known)
			}
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("统计解析产生了额外平台请求: %d", calls.Load())
	}
}
