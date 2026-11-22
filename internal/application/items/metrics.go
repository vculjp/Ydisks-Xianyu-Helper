package items

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// cachedWantLabelPattern 仅接受完整的精确人数标签；“1.2万人想要”等缩略值不能被误截取为整数。
var cachedWantLabelPattern = regexp.MustCompile(`^([0-9]+)\s*人想要$`)

// Metrics 是最近一次商品列表缓存中的精确统计；nil 表示未知，指向 0 表示平台明确返回零。
type Metrics struct {
	// ExposureCount 是曝光次数；缺少曝光数据时不得用浏览量代替。
	ExposureCount *int64
	// BrowseCount 是商品浏览次数。
	BrowseCount *int64
	// WantCount 是想要人数，不等于收藏数或销量。
	WantCount *int64
}

// MetricsFromDetail 从本地 detail JSON 派生三项统计，不访问平台；损坏缓存或单个无效指标保持未知，其他有效指标仍可用。
func MetricsFromDetail(detail string) Metrics {
	// fields 保留每项原始 JSON，避免某项类型错误使整件商品的有效统计全部丢失。
	var fields map[string]json.RawMessage
	if /* decodeErr 是整件商品扩展缓存的 JSON 格式错误。 */ decodeErr := json.Unmarshal([]byte(detail), &fields); decodeErr != nil {
		return Metrics{}
	}
	// metrics 优先采用规范缓存字段；真实零值不会被旧标签中的正数覆盖。
	metrics := Metrics{
		ExposureCount: cachedMetricCount(fields["exposure_count"]),
		BrowseCount:   cachedMetricCount(fields["browse_count"]),
		WantCount:     cachedMetricCount(fields["want_count"]),
	}
	// exists 区分旧缓存没有规范字段与规范字段明确无效，后者不得借旧标签伪装成有效。
	if _, exists := fields["want_count"]; !exists {
		// sources 只扫描已经缓存的三类展示/埋点字段；不扫描标题、描述或其他任意文本。
		for _, key := range []string{"item_label_data", "track_params", "detail_params"} {
			// raw 是当前候选字段；缺失时继续下一个来源。
			raw, exists := fields[key]
			if !exists {
				continue
			}
			// labels 是当前候选字段中的标签树或埋点对象。
			var labels any
			if /* decodeErr 是旧缓存人数标签树的解码错误。 */ decodeErr := json.Unmarshal(raw, &labels); decodeErr != nil {
				continue
			}
			// count 是当前来源中唯一且无冲突的精确人数；没有命中时继续下一个来源。
			count, conflict := cachedWantLabelCount(labels, 0)
			if !conflict && count != nil {
				metrics.WantCount = count
				break
			}
		}
	}
	return metrics
}

// cachedMetricCount 将 raw 缓存字段转换为可跨 Go/JavaScript 无损表达的非负整数指针；缺失、null、错误类型和越界均返回 nil。
func cachedMetricCount(raw json.RawMessage) *int64 {
	// count 使用指针区分缓存缺失与明确零值，拒绝把字符串或布尔强制转换为数字。
	var count *int64
	if /* decodeErr 是单项统计类型错误，其他有效指标不受影响。 */ decodeErr := json.Unmarshal(raw, &count); decodeErr != nil || count == nil || *count < 0 || *count > 9007199254740991 {
		return nil
	}
	return count
}

// cachedWantLabelCount 从 node 标签树提取精确想要人数；depth 限制损坏缓存的递归深度，返回值区分未知与互相矛盾的标签。
func cachedWantLabelCount(node any, depth int) (*int64, bool) {
	if depth > 12 {
		return nil, false
	}
	// count 汇总当前节点的唯一统计事实；相同人数在展示标签与埋点中重复出现仍视为同一事实。
	var count *int64
	// children 保存对象或数组的下一层标签节点。
	var children []any
	// typed 是当前标签节点，只有完整文本“整数人想要”可转换为人数。
	switch typed := node.(type) {
	case string:
		// text 是当前标签文本；埋点参数可能把子标签序列化为 JSON 文本，需要继续解码。
		text := strings.TrimSpace(typed)
		// match 是完整人数标签的数字捕获组，拒绝从近似文本截取尾部数字。
		match := cachedWantLabelPattern.FindStringSubmatch(text)
		if len(match) == 2 {
			// parsed、parseErr 是十进制标签人数及溢出错误。
			parsed, parseErr := strconv.ParseInt(match[1], 10, 64)
			if parseErr != nil || parsed > 9007199254740991 {
				return nil, false
			}
			return &parsed, false
		}
		// 只对对象或数组形态的 JSON 文本继续递归，普通标题文本不参与人数扫描。
		if text != "" && (text[0] == '{' || text[0] == '[') {
			var decoded any
			if decodeErr := json.Unmarshal([]byte(text), &decoded); decodeErr == nil {
				return cachedWantLabelCount(decoded, depth+1)
			}
		}
		return nil, false
	case map[string]any:
		// child 是标签对象的下一层字段值，不含账号凭证。
		for _, child := range typed {
			children = append(children, child)
		}
	case []any:
		children = typed
	}
	// child 逐个汇总子节点；出现不同人数时保持未知，避免依赖 map 遍历顺序。
	for _, child := range children {
		// candidate、conflict 是当前子树的统计和矛盾标记。
		candidate, conflict := cachedWantLabelCount(child, depth+1)
		if conflict || (count != nil && candidate != nil && *count != *candidate) {
			return nil, true
		}
		if candidate != nil {
			count = candidate
		}
	}
	return count, false
}
