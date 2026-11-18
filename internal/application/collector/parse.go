package collector

import (
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// numericIDPattern 匹配纯数字的闲鱼商品 ID 或卖家 userId（至少 5 位数字）。
var numericIDPattern = regexp.MustCompile(`^\d{5,24}$`)

// queryItemIDPattern 从包含 id=数字 或 itemId=数字 的链接与分享文本中提取商品 ID。
var queryItemIDPattern = regexp.MustCompile(`(?i)(?:[?&]|^)(?:item_?id|id)=(\d{5,24})`)

// querySellerIDPattern 从个人主页链接（如 goofish.com/personal?userId=2177750131）提取卖家 ID。
var querySellerIDPattern = regexp.MustCompile(`(?i)(?:[?&]|^)(?:user_?id|seller_?id)=(\d{5,24})`)

// invalid 构造参数校验错误。
func invalid(message string) error {
	return &ValidationError{Message: message}
}

// ExtractItemIDs 从多行用户粘贴文本（商品链接、分享文案或纯数字 ID）中去重提取合法商品 ID。
func ExtractItemIDs(rawInputs []string) ([]string, error) {
	// seen 记录已经提取过的商品 ID，保持用户输入顺序去重。
	seen := make(map[string]struct{})
	// ids 保存提取出的有序商品 ID 切片。
	var ids []string
	// rawEntry 是前端传入的单条或包含多行的字符串。
	for _, rawEntry := range rawInputs {
		// line 是按换行或中英文逗号拆分出的单个片段。
		for _, line := range splitInputLines(rawEntry) {
			// id 是从当前片段解析出的商品数字 ID。
			id := parseSingleItemID(line)
			if id == "" {
				return nil, invalid(fmt.Sprintf("无法从 %q 中识别有效的闲鱼商品 ID 或商品链接", truncateRunes(line, 40)))
			}
			// exists 检查该商品是否已在本次列表中。
			if _, exists := seen[id]; exists {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, invalid("请至少输入一个闲鱼商品链接或商品 ID")
	}
	if len(ids) > MaxDetailBatchItems {
		return nil, invalid(fmt.Sprintf("为保护账号安全，单次精准采集最多支持 %d 个商品（当前 %d 个）", MaxDetailBatchItems, len(ids)))
	}
	return ids, nil
}

// ExtractSellerID 从用户输入的同行个人主页链接或纯数字文本中提取卖家 userId。
func ExtractSellerID(raw string) (string, error) {
	// trimmed 是清理首尾空白后的输入文本。
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", invalid("请输入对标同行店铺主页链接或卖家 ID")
	}
	if numericIDPattern.MatchString(trimmed) {
		return trimmed, nil
	}
	// parsed、parseErr 尝试解析标准 URL 查询参数中的 userId。
	if parsed, parseErr := url.Parse(trimmed); parseErr == nil {
		// query 是 URL 查询字典。
		query := parsed.Query()
		// key 遍历常见卖家 ID 参数名。
		for _, key := range []string{"userId", "userid", "user_id", "sellerId", "seller_id"} {
			// candidate 是查询参数值。
			candidate := strings.TrimSpace(query.Get(key))
			if numericIDPattern.MatchString(candidate) {
				return candidate, nil
			}
		}
	}
	// match 回退用正则在整段分享文本中匹配 userId=数字。
	if match := querySellerIDPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		return match[1], nil
	}
	return "", invalid("无法识别卖家 ID，请粘贴闲鱼个人主页链接（含 userId=...）或纯数字卖家 ID")
}

// parseSingleItemID 从单行链接或口令文本中提取闲鱼数字商品 ID。
func parseSingleItemID(segment string) string {
	// trimmed 是去除首尾空白后的片段。
	trimmed := strings.TrimSpace(segment)
	if trimmed == "" {
		return ""
	}
	if numericIDPattern.MatchString(trimmed) {
		return trimmed
	}
	// parsed、err 尝试按标准 URL 解析查询参数。
	if parsed, err := url.Parse(trimmed); err == nil {
		// q 是解析出的查询参数集合。
		q := parsed.Query()
		// key 依次检查闲鱼常见的商品参数键。
		for _, key := range []string{"id", "itemId", "item_id"} {
			// val 是候选商品数字 ID。
			val := strings.TrimSpace(q.Get(key))
			if numericIDPattern.MatchString(val) {
				return val
			}
		}
	}
	// match 在混合文案（如“【闲鱼】https://www.goofish.com/item?id=1099053019895 点击链接...”）中提取 id=数字。
	if match := queryItemIDPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		return match[1]
	}
	return ""
}

// splitInputLines 按换行符和分号拆分多条输入并过滤空白行。
func splitInputLines(raw string) []string {
	// normalized 统一回车换行与中文分号。
	normalized := strings.NewReplacer("\r\n", "\n", "\r", "\n", "；", "\n", ";", "\n").Replace(raw)
	// out 收集非空片段。
	var out []string
	// part 是拆分后的单行文本。
	for _, part := range strings.Split(normalized, "\n") {
		// trimmed 是去除首尾空白后的单行输入。
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// ParsePriceCents 将元为单位的金额字符串（如 "9.90"）解析为以分为单位的整数。
func ParsePriceCents(raw string, allowNegative bool) (int64, error) {
	// cleaned 剥离常见货币符号与空白。
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.TrimPrefix(cleaned, "¥")
	cleaned = strings.TrimPrefix(cleaned, "￥")
	cleaned = strings.TrimSuffix(cleaned, "元")
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return 0, invalid("金额不能为空")
	}
	// val、err 解析十进制浮点数。
	val, err := strconv.ParseFloat(cleaned, 64)
	if err != nil || math.IsNaN(val) || math.IsInf(val, 0) {
		return 0, invalid(fmt.Sprintf("金额格式无效: %s", raw))
	}
	// cents 四舍五入换算为分。
	cents := int64(math.Round(val * 100))
	if !allowNegative && cents < 0 {
		return 0, invalid("金额不能为负数")
	}
	return cents, nil
}

// ComputeTargetPriceCents 按用户选择的定价策略计算模板售价（单位：分，最低保底 1 分即 0.01 元）。
func ComputeTargetPriceCents(sourcePriceText, mode, modeValue string) (int64, error) {
	// normalizedMode 清理空白，空值默认为保持原价。
	normalizedMode := strings.TrimSpace(mode)
	if normalizedMode == "" {
		normalizedMode = "keep"
	}
	switch normalizedMode {
	case "keep":
		// srcCents、err 解析源商品价格，缺失或为 0 时保底 1.00 元。
		srcCents, err := ParsePriceCents(sourcePriceText, false)
		if err != nil || srcCents <= 0 {
			return 100, nil
		}
		return srcCents, nil
	case "fixed":
		// fixedCents、err 解析用户设定的统一固定售价。
		fixedCents, err := ParsePriceCents(modeValue, false)
		if err != nil || fixedCents <= 0 {
			return 0, invalid("固定售价必须大于 0 元")
		}
		return fixedCents, nil
	case "offset":
		// srcCents、srcErr 解析源商品售价。
		srcCents, srcErr := ParsePriceCents(sourcePriceText, false)
		if srcErr != nil || srcCents <= 0 {
			srcCents = 100
		}
		// deltaCents、deltaErr 解析加减价差额（支持负数降价，如 -0.50）。
		deltaCents, deltaErr := ParsePriceCents(modeValue, true)
		if deltaErr != nil {
			return 0, invalid("加减价幅度格式无效，请填写如 1.00 或 -0.50")
		}
		// target 计算最终分值并保证不低于 0.01 元（1 分）。
		target := srcCents + deltaCents
		if target < 1 {
			target = 1
		}
		return target, nil
	default:
		return 0, invalid("不支持的价格策略，仅支持 keep、offset 或 fixed")
	}
}

// truncateRunes 按 Unicode 字符数安全截断长文本，避免截断 UTF-8 多字节字符。
func truncateRunes(text string, maxRunes int) string {
	if maxRunes <= 0 || utf8.RuneCountInString(text) <= maxRunes {
		return text
	}
	// runes 是转换后的 Unicode 码点切片。
	runes := []rune(text)
	return string(runes[:maxRunes])
}
