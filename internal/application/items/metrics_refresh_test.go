package items

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

// metricsPlatformStub 只提供用户单件查询的统计，嵌入既有平台操作替身以复用构造契约。
type metricsPlatformStub struct {
	remoteItemPlatformStub
	// metrics 是详情接口明确返回的统计，nil 指标表示未知。
	metrics Metrics
	// reads 是本轮读取商品详情的次数，不允许列表扇出或失败自动重放。
	reads int
}

// FetchMetrics 只记录当前账号当前商品的一次读取，并返回预置错误或统计。
func (platform *metricsPlatformStub) FetchMetrics(context.Context, int64, string, string) (Metrics, error) {
	platform.reads++
	return platform.metrics, platform.operationErr
}

// TestExplicitMetricsRefreshOnlyReadsOneItem 验证单件用户动作保存真实统计、保留原详情且不写未知曝光；t 使用纯本地替身。
func TestExplicitMetricsRefreshOnlyReadsOneItem(t *testing.T) {
	// zero、seven 是详情接口明确返回的浏览次数和想要人数。
	zero, seven := int64(0), int64(7)
	// catalog 保存需要完整保留的图片、货架与旧人数标签缓存。
	catalog := &catalogMutationRepositoryStub{item: CatalogItem{ItemID: "item", ItemDetail: `{"item_image":"cover.jpg","shelf_state":"off","item_label_data":{"content":"31人想要"}}`}}
	// platform 是只返回本件商品真实统计的替身。
	platform := &metricsPlatformStub{metrics: Metrics{BrowseCount: &zero, WantCount: &seven}}
	// service、createErr 是用户单件操作应用服务及依赖构造错误。
	service, createErr := NewRemoteItemService(catalog, platform)
	if createErr != nil {
		t.Fatal(createErr)
	}
	// input 是用户明确点击当前商品刷新，不传入列表或批量 ID。
	input := RemoteItemInput{UserID: 1, CookieID: "account", ItemID: "item", Action: RemoteItemAction("refresh_metrics")}
	if /* refreshErr 是读取单件详情并保存缓存的错误。 */ refreshErr := service.Execute(context.Background(), input); refreshErr != nil {
		t.Fatal(refreshErr)
	}
	if platform.reads != 1 || len(platform.calls) != 0 || catalog.patchInput.ItemDetail == nil {
		t.Fatal("显式刷新必须恰好读取一件商品且不能编辑或上下架")
	}
	// detail 验证局部更新后原有非统计字段仍被保留。
	var detail map[string]any
	if /* decodeErr 是刷新后本地详情的格式错误。 */ decodeErr := json.Unmarshal([]byte(*catalog.patchInput.ItemDetail), &detail); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if detail["item_image"] != "cover.jpg" || detail["shelf_state"] != "off" || detail["browse_count"] != float64(0) || detail["want_count"] != float64(7) {
		t.Fatal("单件统计刷新没有完整保留原资料或真实零值")
	}
	if _ /* exists 表示详情缓存中是否错误写入了曝光统计字段。 */, exists := detail["exposure_count"]; exists {
		t.Fatal("详情没有曝光数据时不得制造曝光统计")
	}
	// 第二次成功但详情缺少浏览时，必须把最新未知写为 null，不能继续冒用上一轮零值。
	catalog.patchInput = CatalogPatchInput{}
	platform.metrics = Metrics{WantCount: &seven}
	if /* refreshErr 是成功读取但缺少浏览次数时的缓存更新结果。 */ refreshErr := service.Execute(context.Background(), input); refreshErr != nil {
		t.Fatal(refreshErr)
	}
	if /* decodeErr 是未知统计缓存的解析错误。 */ decodeErr := json.Unmarshal([]byte(*catalog.patchInput.ItemDetail), &detail); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if /* value、exists 分别是缓存的浏览统计值及其字段存在标记。 */ value, exists := detail["browse_count"]; !exists || value != nil {
		t.Fatal("最新详情缺少浏览时必须明确写为未知")
	}
	// 平台失败只能返回错误，不能覆盖上次缓存或继续重试。
	catalog.patchInput = CatalogPatchInput{}
	platform.operationErr = errors.New("平台需要验证")
	if /* refreshErr 是第三次由用户显式触发后的确定失败。 */ refreshErr := service.Execute(context.Background(), input); refreshErr == nil || platform.reads != 3 || catalog.patchInput.ItemDetail != nil {
		t.Fatal("单件失败不能自动重试或写入假数据")
	}
}
