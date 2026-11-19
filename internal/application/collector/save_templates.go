package collector

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	itemapp "xianyu-go/internal/application/items"
	libraryapp "xianyu-go/internal/application/library"
)

// SaveToTemplates 将勾选的采集商品顺序补齐详情（可选）、执行 AI 防重改写（可选）、下载主图至图片库并创建本地商品模板。
func (s *Service) SaveToTemplates(ctx context.Context, userID int64, input SaveTemplatesInput) (SaveTemplatesResult, error) {
	if userID <= 0 {
		return SaveTemplatesResult{}, invalid("用户会话无效")
	}
	if len(input.Items) == 0 {
		return SaveTemplatesResult{}, invalid("请至少勾选一件要转存的商品")
	}
	if len(input.Items) > MaxSaveTemplateBatch {
		return SaveTemplatesResult{}, invalid(fmt.Sprintf("单次最多支持转存 %d 件商品到模板库（当前 %d 件）", MaxSaveTemplateBatch, len(input.Items)))
	}
	// postageMode 校验并归一邮费方式，默认使用虚拟商品最常用的 none（无需邮寄）。
	postageMode := strings.TrimSpace(input.PostageMode)
	if postageMode == "" {
		postageMode = "none"
	}
	if postageMode != "none" && postageMode != "free" {
		return SaveTemplatesResult{}, invalid("转存模板邮费模式仅支持 none（无需邮寄）或 free（包邮）")
	}
	// quantity 归一默认库存。
	quantity := input.Quantity
	if quantity <= 0 {
		quantity = 5
	}
	// cookieID 在开启缺失详情补抓时必须校验归属。
	cookieID := strings.TrimSpace(input.CookieID)
	if input.FetchDetailIfMissing && cookieID != "" {
		// err 校验补抓详情账号归属权限。
		if err := s.requireOwnedAccount(ctx, userID, cookieID); err != nil {
			return SaveTemplatesResult{}, err
		}
	}
	if input.EnableAIRewrite && s.rewriter == nil {
		return SaveTemplatesResult{}, ErrAIUnavailable
	}
	// err 预先校验定价策略与金额文本是否合法。
	if _, err := ComputeTargetPriceCents("10.00", input.PriceMode, input.PriceValue); err != nil {
		return SaveTemplatesResult{}, err
	}

	// automation 组装可选绑定的默认发货模板规则（如直接关联虚拟网盘通用发货模板）。
	automation := buildDefaultTemplateAutomation(input.DeliveryTemplateID, input.CustomVariables)

	// result 初始化批量转存汇总结构。
	result := SaveTemplatesResult{
		Total:   len(input.Items),
		Results: make([]SavedTemplateOutcome, 0, len(input.Items)),
	}
	// riskAborted 一旦在补抓详情时命中平台风控，后续条目不再发起任何平台详情请求。
	riskAborted := false
	// batchCtx、cancel 为同步转存保留 HTTP 写响应时间；超时后返回已有结果而非要求用户盲目重试。
	batchCtx, cancel := context.WithTimeout(ctx, 100*time.Second)
	defer cancel()

	// idx、item 按顺序逐件处理转存任务。
	for idx, item := range input.Items {
		if batchCtx.Err() != nil {
			result.Failed++
			result.Results = append(result.Results, SavedTemplateOutcome{ItemID: item.ItemID, Title: item.Title, Error: "批次已取消或达到时间预算，本商品尚未执行"})
			continue
		}
		// outcome、aborted 处理单件商品的补详情、AI 改写、下图与模板创建。
		outcome, aborted := s.saveSingleTemplateItem(batchCtx, userID, cookieID, idx, item, input, postageMode, quantity, automation, riskAborted)
		if aborted {
			riskAborted = true
			result.AbortedByRisk = true
		}
		if outcome.Success {
			result.Succeeded++
		} else {
			result.Failed++
		}
		result.Results = append(result.Results, outcome)
	}
	return result, nil
}

// saveSingleTemplateItem 执行单条商品从采集快照到本地资源库模板的完整落库链路。
func (s *Service) saveSingleTemplateItem(
	ctx context.Context,
	userID int64,
	cookieID string,
	index int,
	item SaveTemplateItem,
	input SaveTemplatesInput,
	postageMode string,
	quantity int,
	automation itemapp.BatchPreviewAutomation,
	skipRemoteDetail bool,
) (SavedTemplateOutcome, bool) {
	// itemID、title、description、priceText、origPriceText、imageURLs 保存当前条目的工作副本。
	itemID := strings.TrimSpace(item.ItemID)
	// title 保存当前标题。
	title := strings.TrimSpace(item.Title)
	// description 保存当前描述。
	description := strings.TrimSpace(item.Description)
	// priceText 保存源售价文本。
	priceText := strings.TrimSpace(item.Price)
	// origPriceText 保存源原价文本。
	origPriceText := strings.TrimSpace(item.OriginalPrice)
	// imageURLs 复制已知主图地址列表。
	imageURLs := filterNonEmptyURLs(item.ImageURLs)
	// triggeredAbort 记录本条是否新触发了风控熔断。
	triggeredAbort := false
	// keyInput 是单商品的原始转存请求，排除批次其他商品和账号选择以保证等价重试的摘要稳定。
	keyInput := input
	keyInput.Items = []SaveTemplateItem{item}
	keyInput.CookieID = ""
	// encoded、encodeErr 保存幂等摘要的输入及编码异常，原始内容不得记录日志。
	encoded, encodeErr := json.Marshal(keyInput)
	if encodeErr != nil {
		return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: "生成转存幂等标识失败"}, false
	}
	// collectorKey 是持久化唯一约束使用的单商品 SHA-256 摘要。
	collectorKey := fmt.Sprintf("%x", sha256.Sum256(encoded))

	// needDetail 判断是否需要向平台补抓多图和详情文案。
	needDetail := input.FetchDetailIfMissing && !skipRemoteDetail && cookieID != "" && itemID != "" && (!item.HasFullDetail || description == "" || len(imageURLs) == 0)
	if needDetail {
		// detail、detailErr 使用后台慢速节流（多于 1 件时）补抓完整详情。
		detail, detailErr := s.platform.FetchItemDetail(ctx, cookieID, itemID, len(input.Items) > 1)
		if detailErr != nil {
			if s.platform.IsAbortError(detailErr) {
				triggeredAbort = true
			}
			// 若列表本身尚未携带标题或封面图则无法继续落库；若已有标题与高清封面主图，则停止继续请求详情并安全降级用已有图文入库。
			if title == "" || len(imageURLs) == 0 {
				return SavedTemplateOutcome{
					ItemID: itemID,
					Title:  title,
					Error:  "补抓商品详情失败：" + detailErr.Error(),
				}, triggeredAbort
			}
		} else {
			if title == "" {
				title = detail.Title
			}
			if description == "" || (!item.HasFullDetail && description == item.Title) {
				description = detail.Description
			}
			if priceText == "" || priceText == "0.00" || priceText == "0" {
				priceText = detail.Price
			}
			if origPriceText == "" {
				origPriceText = detail.OriginalPrice
			}
			if len(detail.ImageURLs) > 0 {
				imageURLs = filterNonEmptyURLs(detail.ImageURLs)
			}
		}
	}

	if description == "" {
		description = title
	}
	if input.EnableAIRewrite {
		// rewritten、rewriteErr 调用大模型做防重改写。
		rewritten, rewriteErr := s.RewriteItem(ctx, userID, RewriteInput{
			Title:             title,
			Description:       description,
			CustomInstruction: input.CustomInstruction,
		})
		if rewriteErr != nil {
			return SavedTemplateOutcome{
				ItemID: itemID,
				Title:  title,
				Error:  "AI 改写失败：" + rewriteErr.Error(),
			}, triggeredAbort
		}
		title = rewritten.Title
		description = rewritten.Description
	}

	if title == "" {
		return SavedTemplateOutcome{ItemID: itemID, Error: fmt.Sprintf("第 %d 条商品缺少标题", index+1)}, triggeredAbort
	}
	if len(imageURLs) == 0 {
		return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: "商品没有任何可用主图链接"}, triggeredAbort
	}
	if len(imageURLs) > MaxCollectedImagesPerItem {
		imageURLs = imageURLs[:MaxCollectedImagesPerItem]
	}

	// priceCents、priceErr 按定价策略计算模板售价（分）。
	priceCents, priceErr := ComputeTargetPriceCents(priceText, input.PriceMode, input.PriceValue)
	if priceErr != nil {
		return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: priceErr.Error()}, triggeredAbort
	}
	// origCents 计算可选划线原价（分），低于售价时清零避免闲鱼报错。
	var origCents int64
	if origPriceText != "" {
		// parsedOrig、err 解析划线原价文本。
		if parsedOrig, err := ParsePriceCents(origPriceText, false); err == nil && parsedOrig > priceCents {
			origCents = parsedOrig
		}
	}

	// imageIDs、imgErr 下载全部主图并存入本地资源库图片库（按内容 SHA-256 自动去重）。
	imageIDs, imgErr := s.downloadAndStoreImages(ctx, userID, itemID, imageURLs)
	if imgErr != nil {
		return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: imgErr.Error()}, triggeredAbort
	}

	// templateName 取自定义备注名或默认截取商品标题前 100 字。
	templateName := strings.TrimSpace(item.Name)
	if templateName == "" {
		templateName = truncateRunes(title, 100)
	}
	// created、createErr 调用资源库模板服务完成完整校验（含发货模板变量校验）与落库。
	created, createErr := s.templateCreator.CreateTemplate(ctx, libraryapp.Template{
		UserID:             userID,
		CollectorKey:       collectorKey,
		Name:               templateName,
		Title:              truncateRunes(title, 255),
		Description:        description,
		PriceCents:         priceCents,
		OriginalPriceCents: origCents,
		Quantity:           quantity,
		PostageMode:        postageMode,
		ImageIDs:           imageIDs,
		Automation:         automation,
	})
	if createErr != nil {
		return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: createErr.Error()}, triggeredAbort
	}
	return SavedTemplateOutcome{
		ItemID:     itemID,
		Title:      created.Title,
		Success:    true,
		TemplateID: created.ID,
		ImageCount: len(imageIDs),
	}, triggeredAbort
}

// downloadAndStoreImages 顺序下载商品远程主图并写入用户的本地图片库，返回图片主键列表。
func (s *Service) downloadAndStoreImages(ctx context.Context, userID int64, itemID string, urls []string) ([]int64, error) {
	// uploads 收集下载成功的图片字节与推断文件名。
	uploads := make([]libraryapp.ImageUpload, 0, len(urls))
	// idx、rawURL 顺序下载每张远程图片。
	for idx, rawURL := range urls {
		// data、fetchErr 经受保护的出站客户端下载图片。
		data, fetchErr := s.imageDownloader.Fetch(ctx, rawURL)
		if fetchErr != nil {
			// 首张主图下载失败时整条失败；次要副图偶发失效且已有主图时跳过坏副图以提升成功率。
			if idx == 0 || len(uploads) == 0 {
				return nil, fmt.Errorf("下载主图失败（%s）", fetchErr.Error())
			}
			continue
		}
		uploads = append(uploads, libraryapp.ImageUpload{
			Filename: buildCollectedImageFilename(itemID, idx+1, rawURL),
			Data:     data,
		})
	}
	// stored、uploadErr 批量写入图片库（已存在的相同图片会自动复用已有 ID）。
	stored, uploadErr := s.imageUploader.UploadImages(ctx, userID, uploads)
	if uploadErr != nil {
		return nil, fmt.Errorf("写入图片库失败：%w", uploadErr)
	}
	// ids 提取保持主图顺序的图片主键。
	ids := make([]int64, 0, len(stored))
	// idx、res 分别对应主图或副图顺序及单张上传结果；不允许无效图 ID 进入模板。
	for idx, res := range stored {
		if res.Error != "" || res.Image.ID <= 0 {
			if idx == 0 {
				return nil, fmt.Errorf("主图写入图片库失败：%s", res.Error)
			}
			continue
		}
		ids = append(ids, res.Image.ID)
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("未生成可用的本地图片")
	}
	return ids, nil
}

// buildDefaultTemplateAutomation 当用户指定了发货模板 ID 时构造付款自动发货动作配置。
func buildDefaultTemplateAutomation(deliveryTemplateID int64, customVars map[string]string) itemapp.BatchPreviewAutomation {
	if deliveryTemplateID <= 0 {
		return itemapp.BatchPreviewAutomation{}
	}
	// copiedVars 复制非空自定义变量键值（例如 link），避免共享外部 map。
	copiedVars := make(map[string]string, len(customVars))
	// k、v 遍历传入的变量表。
	for k, v := range customVars {
		// trimmedKey 是去除空白后的变量名。
		if trimmedKey := strings.TrimSpace(k); trimmedKey != "" {
			copiedVars[trimmedKey] = strings.TrimSpace(v)
		}
	}
	return itemapp.BatchPreviewAutomation{
		PaidDelivery: itemapp.BatchPreviewCardAutomation{
			Enabled: true,
			Actions: []itemapp.BatchPreviewCardAction{
				{
					ActionType:         "delivery_template",
					DeliveryTemplateID: deliveryTemplateID,
					CustomVariables:    copiedVars,
				},
			},
		},
	}
}

// filterNonEmptyURLs 去除空白与重复的图片链接并保持原有顺序。
func filterNonEmptyURLs(raw []string) []string {
	// seen 记录已保留的链接。
	seen := make(map[string]struct{}, len(raw))
	// out 保存清理后的有效链接切片。
	out := make([]string, 0, len(raw))
	// item 是候选图片 URL。
	for _, item := range raw {
		// trimmed 是去空白后的链接。
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		// exists 判断链接是否已添加。
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

// buildCollectedImageFilename 为采集图片生成清晰可读的文件名，保留合法图片扩展名或交由图片库按字节嗅探补全。
func buildCollectedImageFilename(itemID string, index int, rawURL string) string {
	// prefix 用商品 ID 前缀命名便于在图片库检索来源。
	prefix := strings.TrimSpace(itemID)
	if prefix == "" {
		prefix = "collect"
	}
	// ext 尝试从 URL 路径提取常见图片后缀。
	ext := ".jpg"
	// parsed、err 解析远程图片 URL 路径。
	if parsed, err := url.Parse(rawURL); err == nil {
		// candidateExt 是小写路径扩展名。
		candidateExt := strings.ToLower(path.Ext(parsed.Path))
		switch candidateExt {
		case ".jpg", ".jpeg", ".png", ".webp", ".gif":
			ext = candidateExt
		}
	}
	return fmt.Sprintf("collect_%s_%d%s", prefix, index, ext)
}
