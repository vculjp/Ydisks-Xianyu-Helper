package collector

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	itemapp "xianyu-go/internal/application/items"
	libraryapp "xianyu-go/internal/application/library"
	"xianyu-go/internal/catalog"
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
	if !s.saveMu.TryLock() {
		return SaveTemplatesResult{}, invalid("已有模板转存正在处理，请核对本地模板后再手动操作")
	}
	defer s.saveMu.Unlock()
	// postageMode 校验并归一邮费方式，默认使用虚拟商品最常用的 none（无需邮寄）。
	postageMode := strings.TrimSpace(input.PostageMode)
	if postageMode == "" {
		postageMode = "none"
	}
	if postageMode != "none" && postageMode != "free" && postageMode != "source" {
		return SaveTemplatesResult{}, invalid("转存模板邮费模式仅支持 none（无需邮寄）、free（包邮）或 source（沿用原商品明确的运费）")
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
		if riskAborted {
			result.Failed++
			result.Results = append(result.Results, SavedTemplateOutcome{ItemID: item.ItemID, Title: item.Title, Error: "本批次已安全停止，本商品未执行，请人工核对"})
			continue
		}
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
	// source、sourceErr 校验来源标识并兼容旧客户端未提供公开信息快照的情况。
	source, sourceErr := normalizeCollectedSource(itemID, item.Source)
	if sourceErr != nil {
		return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: sourceErr.Error()}, false
	}
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
	// existingOutcome、handled 在任何外部工作前核对幂等模板；历史标题式模板不允许复用为成功。
	if existingOutcome, handled := s.findExistingCollectorOutcome(ctx, userID, collectorKey, itemID, title); handled {
		return existingOutcome, false
	}
	// needDetail 判断是否需要向平台补抓多图和详情文案。
	// 平台未提供类目频道或库存时不能无休止地重复请求同一详情；只有正文/主图尚未完成才补抓。
	needDetail := input.FetchDetailIfMissing && (!item.HasFullDetail || description == "" || description == title || len(imageURLs) == 0)
	if needDetail {
		if skipRemoteDetail || cookieID == "" || itemID == "" {
			return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: "无法补全商品详情，请核对采集账号和商品标识"}, triggeredAbort
		}
		// detail、detailErr 使用后台慢速节流（多于 1 件时）补抓完整详情。
		detail, detailErr := s.platform.FetchItemDetail(ctx, cookieID, itemID, len(input.Items) > 1)
		if detailErr != nil {
			if s.platform.IsAbortError(detailErr) {
				triggeredAbort = true
			}
			// 用户明确要求补全时不得静默降级成摘要模板。
			return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: "补抓商品详情失败：" + detailErr.Error()}, triggeredAbort
		} else {
			if detail.ItemID != itemID || !detail.HasFullDetail || strings.TrimSpace(detail.Description) == "" || len(filterNonEmptyURLs(detail.ImageURLs)) == 0 {
				return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: "返回的商品标识或详情不完整，未创建模板"}, triggeredAbort
			}
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
			// source 仅在确实重新获取到同一商品详情后整体替换，避免拼接不同时间的过期规格。
			source = detail.Source
		}
	}
	if description == "" || description == title {
		return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: "商品缺少真实详情描述或描述只有标题；请先补抓完整详情，或在商品预览里填写真实描述后再转存"}, false
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
	// publication 持有已通过核实的目标类目、SKU 和邮费；详细兼容逻辑由单独的责任函数维护。
	publication, publicationErr := s.sourcePublication(ctx, userID, itemID, source, input, postageMode)
	if publicationErr != nil {
		return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: publicationErr.Error()}, triggeredAbort
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
		PostageMode:        publication.Mode,
		PostageCents:       publication.PostageCents,
		Category:           publication.Category,
		Source:             source,
		Specs:              publication.Specs,
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
		ImageCount: len(created.ImageIDs),
	}, triggeredAbort
}

// findExistingCollectorOutcome 隔离转存模板幂等查询与历史缺损正文的拒绝判定，未命中时允许继续创建。
func (s *Service) findExistingCollectorOutcome(ctx context.Context, userID int64, collectorKey, itemID, title string) (SavedTemplateOutcome, bool) {
	// finder、ok 判断当前模板仓储是否支持幂等查找。
	finder, ok := s.templateCreator.(LibraryTemplateFinder)
	if !ok {
		return SavedTemplateOutcome{}, false
	}
	// existing、findErr 保存持久化模板查询结果。
	existing, findErr := finder.FindCollectorTemplate(ctx, userID, collectorKey)
	if errors.Is(findErr, libraryapp.ErrTemplateNotFound) {
		return SavedTemplateOutcome{}, false
	}
	if findErr != nil {
		return SavedTemplateOutcome{ItemID: itemID, Title: title, Error: "无法确认已有模板，未执行转存，请核对本地数据库"}, true
	}
	if strings.TrimSpace(existing.Description) == "" || strings.TrimSpace(existing.Description) == strings.TrimSpace(existing.Title) {
		return SavedTemplateOutcome{ItemID: itemID, Title: existing.Title, Error: "已有模板的描述缺失或只有标题，请到资源库核对并补全真实商品描述后再发布"}, true
	}
	return SavedTemplateOutcome{ItemID: itemID, Title: existing.Title, Success: true, TemplateID: existing.ID, ImageCount: len(existing.ImageIDs)}, true
}

// normalizeCollectedSource 确保来源商品身份与待转存商品一致，并为未保存来源快照的旧客户端标记待核实字段。
func normalizeCollectedSource(itemID string, source catalog.SourceInfo) (catalog.SourceInfo, error) {
	if source.ItemID != "" && source.ItemID != itemID {
		return catalog.SourceInfo{}, errors.New("来源商品 ID 与所选商品不一致，未创建模板")
	}
	if source.ItemID == "" {
		// 老客户端不能通过缺失的来源标识绕过原商品资料的完整性检查。
		source.Missing = []string{"原商品完整类目", "原商品库存", "运费方式", "规格和 SKU", "公开商品属性"}
		source.ItemID = itemID
	}
	// 原商品链接固定由已校验的商品 ID 生成，避免客户端传入任意站外地址或脚本 URL。
	source.WebURL = "https://www.goofish.com/item?id=" + url.QueryEscape(itemID)
	return source, nil
}

// sourcePublicationData 保存可传入本地发布模板的类目、规格与运费配置，不含原卖家私有发布凭证。
type sourcePublicationData struct {
	// Category 只有来源详情完整确认原类目三元组时才赋值。
	Category itemapp.BatchPreviewCategory
	// Specs 是已核实并完成图片入库的规格 SKU 组合。
	Specs *libraryapp.TemplateSpecs
	// Mode 是用户明确选择的运费方式。
	Mode string
	// PostageCents 是该方式下可核实的固定邮费（分）。
	PostageCents int64
}

// sourcePublication 只将可验证的来源字段用于模板发布设置，并维持用户显式指定的运费偏好。
func (s *Service) sourcePublication(ctx context.Context, userID int64, itemID string, source catalog.SourceInfo, input SaveTemplatesInput, postageMode string) (sourcePublicationData, error) {
	// result 初始保留用户明示的运费方式。
	result := sourcePublicationData{Mode: postageMode}
	// specs、specErr 仅将完整可核实的规格图片和 SKU 转为本地模板。
	specs, specErr := s.sourceTemplateSpecs(ctx, userID, itemID, source, input)
	if specErr != nil {
		return sourcePublicationData{}, specErr
	}
	result.Specs = specs
	if source.Category.Complete() {
		result.Category = itemapp.BatchPreviewCategory{CatID: source.Category.CatID, CatName: source.Category.CatName, ChannelCatID: source.Category.ChannelCatID, TBCatID: source.Category.TBCatID}
	}
	if postageMode == "source" {
		if source.PostageMode == "" {
			return sourcePublicationData{}, errors.New("原商品运费方式缺失，请手动选择运费方式后转存")
		}
		result.Mode = source.PostageMode
		if result.Mode == "fixed" {
			// feeErr 表示明确的来源金额不符合发布价格格式。
			var feeErr error
			result.PostageCents, feeErr = ParsePriceCents(source.Postage, true)
			if feeErr != nil {
				return sourcePublicationData{}, errors.New("来源商品运费金额格式无效")
			}
		}
	}
	return result, nil
}

// sourceTemplateSpecs 把来源 SKU 及规格图安全转换为资源库内的真实图片主键；
// 未取得全部组合时不构造可发布规格，避免错误推断价格、库存与属性。
func (s *Service) sourceTemplateSpecs(ctx context.Context, userID int64, itemID string, source catalog.SourceInfo, input SaveTemplatesInput) (*libraryapp.TemplateSpecs, error) {
	if len(source.Specs) == 0 || len(source.SKUs) == 0 {
		return nil, nil
	}
	// converted 保存规格维度和 SKU 的有序可发布结果。
	converted := &libraryapp.TemplateSpecs{}
	// urls 保存规格图片的唯一来源地址，规格值索引引用该列表的固定位置。
	urls := make([]string, 0)
	// lookup 用于同一图片被多个规格值引用的去重。
	lookup := make(map[string]int)
	for _, spec := range source.Specs {
		// dimension 是当前规格维度的可发布表示。
		dimension := itemapp.PublishSpec{PropertyName: spec.Name}
		for _, value := range spec.Values {
			// imageIndex 是当前规格值在规格图片序列中的索引，-1 为无图。
			imageIndex := -1
			if value.ImageURL != "" {
				// known 标识该图片是否已被前面的规格值引用。
				known, exists := lookup[value.ImageURL]
				if !exists {
					known = len(urls)
					lookup[value.ImageURL] = known
					urls = append(urls, value.ImageURL)
				}
				imageIndex = known
				dimension.SupportImage = true
			}
			dimension.Values = append(dimension.Values, itemapp.PublishSpecValue{Value: value.Value, ImageIndex: imageIndex})
		}
		converted.Specs = append(converted.Specs, dimension)
	}
	for _, sourceSKU := range source.SKUs {
		// price、err 是当前规格组合应用用户选择的原价、加减价或固定价策略后的售价（分）。
		price, err := ComputeTargetPriceCents(sourceSKU.Price, input.PriceMode, input.PriceValue)
		if err != nil {
			return nil, fmt.Errorf("源 SKU 售价格式错误：%w", err)
		}
		// sku 采用来源详情明确返回的库存量，不从顶层商品数量猜测。
		sku := itemapp.PublishSKU{PriceCents: price, Quantity: sourceSKU.Quantity}
		for index, label := range sourceSKU.ValueLabels {
			if index >= len(source.Specs) {
				return nil, errors.New("源 SKU 规格数量不匹配")
			}
			sku.PropertyList = append(sku.PropertyList, itemapp.PublishSKUProperty{PropertyText: source.Specs[index].Name, ValueText: label})
		}
		converted.SKUs = append(converted.SKUs, sku)
	}
	// 规格图必须真实下载存入图片库，不能把外部 URL 当作图片主键或假定与主图一致。
	if len(urls) > 0 {
		// ids、err 保存依序下载的来源规格图主键。
		ids, err := s.downloadAndStoreImages(ctx, userID, itemID, urls)
		if err != nil {
			return nil, fmt.Errorf("保存原商品规格图失败：%w", err)
		}
		converted.SpecImageIDs = ids
	}
	return converted, nil
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
			// 请求中的图片必须全部可用，不能将缺图模板误报成功。
			return nil, fmt.Errorf("第 %d 张图片下载失败，请核对图片后再转存", idx+1)
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
	if len(stored) != len(uploads) {
		return nil, fmt.Errorf("图片库返回的结果数量不一致，未创建模板")
	}
	// ids 提取保持主图顺序的图片主键。
	ids := make([]int64, 0, len(stored))
	// idx、res 分别对应主图或副图顺序及单张上传结果；不允许无效图 ID 进入模板。
	for idx, res := range stored {
		if res.Error != "" || res.Image.ID <= 0 {
			return nil, fmt.Errorf("第 %d 张图片写入图片库失败，未创建模板", idx+1)
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
