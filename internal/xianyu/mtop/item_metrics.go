package mtop

import (
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
)

// cacheItemMetrics 从当前列表卡片及其详情、埋点参数提取明确统计，写入 detail 供既有同步流程缓存；不发起网络请求。
func cacheItemMetrics(detail, cardData, detailParams map[string]any) {
	// trackParams 是列表响应已携带的埋点参数，允许平台返回对象或 JSON 文本。
	trackParams := decodeMapOrJSON(cardData["trackParams"])
	// fields 只声明含义明确的指标键，不把收藏、销量或状态猜测成曝光、浏览或想要。
	fields := []struct {
		// target 是本地详情和 API 使用的规范字段名。
		target string
		// sources 是列表可能明确提供的同义统计键。
		sources []string
	}{
		{"exposure_count", []string{"exposureCount", "exposureNum", "exposureCnt"}},
		{"browse_count", []string{"browseCount", "browseNum", "browseCnt", "viewCount"}},
		{"want_count", []string{"wantCount", "wantNum", "wantCnt"}},
	}
	// roots 保留平台可能嵌套统计的明确响应分支；递归只在这些分支内查找同名键。
	roots := []any{cardData, detailParams, trackParams, cardData["itemLabelDataVO"]}
	// field 是当前待缓存的指标定义。
	for _, field := range fields {
		// count 保存明确返回的非负整数；nil 表示未知，真实 0 不会被后续来源覆盖。
		count := metricCountInAny(roots, field.sources, 0)
		if count != nil {
			detail[field.target] = *count
		}
	}
	// want_count 额外兼容列表卡片只提供“N人想要”展示标签的情况；不会把“小刀价”等文案当成人数。
	if _, exists := detail["want_count"]; !exists {
		if count := wantLabelInAny(roots, 0); count != nil {
			detail["want_count"] = *count
		}
	}
}

// metricCountInAny 在有限深度的嵌套对象中按字段名查找明确统计；优先浅层字段，多个来源冲突时保持未知。
func metricCountInAny(nodes []any, keys []string, depth int) *int64 {
	if depth > 6 {
		return nil
	}
	// wanted 保存统一小写后的字段名，避免大小写差异漏读平台字段。
	wanted := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		wanted[strings.ToLower(key)] = struct{}{}
	}
	// count 保存当前层找到的第一个有效统计；同层其它同名键若给出不同值则不猜测。
	var count *int64
	// children 保存下一层递归对象，保持遍历顺序可复现。
	var children []any
	for _, node := range nodes {
		switch typed := node.(type) {
		case map[string]any:
			// key 排序后再读取，保证同一响应重复解析得到稳定结果。
			names := make([]string, 0, len(typed))
			for name := range typed {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				value := typed[name]
				if _, matched := wanted[strings.ToLower(name)]; matched {
					candidate := optionalItemCount(value)
					if candidate == nil {
						continue
					}
					if count != nil && *count != *candidate {
						return nil
					}
					count = candidate
					continue
				}
				children = append(children, value)
			}
		case []any:
			children = append(children, typed...)
		case string:
			// 平台偶尔把子对象序列化为 JSON 文本；只解析对象或数组，普通文本留给标签扫描。
			text := strings.TrimSpace(typed)
			if text == "" || (text[0] != '{' && text[0] != '[') {
				continue
			}
			var decoded any
			if json.Unmarshal([]byte(text), &decoded) == nil {
				children = append(children, decoded)
			}
		}
	}
	if count != nil {
		return count
	}
	if len(children) == 0 {
		return nil
	}
	return metricCountInAny(children, keys, depth+1)
}

// wantLabelInAny 在有限深度的嵌套对象中查找完整“N人想要”标签，忽略近似文本和冲突人数。
func wantLabelInAny(nodes []any, depth int) *int64 {
	if depth > 6 {
		return nil
	}
	// count 汇总当前层及子层发现的人数；不同数值同时出现时保持未知。
	var count *int64
	// children 保存下一层递归对象。
	var children []any
	for _, node := range nodes {
		switch typed := node.(type) {
		case string:
			// match 是“数字 + 人想要”的完整展示片段。
			match := wantCountNumberPattern.FindStringSubmatch(strings.TrimSpace(typed))
			if len(match) != 2 {
				continue
			}
			candidate, parseErr := strconv.ParseInt(match[1], 10, 64)
			if parseErr != nil || candidate < 0 || candidate > 9007199254740991 {
				continue
			}
			if count != nil && *count != candidate {
				return nil
			}
			count = &candidate
		case map[string]any:
			for _, value := range typed {
				children = append(children, value)
			}
		case []any:
			children = append(children, typed...)
		}
	}
	if count != nil {
		return count
	}
	if len(children) == 0 {
		return nil
	}
	return wantLabelInAny(children, depth+1)
}

// optionalItemCount 将 value 的精确非负整数转换为指针；缺失、布尔、负数、小数、缩略文本和超出 JS 安全整数范围均返回 nil。
func optionalItemCount(value any) *int64 {
	// count 保存可在 Go 和前端之间无损流转的整数统计。
	var count int64
	// typed 根据 JSON 解码后的数值或文本类型严格读取，避免通用字符串转换把缺失值伪造为零。
	switch typed := value.(type) {
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) || typed < 0 || typed > 9007199254740991 || math.Trunc(typed) != typed {
			return nil
		}
		count = int64(typed)
	case json.Number:
		// parseErr 表示 JSON 数字不能无损解释为十进制整数。
		var parseErr error
		count, parseErr = typed.Int64()
		if parseErr != nil {
			return nil
		}
	case string:
		// text 是去掉首尾空白的原始统计文本；空串不代表真实零。
		text := strings.TrimSpace(typed)
		if text == "" || strings.Trim(text, "0123456789") != "" {
			return nil
		}
		// parseErr 表示十进制统计超出整数表示范围。
		var parseErr error
		count, parseErr = strconv.ParseInt(text, 10, 64)
		if parseErr != nil {
			return nil
		}
	default:
		return nil
	}
	if count < 0 || count > 9007199254740991 {
		return nil
	}
	return &count
}
