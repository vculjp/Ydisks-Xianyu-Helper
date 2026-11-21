package mtop

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ItemEditDetailAPI 是闲鱼 PC 端读取已有商品编辑载荷的接口。
const ItemEditDetailAPI = "https://h5api.m.goofish.com/h5/mtop.idle.pc.idleitem.editDetail/1.0/"

// ItemEditAPI 是闲鱼 PC 端提交已有商品编辑、尝试重新上架的接口。
const ItemEditAPI = "https://h5api.m.goofish.com/h5/mtop.idle.pc.idleitem.edit/1.0/"

// ItemDownShelfAPI 是卖家主动下架单件商品的接口。
const ItemDownShelfAPI = "https://h5api.m.goofish.com/h5/mtop.taobao.idle.item.downshelf/2.0/"

// RemoteItemEdit 保存用户明确修改的字段；nil 表示沿用平台原有值。
type RemoteItemEdit struct {
	// Title 只更新商品标题，不影响其描述。
	Title *string
	// Description 只更新商品描述，不影响其标题。
	Description *string
	// PriceCents 只更新商品售价，单位为分。
	PriceCents *int64
}

// FetchItemEditDetail 只读取平台编辑详情；不会向平台提交任何编辑或上架操作。
// 返回值仅限内部平台适配器，禁止直接传给前端或持久化原始响应。
func (c *ClientImpl) FetchItemEditDetail(ctx context.Context, cookies, itemID string) (map[string]any, string, error) {
	if strings.TrimSpace(itemID) == "" {
		return nil, "", errors.New("商品 ID 不能为空")
	}
	// decoded、updated、err 分别为平台响应、可能更新的 Cookie 和网络/协议错误。
	decoded, updated, err := c.callMTop(ctx, cookies, ItemEditDetailAPI, "mtop.idle.pc.idleitem.editDetail", "1.0",
		"a21ybx.publish.0.0", "a21ybx.publish.0.0", "item-edit-detail", map[string]any{"itemId": itemID})
	if err != nil {
		return nil, updated, err
	}
	// ret 是平台编辑详情的业务返回标记，不能仅凭 HTTP 200 判定成功。
	ret := retFromDecoded(decoded)
	if !hasMTopSuccess(ret) {
		return nil, updated, c.mtopResponseFailure("mtop.idle.pc.idleitem.editDetail", 200, ret, "读取平台编辑详情失败")
	}
	// detail 是仅在本次请求内使用的平台可编辑商品结构。
	detail := mapFromAny(decoded["data"])
	if detail == nil {
		return nil, updated, errors.New("平台未返回可编辑商品详情")
	}
	return detail, updated, nil
}

// buildExistingItemEditPayload 白名单抽取编辑详情，保护图片、规格、分类、发货地等未修改字段。
// 遇到无图片、类目、价格或标题的编辑快照则拒绝提交，防止不完整载荷覆盖原商品。
func buildExistingItemEditPayload(detail map[string]any, itemID string, changes RemoteItemEdit) (map[string]any, error) {
	if detail == nil || strings.TrimSpace(itemID) == "" {
		return nil, errors.New("商品编辑详情不完整")
	}
	// payload 是提交给 PC 编辑接口的完整字段白名单，排除响应内部凭证和诊断字段。
	payload := make(map[string]any)
	// key 是当前允许继承的平台标量字段名称。
	for _, key := range []string{"attribute_biz_line", "bizcode", "bucketId", "canBargain", "defaultPrice", "freebies",
		"itemStatus", "itemTypeStr", "quantity", "scene", "simpleItem", "supportBargainPrice", "topics"} {
		// value、exists 保存详情中已存在的白名单标量，缺失字段不能凭空补造。
		if value, exists := detail[key]; exists {
			payload[key] = value
		}
	}
	// key 是当前需要完整保留的平台商品对象字段名称。
	for _, key := range []string{"asyncSecurityInfo", "baseParams", "itemAddrDTO", "itemCatDTO", "itemGroupDTO",
		"itemPostFeeDTO", "itemPriceDTO", "itemTextDTO", "itemTopicParams", "yhbItemInfoDTO"} {
		// value、exists 是平台编辑详情中需要完整保留的对象值。
		if value, exists := detail[key]; exists {
			payload[key] = value
		}
	}
	// key 是当前需要保留全部元素的平台列表字段名称。
	for _, key := range []string{"imageInfoDOList", "itemLabelExtList", "itemProperties", "itemSkuList", "userRightsProtocols"} {
		// value、exists 是平台详情中存在的列表值，原样复制避免丢失商品配置。
		if value, exists := detail[key]; exists {
			payload[key] = value
		}
	}
	// images、ok 表示编辑快照已包含原始主图，不允许发空图片覆盖。
	images, ok := payload["imageInfoDOList"].([]any)
	if !ok || len(images) == 0 {
		return nil, errors.New("平台商品图片详情缺失，已阻止不完整编辑")
	}
	// category、textDTO、priceDTO 分别为必须完整保留的分类、文案与价格结构。
	category := mapFromAny(payload["itemCatDTO"])
	// textDTO 保存平台原有的标题和完整描述，保证二者分离。
	textDTO := mapFromAny(payload["itemTextDTO"])
	// priceDTO 保存平台已有的售价和原价结构。
	priceDTO := mapFromAny(payload["itemPriceDTO"])
	if mtopString(category["catId"]) == "" || textDTO == nil || priceDTO == nil {
		return nil, errors.New("平台编辑详情缺少类目、标题或价格，已阻止修改")
	}
	if changes.Title != nil {
		if strings.TrimSpace(*changes.Title) == "" {
			return nil, errors.New("商品标题不能为空")
		}
		textDTO["title"] = strings.TrimSpace(*changes.Title)
	}
	if changes.Description != nil {
		if strings.TrimSpace(*changes.Description) == "" {
			return nil, errors.New("商品描述不能为空")
		}
		textDTO["desc"] = strings.TrimSpace(*changes.Description)
	}
	if strings.TrimSpace(mtopString(textDTO["title"])) == "" || strings.TrimSpace(mtopString(textDTO["desc"])) == "" {
		return nil, errors.New("平台商品标题或描述缺失，已阻止修改")
	}
	// titleDescSeparate 防止闲鱼从描述中截取标题覆盖用户单独输入的文案。
	textDTO["titleDescSeparate"] = true
	payload["itemTextDTO"] = textDTO
	if changes.PriceCents != nil {
		if *changes.PriceCents <= 0 {
			return nil, errors.New("商品价格必须大于零")
		}
		priceDTO["priceInCent"] = strconv.FormatInt(*changes.PriceCents, 10)
	}
	if strings.TrimSpace(mtopString(priceDTO["priceInCent"])) == "" {
		return nil, errors.New("平台商品价格数据缺失，已阻止修改")
	}
	payload["itemPriceDTO"] = priceDTO
	// postFee、protocols 需要按 PC 编辑接口布尔类型提交，避免将字符串 false 解释为 true。
	if postFee := mapFromAny(payload["itemPostFeeDTO"]); postFee != nil {
		// key 表示需要规范化布尔值的运费字段名称。
		for _, key := range []string{"canFreeShipping", "supportFreight", "onlyTakeSelf"} {
			// value、exists 保存已有运费布尔字段及存在性标记。
			if value, exists := postFee[key]; exists {
				postFee[key] = remoteItemBool(value)
			}
		}
	}
	// protocols、ok 保存需要保留的权益协议列表及其类型校验结果。
	if protocols, ok := payload["userRightsProtocols"].([]any); ok {
		// protocol 是用户协议列表中的单个平台原始条目。
		for _, protocol := range protocols {
			// entry 是当前协议原始结构，未提供时不尝试生成新协议。
			if entry := mapFromAny(protocol); entry != nil {
				// value、exists 保存当前协议的 enable 标记和存在性。
				if value, exists := entry["enable"]; exists {
					entry["enable"] = remoteItemBool(value)
				}
			}
		}
	}
	payload["itemId"] = itemID
	payload["uniqueCode"] = strconv.FormatInt(time.Now().UnixNano(), 10)
	payload["sourceId"] = itemID
	payload["bizcode"] = "pcMainPublish"
	payload["publishScene"] = "pcMainPublish"
	return payload, nil
}

// remoteItemBool 将平台可能以字符串表达的布尔开关转为 HTTP 编辑接口要求的 JSON 布尔值。
func remoteItemBool(value any) bool {
	return value == true || value == 1 || strings.EqualFold(strings.TrimSpace(mtopString(value)), "true") || mtopString(value) == "1"
}

// EditExistingItem 先读取详情，再保留其它字段提交用户修改；无改动时用于显式重新上架。
// 不会在远端写入结果不确定时自动重试，避免重复上架或覆盖更新。
func (c *ClientImpl) EditExistingItem(ctx context.Context, cookies, itemID string, changes RemoteItemEdit) (string, error) {
	// detail、updated、err 是平台最新编辑快照、Cookie 更新与预读失败原因。
	detail, updated, err := c.FetchItemEditDetail(ctx, cookies, itemID)
	if err != nil {
		return updated, err
	}
	// payload 是从真实详情白名单生成的编辑请求，不由本地商品摘要拼造。
	payload, err := buildExistingItemEditPayload(detail, itemID, changes)
	if err != nil {
		return updated, err
	}
	// decoded、finalCookies、callErr 是 PC 编辑提交的回执及会话变化。
	decoded, finalCookies, callErr := c.callMTop(ctx, updatedOrOriginal(updated, cookies),
		ItemEditAPI, "mtop.idle.pc.idleitem.edit", "1.0", "a21ybx.publish.0.0", "a21ybx.publish.0.0", "item-edit", payload)
	if finalCookies != "" {
		updated = finalCookies
	}
	if callErr != nil {
		return updated, callErr
	}
	// ret、data 是业务状态，成功码之外必须拒绝 data.success=false。
	ret, data := retFromDecoded(decoded), mapFromAny(decoded["data"])
	if !hasMTopSuccess(ret) || (data != nil && data["success"] == false) {
		return updated, c.mtopResponseFailure("mtop.idle.pc.idleitem.edit", 200, ret, "平台拒绝商品编辑或重新上架")
	}
	return updated, nil
}

// DownShelfItem 仅下架指定商品，必须由明确的用户操作触发，且核对平台业务成功标记。
func (c *ClientImpl) DownShelfItem(ctx context.Context, cookies, itemID string) (string, error) {
	if strings.TrimSpace(itemID) == "" {
		return "", errors.New("商品 ID 不能为空")
	}
	// decoded、updated、err 是下架业务返回的确认结果及会话变化。
	decoded, updated, err := c.callMTop(ctx, cookies, ItemDownShelfAPI, "mtop.taobao.idle.item.downshelf", "2.0",
		"a21ybx.item.0.0", "a21ybx.personal.feeds.0.0", "item-downshelf", map[string]any{"itemId": itemID})
	if err != nil {
		return updated, err
	}
	// ret、data 分别是平台顶层状态和明确的下架结果；缺失 success 不假定成功。
	ret, data := retFromDecoded(decoded), mapFromAny(decoded["data"])
	if !hasMTopSuccess(ret) || data == nil || data["success"] != true {
		return updated, fmt.Errorf("平台未明确确认商品下架: %w", c.mtopResponseFailure("mtop.taobao.idle.item.downshelf", 200, ret, "下架结果未确认"))
	}
	return updated, nil
}

// ReshelfExistingItem 提交一次平台编辑并重新读取在售商品全集；只有能在平台列表中确认商品 ID 才判定上架成功。
// 平台编辑成功但列表暂未出现时返回不确定结果，调用方不得自动二次提交。
func (c *ClientImpl) ReshelfExistingItem(ctx context.Context, cookies, itemID string) (string, error) {
	// updated、editErr 是利用平台原始详情重新上架的请求结果。
	updated, editErr := c.EditExistingItem(ctx, cookies, itemID, RemoteItemEdit{})
	if editErr != nil {
		return updated, editErr
	}
	// items、listErr 是平台“在售”列表的完整检查，不能只检查第一页造成多商品店铺误判。
	items, listErr := c.FetchAllItems(ctx, updatedOrOriginal(updated, cookies), 20, 0)
	if listErr != nil {
		return updated, fmt.Errorf("平台已接收重新上架请求，但无法核实在售列表，请到闲鱼人工检查，不要重复点击: %w", listErr)
	}
	if items == nil {
		return updated, errors.New("平台已接收重新上架请求，但在售列表没有返回有效结果，请先人工核对")
	}
	if items.UpdatedCookies != "" {
		updated = items.UpdatedCookies
	}
	// item 是平台在售列表中的实际商品项，不使用本地记录作成功判断。
	for _, item := range items.Items {
		if item.ID == itemID {
			return updated, nil
		}
	}
	return updated, errors.New("平台已接收重新上架请求，但商品尚未出现在在售列表，请先到闲鱼核对，不要重复提交")
}

// updatedOrOriginal 优先使用请求响应续签后的 Cookie，仅用于后续同一项操作的读取与提交。
func updatedOrOriginal(updated, original string) string {
	if updated != "" {
		return updated
	}
	return original
}
