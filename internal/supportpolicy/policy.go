// Package supportpolicy 负责不依赖模型或平台的客服知识选择、回复质量门禁及人工介入状态语义。
package supportpolicy

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// ConfigKey 是每个本地用户独立的客服知识配置键。
const ConfigKey = "customer_support_v1"

// TakeoverPrefix 是人工接管记录的专用用户设置键前缀。
const TakeoverPrefix = "support_takeover_v1_"

// Entry 表示一份商家公开客服资料；填写问题时作为精确匹配 FAQ，否则作为生成回复参考。
type Entry struct {
	// Scope 是全局、店铺或商品三级归属。
	Scope string `json:"scope"`
	// AccountID 是店铺或商品资料所属账号。
	AccountID string `json:"account_id"`
	// ItemID 仅在商品级资料中填写。
	ItemID string `json:"item_id"`
	// Title 是供商家辨认资料的标题。
	Title string `json:"title"`
	// Question 是精确匹配的常见问题；空值表示事实资料。
	Question string `json:"question"`
	// Answer 是商家确认过的公开答案或事实。
	Answer string `json:"answer"`
}

// Config 是当前本地用户自己的知识库及安全客服开关，默认关闭。
type Config struct {
	// Enabled 启用受控知识与质量检查模式，不会替代付款后交付。
	Enabled bool `json:"enabled"`
	// Entries 保存有界的知识条目。
	Entries []Entry `json:"entries"`
}

// Decision 是知识选择的纯结果，不涉及平台请求或模型调用。
type Decision struct {
	// Answer 是精确匹配的安全 FAQ 回复。
	Answer string
	// Scope 是匹配 FAQ 的归属层级。
	Scope string
	// Facts 是限定在本店本商品范围内的公开事实。
	Facts string
	// Reason 非空时表示建议人工核对的原因。
	Reason string
}

// Decode 校验持久化配置，损坏数据不得被解释为已关闭。
func Decode(raw string) (Config, error) {
	// cfg 是解码后经过限制的客服配置。
	cfg := Config{Entries: []Entry{}}
	if strings.TrimSpace(raw) == "" {
		return cfg, nil
	}
	if len(raw) > 48000 {
		return Config{}, errors.New("客服配置超过大小上限")
	}
	// err 是持久化数据的 JSON 格式错误；拒绝 null 等非对象值。
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil || !strings.HasPrefix(strings.TrimSpace(raw), "{") {
		return Config{}, errors.New("客服配置格式无效")
	}
	if len(cfg.Entries) > 60 {
		return Config{}, errors.New("最多保存 60 条客服资料")
	}
	// seen 防止同一归属内重复录入完全相同的 FAQ 问题。
	seen := map[string]bool{}
	// index、entry 是待规范化和校验的资料。
	for index, entry := range cfg.Entries {
		entry.Title, entry.Question, entry.Answer = strings.TrimSpace(entry.Title), strings.TrimSpace(entry.Question), strings.TrimSpace(entry.Answer)
		entry.AccountID, entry.ItemID = strings.TrimSpace(entry.AccountID), strings.TrimSpace(entry.ItemID)
		if entry.Title == "" || entry.Answer == "" || utf8.RuneCountInString(entry.Title) > 80 || utf8.RuneCountInString(entry.Question) > 120 || utf8.RuneCountInString(entry.Answer) > 600 {
			return Config{}, errors.New("知识标题、问题或正文为空或超过长度限制")
		}
		if !((entry.Scope == "global" && entry.AccountID == "" && entry.ItemID == "") || (entry.Scope == "account" && entry.AccountID != "" && entry.ItemID == "") || (entry.Scope == "item" && entry.AccountID != "" && entry.ItemID != "")) {
			return Config{}, errors.New("知识归属配置无效")
		}
		if blockedMaterial(entry.Title) || blockedMaterial(entry.Question) || blockedMaterial(entry.Answer) {
			return Config{}, errors.New("客服知识不得保存链接、密钥或个人联系方式")
		}
		if entry.Question != "" {
			// key 是归属范围内标准化的问题。
			key := entry.Scope + "\x00" + entry.AccountID + "\x00" + entry.ItemID + "\x00" + normalizeQuestion(entry.Question)
			if seen[key] {
				return Config{}, errors.New("同一范围存在重复 FAQ")
			}
			seen[key] = true
		}
		cfg.Entries[index] = entry
	}
	if cfg.Entries == nil {
		cfg.Entries = []Entry{}
	}
	return cfg, nil
}

// normalizeQuestion 忽略空白及末尾问句标点，但不忽略附加诉求。
func normalizeQuestion(value string) string {
	return strings.TrimRightFunc(strings.ToLower(strings.TrimSpace(value)), func(r rune) bool { return unicode.IsSpace(r) || strings.ContainsRune("？?!！。.", r) })
}

// secretPattern 检查常见链接、凭证字段和联系方式；它是保守启发式而非完整 DLP。
var secretPattern = regexp.MustCompile(`(?i)(https?://|www\.|pan\.baidu|pan\.quark|quark\.cn|(?:提取码|解压密码|激活码|卡密|密码|api[_ -]?key|token|cookie)\s*[:：=]|\b1[3-9][0-9]{9}\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})`)

// commitmentPattern 拦截常见的退款、赔偿、保证及已完成操作承诺。
var commitmentPattern = regexp.MustCompile(`(保证|百分之百|100%|包成功|一定能|已为您|已经为你|退款|退货|赔偿|赔付|补偿|已经改价)`)

// discountPattern 拦截非议价生成回复中的明显优惠承诺。
var discountPattern = regexp.MustCompile(`(给你便宜|给您便宜|优惠价|折扣价|给你优惠|给您优惠|打[一二三四五六七八九0-9]折|(?:最低|成交|到手|只要|仅需).{0,12}[0-9]+(?:\.[0-9]+)?[元块])`)

// blockedMaterial 判断文本是否包含典型敏感材料，避免把它注入模型。
func blockedMaterial(value string) bool { return secretPattern.MatchString(value) }

// SafeContext 避免把含潜在秘密的整段旧资料或历史消息发送到模型，不尝试猜测秘密的边界。
func SafeContext(value string) string {
	if blockedMaterial(value) {
		return "（含敏感信息，已省略）"
	}
	return value
}

// RiskReason 对退款、投诉、凭证索取及越权指令采用保守人工接管。
func RiskReason(message string) string {
	if utf8.RuneCountInString(message) > 1000 {
		return "消息过长，需人工核对"
	}
	// normalized 是仅用于本地匹配的原始消息小写文本。
	normalized := strings.ToLower(message)
	// word 是需要人工处理的风险关键词。
	for _, word := range []string{"退款", "退货", "投诉", "举报", "赔偿", "客服人工", "转人工", "人工客服", "提取码", "卡密", "激活码", "解压密码", "网盘链接", "发链接", "忽略之前", "忽略所有", "系统提示词", "system prompt", "ignore previous", "api key", "cookie", "token"} {
		if strings.Contains(normalized, word) {
			return "买家诉求涉及人工确认、私密资料或越权指令"
		}
	}
	if blockedMaterial(message) {
		return "消息包含可能的敏感信息"
	}
	return ""
}

// CheckReply 检查公开回复的长度、敏感信息和明确承诺，不声称证明事实真实或覆盖所有变体。
func CheckReply(reply string, bargain bool) string {
	if strings.TrimSpace(reply) == "" {
		return "回复为空"
	}
	if utf8.RuneCountInString(reply) > 300 {
		return "回复过长，需人工检查"
	}
	if blockedMaterial(reply) {
		return "可能泄露凭证、链接或联系方式"
	}
	if strings.Contains(strings.ToLower(reply), "system prompt") || strings.Contains(reply, "系统提示词") || strings.Contains(reply, "<item_context>") || strings.Contains(reply, "<order_context>") {
		return "可能泄露内部指令或事实区"
	}
	if commitmentPattern.MatchString(reply) || (!bargain && discountPattern.MatchString(reply)) {
		return "存在未经确认的承诺"
	}
	return ""
}

// Resolve 从具体到通用匹配 FAQ，选择最多六份同范围事实；风险问题优先人工。
func (c Config) Resolve(accountID, itemID, message string) Decision {
	// reason 是买家诉求的风险分类。
	if reason := RiskReason(message); reason != "" {
		return Decision{Reason: reason}
	}
	// result 汇总本次本地决策。
	var result Decision
	// facts 只保存可用于当前商品的有界事实。
	var facts []string
	// scope 是从最具体到通用的检索顺序。
	for _, scope := range []string{"item", "account", "global"} {
		// entry 是当前检查的公开资料。
		for _, entry := range c.Entries {
			if entry.Scope != scope || (scope != "global" && entry.AccountID != accountID) || (scope == "item" && (itemID == "" || entry.ItemID != itemID)) {
				continue
			}
			if entry.Question != "" {
				if result.Answer == "" && normalizeQuestion(entry.Question) == normalizeQuestion(message) {
					// reason 是商家话术的安全检查结果。
					if reason := CheckReply(entry.Answer, false); reason != "" {
						return Decision{Reason: reason}
					}
					result.Answer, result.Scope = entry.Answer, scope
				}
				continue
			}
			if len(facts) < 6 {
				facts = append(facts, entry.Title+"："+entry.Answer)
			}
		}
	}
	result.Facts = strings.Join(facts, "\n")
	return result
}

// Takeover 是每个独立会话的持久化接管记录；不保存聊天内容或买家个人资料。
type Takeover struct {
	// AccountID 是记录所属账号。
	AccountID string `json:"account_id"`
	// ChatID 是标准化会话标识。
	ChatID string `json:"chat_id"`
	// Until 是 Unix 秒；-1 表示等待人工恢复，0 表示已恢复。
	Until int64 `json:"until"`
	// Reason 只保存固定原因分类。
	Reason string `json:"reason"`
	// UpdatedAt 是记录更新的 Unix 毫秒时间。
	UpdatedAt int64 `json:"updated_at"`
}

// NormalizeChatID 将裸会话标识与协议后缀归一。
func NormalizeChatID(value string) string {
	return strings.TrimSuffix(strings.TrimSpace(value), "@goofish")
}

// TakeoverKey 使用账号和会话的哈希作为键，避免键长度或分隔符冲突。
func TakeoverKey(accountID, chatID string) string {
	return fmt.Sprintf("%s%x", TakeoverPrefix, sha256.Sum256([]byte(strings.TrimSpace(accountID)+"\x00"+NormalizeChatID(chatID))))
}

// Active 判断接管是否仍生效。
func (r Takeover) Active(now time.Time) bool { return r.Until == -1 || r.Until > now.Unix() }

// DecodeTakeover 校验人工接管记录的身份、期限与原因。
func DecodeTakeover(key, raw string) (Takeover, error) {
	// row 是持久化或人工提交的接管状态。
	var row Takeover
	if len(raw) > 2048 || json.Unmarshal([]byte(raw), &row) != nil {
		return row, errors.New("接管记录格式无效")
	}
	row.AccountID, row.ChatID = strings.TrimSpace(row.AccountID), NormalizeChatID(row.ChatID)
	if row.AccountID == "" || row.ChatID == "" || len(row.ChatID) > 160 || key != TakeoverKey(row.AccountID, row.ChatID) || row.Until < -1 {
		return row, errors.New("接管记录身份无效")
	}
	switch row.Reason {
	case "human", "risk", "operator", "resumed":
	default:
		return row, errors.New("接管记录原因无效")
	}
	return row, nil
}
