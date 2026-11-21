package items

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// RemoteItemAction 表示用户明确触发的单件商品平台编辑或上下架动作。
type RemoteItemAction string

const (
	// RemoteItemEditAction 表示修改闲鱼现有商品的标题、描述和价格。
	RemoteItemEditAction RemoteItemAction = "edit"
	// RemoteItemDownShelfAction 表示将平台在售商品下架，但保留本地资料和发货规则。
	RemoteItemDownShelfAction RemoteItemAction = "downshelf"
	// RemoteItemReshelfAction 表示尝试使用平台原始编辑详情重新上架。
	RemoteItemReshelfAction RemoteItemAction = "reshelf"
)

// RemoteItemInput 是平台单件操作的业务输入，价格采用人民币文本而非浮点数。
type RemoteItemInput struct {
	// UserID 必须是当前认证用户，用来隔离多账号凭证。
	UserID int64
	// CookieID 是商品归属的闲鱼账号 ID。
	CookieID string
	// ItemID 是闲鱼商品 ID。
	ItemID string
	// Action 是用户确认的单项平台操作。
	Action RemoteItemAction
	// Title 为 nil 时保留闲鱼原标题。
	Title *string
	// Description 为 nil 时保留闲鱼原描述。
	Description *string
	// Price 为 nil 时保留原价格，否则格式为元且最多两位小数。
	Price *string
}

// RemoteItemChanges 是应用层交付平台的显式编辑补丁。
type RemoteItemChanges struct {
	// Title 是用户选择修改的标题。
	Title *string
	// Description 是用户选择修改的描述。
	Description *string
	// PriceCents 是修改后的售价，单位分。
	PriceCents *int64
}

// RemoteItemPlatform 是应用层消费的最小平台操作端口，负责账号归属、Cookie 和 MTOP 通信。
type RemoteItemPlatform interface {
	// Edit 只提交现有商品的明确补丁，平台未确认成功应返回错误。
	Edit(context.Context, int64, string, string, RemoteItemChanges) error
	// DownShelf 只提交一次单件下架请求，平台未确认成功应返回错误。
	DownShelf(context.Context, int64, string, string) error
	// Reshelf 使用平台编辑快照执行一次重新上架，拒绝时不更新本地状态。
	Reshelf(context.Context, int64, string, string) error
}

// RemoteItemLocalSaveError 表示平台已经确认成功，但本地数据库尚未完成一致性写入。
type RemoteItemLocalSaveError struct {
	// Action 是已经在平台完成的操作，禁止直接重试。
	Action RemoteItemAction
	// Err 是本地写入失败原因，仅供服务日志使用。
	Err error
}

// Error 返回不包含 Cookie 或商品详情的操作指引。
func (e *RemoteItemLocalSaveError) Error() string {
	return fmt.Sprintf("闲鱼已完成 %s，但本地保存失败，请先同步核对，不要重复提交", e.Action)
}

// Unwrap 保留原始数据库错误供调用方分类，不将敏感内容传给用户。
func (e *RemoteItemLocalSaveError) Unwrap() error { return e.Err }

// RemoteItemService 先确认本地商品存在，再执行一次平台操作并保存非敏感结果。
type RemoteItemService struct {
	// catalog 是已有商品局部更新仓储，不能删除或重建自动发货规则。
	catalog CatalogMutationRepository
	// platform 是遵循节流器的真实远端操作端口。
	platform RemoteItemPlatform
}

// NewRemoteItemService 验证本地存储与平台端口后构造单件管理用例。
func NewRemoteItemService(catalog CatalogMutationRepository, platform RemoteItemPlatform) (*RemoteItemService, error) {
	if catalog == nil || platform == nil {
		return nil, errors.New("商品平台管理依赖未初始化")
	}
	return &RemoteItemService{catalog: catalog, platform: platform}, nil
}

// Execute 操作平台并仅在确认成功后更新本地字段；任何不确定结果都不自动重试。
func (s *RemoteItemService) Execute(ctx context.Context, input RemoteItemInput) error {
	if s == nil || s.catalog == nil || s.platform == nil {
		return errors.New("商品平台管理服务未初始化")
	}
	if input.UserID <= 0 || strings.TrimSpace(input.CookieID) == "" || strings.TrimSpace(input.ItemID) == "" {
		return errors.New("用户、账号或商品 ID 无效")
	}
	// current、err 是本地待操作商品及其查询错误，不把本地商品详情发送到远端。
	current, err := s.catalog.Get(ctx, input.CookieID, input.ItemID)
	if err != nil {
		return err
	}
	// patch 是后续数据库操作仅修改的字段，保留其它属性及发货规则。
	patch := CatalogPatchInput{}
	switch input.Action {
	case RemoteItemEditAction:
		// storedShelfState 是此前由平台确认的货架标记，避免编辑已下架商品时意外触发重新上架。
		var storedShelfState struct {
			ShelfState string `json:"shelf_state"`
		}
		if json.Unmarshal([]byte(firstNonEmptyRemoteItemDetail(current.ItemDetail)), &storedShelfState) == nil && storedShelfState.ShelfState == "off" {
			return errors.New("商品已下架，请先重新上架并确认后再同步编辑，或者仅保存到本地")
		}
		// changes 是明确提供给平台的字段补丁，省略字段均使用编辑详情原值。
		changes := RemoteItemChanges{Title: input.Title, Description: input.Description}
		if input.Title == nil && input.Description == nil && input.Price == nil {
			return errors.New("至少修改一个商品字段")
		}
		if input.Title != nil {
			// title 是去除两端空白后的新标题，不能提交空标题。
			title := strings.TrimSpace(*input.Title)
			if title == "" {
				return errors.New("商品标题不能为空")
			}
			changes.Title, patch.ItemTitle = &title, &title
		}
		if input.Description != nil {
			// desc 是完整新描述，平台编辑时不得用标题推断替代。
			desc := strings.TrimSpace(*input.Description)
			if desc == "" {
				return errors.New("商品描述不能为空")
			}
			changes.Description, patch.ItemDescription = &desc, &desc
		}
		if input.Price != nil {
			// cents 是经过十进制校验的售价分值，不使用浮点数避免舍入误差。
			cents, parseErr := remoteItemPriceCents(*input.Price)
			if parseErr != nil {
				return parseErr
			}
			// normalizedPrice 是同步到本地列表的精确人民币价格。
			normalizedPrice := fmt.Sprintf("%d.%02d", cents/100, cents%100)
			changes.PriceCents, patch.ItemPrice = &cents, &normalizedPrice
		}
		// err 是平台执行本次已确认的商品编辑时返回的错误。
		if err := s.platform.Edit(ctx, input.UserID, input.CookieID, input.ItemID, changes); err != nil {
			return err
		}
	case RemoteItemDownShelfAction, RemoteItemReshelfAction:
		// metadata、jsonErr 在平台操作之前验证本地数据可完整更新，避免平台已变更才发现本地 JSON 损坏。
		metadata, jsonErr := remoteItemDetailWithShelfState(current.ItemDetail, input.Action)
		if jsonErr != nil {
			return errors.New("本地商品扩展信息损坏，请先修复后再操作平台")
		}
		// actionErr 是单次真实平台上下架调用的结果，未确认成功时不得改动本地状态。
		var actionErr error
		if input.Action == RemoteItemDownShelfAction {
			actionErr = s.platform.DownShelf(ctx, input.UserID, input.CookieID, input.ItemID)
		} else {
			actionErr = s.platform.Reshelf(ctx, input.UserID, input.CookieID, input.ItemID)
		}
		if actionErr != nil {
			return actionErr
		}
		patch.ItemDetail = &metadata
	default:
		return errors.New("不支持的商品操作")
	}
	// err 是平台操作完成后本地局部更新失败的原因，需要返回特殊错误阻止重试。
	if err := s.catalog.Patch(ctx, input.CookieID, input.ItemID, patch); err != nil {
		return &RemoteItemLocalSaveError{Action: input.Action, Err: err}
	}
	return nil
}

// firstNonEmptyRemoteItemDetail 仅将本地空扩展详情归一为空 JSON 对象，避免把空串误判为损坏。
func firstNonEmptyRemoteItemDetail(value string) string {
	if strings.TrimSpace(value) == "" {
		return "{}"
	}
	return value
}

// remoteItemPriceCents 将严格的正数元金额转成整数分，拒绝科学计数法和超出两位小数的价格。
func remoteItemPriceCents(raw string) (int64, error) {
	// price 是去掉可选人民币符号及空白后的用户输入。
	price := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(raw), "¥"), "￥"))
	// parts 是整数元部分和最多两位的小数部分。
	parts := strings.Split(price, ".")
	if len(parts) == 0 || len(parts) > 2 || parts[0] == "" {
		return 0, errors.New("商品价格格式错误")
	}
	// yuan、parseErr 保存合法整元及其十进制解析错误。
	yuan, parseErr := strconv.ParseInt(parts[0], 10, 64)
	if parseErr != nil || yuan < 0 || yuan > 9000000000000000 {
		return 0, errors.New("商品价格格式错误")
	}
	// fraction 是零到两位数字的小数部分，补零后代表分。
	fraction := "00"
	if len(parts) == 2 {
		if len(parts[1]) == 0 || len(parts[1]) > 2 {
			return 0, errors.New("商品价格最多支持两位小数")
		}
		// digit 是当前小数部分的十进制数字。
		for _, digit := range parts[1] {
			if digit < '0' || digit > '9' {
				return 0, errors.New("商品价格格式错误")
			}
		}
		fraction = parts[1] + strings.Repeat("0", 2-len(parts[1]))
	}
	// centsPart 是小数位对应的整数分值。
	centsPart, _ := strconv.ParseInt(fraction, 10, 64)
	// cents 是最终整数分值，零元禁止提交。
	cents := yuan*100 + centsPart
	if cents <= 0 {
		return 0, errors.New("商品价格必须大于零")
	}
	return cents, nil
}

// remoteItemDetailWithShelfState 只更新 JSON 扩展字段里的显式货架状态，保留原有图片与分类信息。
func remoteItemDetailWithShelfState(original string, action RemoteItemAction) (string, error) {
	// detail 是本地非敏感商品扩展对象，不向平台上传。
	detail := map[string]json.RawMessage{}
	if strings.TrimSpace(original) != "" {
		// err 是已有商品扩展信息解析失败的原因，禁止提交会破坏本地详情的远端操作。
		if err := json.Unmarshal([]byte(original), &detail); err != nil {
			return "", err
		}
	}
	if detail == nil {
		return "", errors.New("本地商品详情必须是 JSON 对象")
	}
	// state 是经过平台确认的货架状态，避免依赖平台列表中未定的 itemStatus 整数语义。
	state := "on"
	if action == RemoteItemDownShelfAction {
		state = "off"
	}
	// stateJSON 保存 JSON 字符串，供列表页展示和下一次全量同步保护下架记录。
	stateJSON, _ := json.Marshal(state)
	detail["shelf_state"] = stateJSON
	// encoded、err 是保留其它已有字段后的完整扩展 JSON。
	encoded, err := json.Marshal(detail)
	return string(encoded), err
}
