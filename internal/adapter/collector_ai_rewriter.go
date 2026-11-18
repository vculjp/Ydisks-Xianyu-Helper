package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"

	collectorapp "xianyu-go/internal/application/collector"
	"xianyu-go/internal/db"
	"xianyu-go/internal/netguard"
)

const (
	// defaultCollectorAIBaseURL 是未显式配置接口地址时回退使用的阿里云百炼兼容端点。
	defaultCollectorAIBaseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
	// defaultCollectorAIModel 是未显式配置模型名时回退使用的默认模型。
	defaultCollectorAIModel = "qwen-plus"
)

// CollectorAIRewriter 复用系统已配置的 OpenAI 兼容大模型对采集商品标题与文案进行防同质化改写。
type CollectorAIRewriter struct {
	// store 提供受审计保护的敏感 AI 密钥与普通系统设置读取能力。
	store *db.Store
	// newHTTPClient 构造受出站网络策略保护的 HTTP 客户端，单测可注入本地服务客户端。
	newHTTPClient func(baseURL string) (*http.Client, error)
}

// NewCollectorAIRewriter 创建商品采集专用的大模型改写适配器。
func NewCollectorAIRewriter(store *db.Store) *CollectorAIRewriter {
	return &CollectorAIRewriter{
		store: store,
		newHTTPClient: func(baseURL string) (*http.Client, error) {
			return netguard.ConfiguredEndpointHTTPClient(baseURL, 40*time.Second)
		},
	}
}

// Rewrite 读取全局 AI 设置并生成去引流词、防平台同质化判重的商品标题与详情文案。
func (r *CollectorAIRewriter) Rewrite(ctx context.Context, userID int64, input collectorapp.RewriteInput) (collectorapp.RewriteResult, error) {
	if r == nil || r.store == nil || r.store.Settings == nil {
		return collectorapp.RewriteResult{}, collectorapp.ErrAIUnavailable
	}
	// apiKey、keyErr 通过系统审计通道读取已加密保存的 AI API Key。
	apiKey, keyErr := r.store.ReadSensitiveSetting(ctx, userID, "ai_api_key", "settings.use", "collector_rewrite")
	if keyErr != nil {
		return collectorapp.RewriteResult{}, fmt.Errorf("读取系统 AI 密钥失败: %w", keyErr)
	}
	if strings.TrimSpace(apiKey) == "" {
		return collectorapp.RewriteResult{}, collectorapp.ErrAIUnavailable
	}

	// baseURL 优先读取 ai_api_url，兼容回退 ai_base_url 与默认兼容端点。
	baseURL, _ := r.store.Settings.Get(ctx, "ai_api_url")
	if strings.TrimSpace(baseURL) == "" {
		baseURL, _ = r.store.Settings.Get(ctx, "ai_base_url")
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = defaultCollectorAIBaseURL
	}

	// modelName 优先读取 ai_model，兼容回退 ai_model_name。
	modelName, _ := r.store.Settings.Get(ctx, "ai_model")
	if strings.TrimSpace(modelName) == "" {
		modelName, _ = r.store.Settings.Get(ctx, "ai_model_name")
	}
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		modelName = defaultCollectorAIModel
	}

	// httpClient、clientErr 构造带超时与内网防护的客户端。
	httpClient, clientErr := r.newHTTPClient(baseURL)
	if clientErr != nil {
		return collectorapp.RewriteResult{}, fmt.Errorf("AI 接口地址无效: %w", clientErr)
	}
	// cfg 组装 go-openai 客户端配置。
	cfg := openai.DefaultConfig(strings.TrimSpace(apiKey))
	cfg.BaseURL = baseURL
	cfg.HTTPClient = httpClient
	// client 是 OpenAI 兼容协议客户端实例。
	client := openai.NewClientWithConfig(cfg)

	// systemPrompt 定义闲鱼电商上架专用的防重与合规净化规则。
	systemPrompt := buildCollectorRewriteSystemPrompt(input.CustomInstruction)
	// userPrompt 组装原标题与原文案输入。
	userPrompt := fmt.Sprintf("【原标题】\n%s\n\n【原详情文案】\n%s", input.Title, input.Description)

	// resp、callErr 调用 Chat Completions 接口获取 JSON 结果。
	resp, callErr := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model:       modelName,
		Temperature: 0.6,
		MaxTokens:   900,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: systemPrompt},
			{Role: openai.ChatMessageRoleUser, Content: userPrompt},
		},
	})
	if callErr != nil {
		return collectorapp.RewriteResult{}, fmt.Errorf("调用 AI 改写接口失败: %w", callErr)
	}
	if len(resp.Choices) == 0 {
		return collectorapp.RewriteResult{}, fmt.Errorf("AI 改写接口未返回有效内容")
	}
	return parseCollectorRewriteResponse(resp.Choices[0].Message.Content, input)
}

// buildCollectorRewriteSystemPrompt 拼装闲鱼防同质化与违禁引流词清理的系统提示词。
func buildCollectorRewriteSystemPrompt(customInstruction string) string {
	// base 定义固定结构与安全边界要求。
	base := `你是一名资深的闲鱼商品文案优化助手。请对用户提供的闲鱼商品【原标题】和【原详情文案】进行差异化防重改写：
1. 保持原商品的核心功能、规格与真实卖点不变，不捏造原商品没有的内容；
2. 调整语序、词汇与分段排版，降低平台同质化查重风险，语气自然真诚；
3. 必须自动剔除原文中可能残留的原卖家昵称、店铺名、微信号、QQ号、手机号、外站链接等违规引流字样；
4. 新标题控制在 16–28 个汉字以内，包含核心搜索热词，严禁堆砌特殊表情符号；
5. 严格只输出一个合法的 JSON 对象，格式为：{"title":"改写后的新标题","description":"改写后的完整详情文案"}，不要输出任何额外解释文字。`
	// extra 是可选附加改写要求。
	if extra := strings.TrimSpace(customInstruction); extra != "" {
		base += "\n\n【卖家附加改写要求】\n" + extra
	}
	return base
}

// parseCollectorRewriteResponse 从模型输出（纯 JSON 或 ```json 代码块）中解析新标题与新描述。
func parseCollectorRewriteResponse(raw string, fallback collectorapp.RewriteInput) (collectorapp.RewriteResult, error) {
	// trimmed 剥离常见 Markdown 代码围栏。
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```JSON")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(trimmed, "```")
	trimmed = strings.TrimSpace(trimmed)

	// start、end 定位最外层大括号以兼容模型偶发附带的前后寒暄文本。
	start := strings.Index(trimmed, "{")
	// end 记录最后一个右大括号下标。
	end := strings.LastIndex(trimmed, "}")
	if start >= 0 && end > start {
		trimmed = trimmed[start : end+1]
	}

	// payload 解码模型输出的 JSON 字段。
	var payload struct {
		// Title 是模型生成的新标题。
		Title string `json:"title"`
		// Description 是模型生成的新描述。
		Description string `json:"description"`
	}
	// err 检查模型输出是否为合法 JSON。
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return collectorapp.RewriteResult{}, fmt.Errorf("解析 AI 改写返回结果失败，请重试")
	}
	// outTitle、outDesc 兜底保证非空。
	outTitle := strings.TrimSpace(payload.Title)
	// outDesc 保存清理空白后的新描述。
	outDesc := strings.TrimSpace(payload.Description)
	if outTitle == "" {
		outTitle = fallback.Title
	}
	if outDesc == "" {
		outDesc = fallback.Description
	}
	return collectorapp.RewriteResult{Title: outTitle, Description: outDesc}, nil
}

// SuggestKeywords 调用系统已配置的大模型结合当前月份节点推荐闲鱼易起量的短搜索热词。
func (r *CollectorAIRewriter) SuggestKeywords(ctx context.Context, userID int64, niche string, count int) ([]string, error) {
	if r == nil || r.store == nil || r.store.Settings == nil {
		return nil, collectorapp.ErrAIUnavailable
	}
	// apiKey、keyErr 通过安全审计通道读取 AI 密钥。
	apiKey, keyErr := r.store.ReadSensitiveSetting(ctx, userID, "ai_api_key", "settings.use", "collector_radar_keywords")
	if keyErr != nil {
		return nil, fmt.Errorf("读取系统 AI 密钥失败: %w", keyErr)
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, collectorapp.ErrAIUnavailable
	}
	// baseURL 读取模型服务端点。
	baseURL, _ := r.store.Settings.Get(ctx, "ai_api_url")
	if strings.TrimSpace(baseURL) == "" {
		baseURL, _ = r.store.Settings.Get(ctx, "ai_base_url")
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = defaultCollectorAIBaseURL
	}
	// modelName 读取模型名称。
	modelName, _ := r.store.Settings.Get(ctx, "ai_model")
	if strings.TrimSpace(modelName) == "" {
		modelName, _ = r.store.Settings.Get(ctx, "ai_model_name")
	}
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		modelName = defaultCollectorAIModel
	}
	// httpClient、clientErr 构造安全出站客户端。
	httpClient, clientErr := r.newHTTPClient(baseURL)
	if clientErr != nil {
		return nil, fmt.Errorf("AI 接口地址无效: %w", clientErr)
	}
	// cfg 组装 OpenAI 兼容配置。
	cfg := openai.DefaultConfig(strings.TrimSpace(apiKey))
	cfg.BaseURL = baseURL
	cfg.HTTPClient = httpClient
	// client 是模型调用客户端。
	client := openai.NewClientWithConfig(cfg)

	if count <= 0 || count > 15 {
		count = 8
	}
	// monthNum 提取当前自然月以便推荐当季刚需热词。
	monthNum := int(time.Now().Month())
	// sysPrompt 限定严格输出纯 JSON 数组格式。
	sysPrompt := `你是资深闲鱼爆品选品专家。请根据卖家经营方向与当前月份季节节点，给出买家在闲鱼真实高频搜索、近期容易突然起量的精准短搜索词（每个词 3~8 个汉字，不要标点与长句）。严格只输出合法 JSON 对象：{"keywords":["热词1","热词2"]}`
	// usrPrompt 组合月份与赛道描述。
	usrPrompt := fmt.Sprintf("当前月份：%d月\n经营赛道：%s\n请输出 %d 个高转化闲鱼搜索关键词。", monthNum, niche, count)

	// resp、callErr 请求大模型生成热词。
	resp, callErr := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model:       modelName,
		Temperature: 0.7,
		MaxTokens:   450,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: sysPrompt},
			{Role: openai.ChatMessageRoleUser, Content: usrPrompt},
		},
	})
	if callErr != nil {
		return nil, fmt.Errorf("调用 AI 热词推荐失败: %w", callErr)
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("AI 未返回有效热词")
	}
	return parseSuggestedKeywordsJSON(resp.Choices[0].Message.Content)
}

// parseSuggestedKeywordsJSON 从模型响应文本中提取非空去重关键词列表。
func parseSuggestedKeywordsJSON(raw string) ([]string, error) {
	// trimmed 剥离代码块标记。
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```JSON")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(trimmed, "```")
	trimmed = strings.TrimSpace(trimmed)
	// start、end 截取大括号包裹的 JSON 主体。
	start := strings.Index(trimmed, "{")
	// end 记录右花括号位置。
	end := strings.LastIndex(trimmed, "}")
	if start >= 0 && end > start {
		trimmed = trimmed[start : end+1]
	}
	// payload 解码 keywords 数组。
	var payload struct {
		// Keywords 是模型推荐的搜索词数组。
		Keywords []string `json:"keywords"`
	}
	// err 校验 JSON 解析。
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return nil, fmt.Errorf("解析 AI 推荐热词结果失败，请重试")
	}
	// seen 去重已保留的关键词。
	seen := make(map[string]struct{}, len(payload.Keywords))
	// out 保存清洗后的关键词切片。
	out := make([]string, 0, len(payload.Keywords))
	// kw 遍历模型返回的每个词。
	for _, kw := range payload.Keywords {
		// clean 去除首尾空白。
		clean := strings.TrimSpace(kw)
		if clean == "" {
			continue
		}
		// exists 跳过重复词。
		if _, exists := seen[clean]; exists {
			continue
		}
		seen[clean] = struct{}{}
		out = append(out, clean)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("AI 未生成有效关键词，请重试")
	}
	return out, nil
}

// 编译期验证适配器满足大模型改写与爆品热词生成端口。
var (
	_ collectorapp.AIRewriterPort         = (*CollectorAIRewriter)(nil)
	_ collectorapp.AIKeywordGeneratorPort = (*CollectorAIRewriter)(nil)
)
