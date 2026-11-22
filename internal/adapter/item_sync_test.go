package adapter

import (
	"encoding/json"
	"testing"
)

// TestPreserveCachedItemMetricsKeepsShelfState 验证列表同步不会清空平台已确认的货架状态。
func TestPreserveCachedItemMetricsKeepsShelfState(t *testing.T) {
	// cached 是本地已有的货架状态和浏览统计。
	cached := map[string]json.RawMessage{
		"shelf_state":  json.RawMessage(`"off"`),
		"browse_count": json.RawMessage(`5`),
	}
	// merged 是本次平台列表快照补回本地状态后的扩展 JSON。
	merged := preserveCachedItemMetrics(`{"item_image":"new.png"}`, cached)
	// fields 是解析后的扩展对象，用于逐字段核对。
	var fields map[string]any
	if err := json.Unmarshal([]byte(merged), &fields); err != nil {
		t.Fatal(err)
	}
	if fields["shelf_state"] != "off" || fields["browse_count"] != float64(5) || fields["item_image"] != "new.png" {
		t.Fatalf("同步合并结果错误: %s", merged)
	}
}

// TestPreserveCachedItemMetricsKeepsNewShelfState 验证平台明确返回的新货架状态优先于旧缓存。
func TestPreserveCachedItemMetricsKeepsNewShelfState(t *testing.T) {
	// cached 是旧的已下架状态。
	cached := map[string]json.RawMessage{"shelf_state": json.RawMessage(`"off"`)}
	// merged 必须保留本次快照明确给出的已上架状态。
	merged := preserveCachedItemMetrics(`{"shelf_state":"on"}`, cached)
	// fields 是解析后的扩展对象。
	var fields map[string]any
	if err := json.Unmarshal([]byte(merged), &fields); err != nil {
		t.Fatal(err)
	}
	if fields["shelf_state"] != "on" {
		t.Fatalf("新货架状态被旧缓存覆盖: %s", merged)
	}
}

// TestEnsureOnShelfStateDefaultsListedItemsToOnSale 验证从“在售”分组同步的商品默认标记为已上架，且不覆盖已确认的下架回执。
func TestEnsureOnShelfStateDefaultsListedItemsToOnSale(t *testing.T) {
	// onSale 是无货架状态的新商品，应补回“在售”标记。
	onSale := ensureOnShelfState(`{"title":"新商品"}`)
	// offShelf 是本地已经确认下架的商品，必须保留 off。
	offShelf := ensureOnShelfState(`{"shelf_state":"off","title":"下架商品"}`)
	// broken 是损坏的扩展 JSON，应原样返回不阻断同步。
	broken := ensureOnShelfState(`{invalid`)
	for _, tc := range []struct {
		name string
		got  string
		want string
	}{
		{name: "默认在售", got: onSale, want: "on"},
		{name: "保留下架回执", got: offShelf, want: "off"},
		{name: "损坏 JSON 原样返回", got: broken, want: broken},
	} {
		var fields map[string]any
		_ = json.Unmarshal([]byte(tc.got), &fields)
		if tc.name == "损坏 JSON 原样返回" {
			if tc.got != tc.want {
				t.Fatalf("%s: 应原样返回损坏 JSON", tc.name)
			}
			continue
		}
		if fields["shelf_state"] != tc.want {
			t.Fatalf("%s: shelf_state=%v want %v (raw=%s)", tc.name, fields["shelf_state"], tc.want, tc.got)
		}
	}
}
