package items

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

// remoteItemPlatformStub 是不访问闲鱼的单件商品平台操作替身。
type remoteItemPlatformStub struct {
	// calls 记录所有试图提交到平台的操作，必须严格按用户确认的次数调用。
	calls []RemoteItemAction
	// received 保存编辑请求中实际修改的字段。
	received RemoteItemChanges
	// operationErr 模拟平台拒绝或网络结果未知，不允许本地状态提前改变。
	operationErr error
}

// Edit 保存远端编辑补丁并返回预设的业务结果。
func (p *remoteItemPlatformStub) Edit(_ context.Context, _ int64, _, _ string, changes RemoteItemChanges) error {
	p.calls = append(p.calls, RemoteItemEditAction)
	p.received = changes
	return p.operationErr
}

// DownShelf 只记录一条明确下架调用。
func (p *remoteItemPlatformStub) DownShelf(context.Context, int64, string, string) error {
	p.calls = append(p.calls, RemoteItemDownShelfAction)
	return p.operationErr
}

// Reshelf 只记录一条明确重新上架调用。
func (p *remoteItemPlatformStub) Reshelf(context.Context, int64, string, string) error {
	p.calls = append(p.calls, RemoteItemReshelfAction)
	return p.operationErr
}

// TestRemoteItemEditOnlyPersistsAfterPlatformSuccess 验证修改失败不更新本地字段，成功仅写显式补丁。
func TestRemoteItemEditOnlyPersistsAfterPlatformSuccess(t *testing.T) {
	// catalog 提供有旧标题及原价的本地商品快照。
	catalog := &catalogMutationRepositoryStub{item: CatalogItem{ItemID: "it1", ItemTitle: "旧标题", ItemPrice: "3.00"}}
	// platform 是只记录调用的模拟闲鱼平台。
	platform := &remoteItemPlatformStub{operationErr: errors.New("平台拒绝编辑")}
	// service 是完整应用服务，必须先远端确认后本地写入。
	service, err := NewRemoteItemService(catalog, platform)
	if err != nil {
		t.Fatal(err)
	}
	// title 和 price 是用户明确修改的标题与售价元文本。
	title, price := "新标题", "9.90"
	// input 指明当前账号的商品以及明确的用户编辑动作。
	input := RemoteItemInput{UserID: 1, CookieID: "account1", ItemID: "it1", Action: RemoteItemEditAction, Title: &title, Price: &price}
	// err 是平台拒绝时应用服务返回的错误，不能把商品写入本地。
	if err := service.Execute(context.Background(), input); err == nil {
		t.Fatal("平台拒绝时不应返回成功")
	}
	if catalog.patchInput.ItemTitle != nil || catalog.patchInput.ItemPrice != nil {
		t.Fatal("平台拒绝时本地商品字段必须保持不变")
	}
	platform.operationErr = nil
	// err 是平台确认成功后本地局部写入的结果。
	if err := service.Execute(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	if catalog.patchInput.ItemTitle == nil || *catalog.patchInput.ItemTitle != title ||
		catalog.patchInput.ItemPrice == nil || *catalog.patchInput.ItemPrice != "9.90" ||
		catalog.patchInput.ItemDescription != nil || platform.received.PriceCents == nil || *platform.received.PriceCents != 990 {
		t.Fatalf("本地补丁或平台分值错误: %+v", catalog.patchInput)
	}
}

// TestRemoteItemDownShelfKeepsCatalogAndOtherFields 验证下架仅设置 shelf_state，不删除规则和商品原有详情。
func TestRemoteItemDownShelfKeepsCatalogAndOtherFields(t *testing.T) {
	// catalog 是包含图片和分类的商品扩展 JSON，本次下架只能增加货架字段。
	catalog := &catalogMutationRepositoryStub{item: CatalogItem{ItemID: "it1", ItemDetail: `{"item_image":"picture.jpg","category_id":"5001"}`}}
	// platform 是成功确认下架的模拟平台。
	platform := &remoteItemPlatformStub{}
	// service 是受控应用服务。
	service, err := NewRemoteItemService(catalog, platform)
	if err != nil {
		t.Fatal(err)
	}
	// input 是已确认的当前账号下架操作。
	input := RemoteItemInput{UserID: 1, CookieID: "account1", ItemID: "it1", Action: RemoteItemDownShelfAction}
	// err 是下架操作提交与本地状态保存的结果。
	if err := service.Execute(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	// detail 是仅包含新增货架标记且保留旧内容的 JSON。
	var detail map[string]any
	// err 是下架后的商品扩展状态解析错误。
	if err := json.Unmarshal([]byte(*catalog.patchInput.ItemDetail), &detail); err != nil {
		t.Fatal(err)
	}
	if detail["shelf_state"] != "off" || detail["category_id"] != "5001" || detail["item_image"] != "picture.jpg" ||
		catalog.patchInput.ItemTitle != nil || len(platform.calls) != 1 || platform.calls[0] != RemoteItemDownShelfAction {
		t.Fatalf("下架不应丢失其它本地字段: detail=%v", detail)
	}
	// 上架再次以平台原始详情提交，平台确认后把货架状态改回 on。
	input.Action = RemoteItemReshelfAction
	// err 是重新上架及平台确认后的本地更新错误。
	if err := service.Execute(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	// err 是重新上架后解析平台确认状态的错误。
	if err := json.Unmarshal([]byte(*catalog.patchInput.ItemDetail), &detail); err != nil || detail["shelf_state"] != "on" ||
		len(platform.calls) != 2 || platform.calls[1] != RemoteItemReshelfAction {
		t.Fatalf("重新上架应确认后标记为 on: %v", err)
	}
}

// TestRemoteItemLocalSaveFailureDemandsReconcile 验证平台已完成但本地保存失败时返回不可自动重试的错误。
func TestRemoteItemLocalSaveFailureDemandsReconcile(t *testing.T) {
	// catalog 是本地写入被拒绝的仓储替身。
	catalog := &catalogMutationRepositoryStub{item: CatalogItem{ItemID: "it1", ItemDetail: "{}"}, upsertErr: errors.New("磁盘不可写")}
	// platform 是只记录一次成功动作的平台替身。
	platform := &remoteItemPlatformStub{}
	// service 是完成平台操作后会尝试保存本地状态的应用用例。
	service, err := NewRemoteItemService(catalog, platform)
	if err != nil {
		t.Fatal(err)
	}
	// actionErr 是包含已变更远端状态但本地保存失败含义的错误。
	actionErr := service.Execute(context.Background(), RemoteItemInput{UserID: 1, CookieID: "account1", ItemID: "it1", Action: RemoteItemDownShelfAction})
	// localErr 是用于禁止用户重复点击的显式错误类型。
	var localErr *RemoteItemLocalSaveError
	if !errors.As(actionErr, &localErr) || len(platform.calls) != 1 {
		t.Fatalf("本地失败必须提示远端已完成且不自动重试: %v", actionErr)
	}
}

// TestRemoteItemPriceRejectsUnsafeInput 验证非法价格不调用平台。
func TestRemoteItemPriceRejectsUnsafeInput(t *testing.T) {
	// values 是需要拒绝的空值、负数、科学计数法及超精度金额。
	values := []string{"", "0", "-1", "1e3", "1.234", "abc", "1."}
	// value 是当前非法售价测试样本。
	for _, value := range values {
		// current 是本轮无效售价。
		current := value
		// err 是非法售价校验应返回的业务错误。
		if _, err := remoteItemPriceCents(current); err == nil {
			t.Fatalf("非法售价应被拒绝: %s", current)
		}
	}
	// cents、err 保存有人民币符号的小数售价转换结果。
	cents, err := remoteItemPriceCents("￥0.20")
	if err != nil || cents != 20 {
		t.Fatalf("合法人民币价格转换失败: %d %v", cents, err)
	}
}

// TestRemoteEditDoesNotRelistOffShelfItem 验证修改下架商品不会未经用户同意触发重新上架。
func TestRemoteEditDoesNotRelistOffShelfItem(t *testing.T) {
	// catalog 是已经明确下架的本地商品，其扩展状态必须被应用层识别。
	catalog := &catalogMutationRepositoryStub{item: CatalogItem{ItemID: "it1", ItemDetail: `{"shelf_state":"off"}`}}
	// platform 是统计调用次数的模拟平台，拒绝之前不能调用。
	platform := &remoteItemPlatformStub{}
	// service 是真实应用层管理用例。
	service, serviceErr := NewRemoteItemService(catalog, platform)
	if serviceErr != nil {
		t.Fatal(serviceErr)
	}
	// title 是尝试修改下架商品的标题。
	title := "下架后试图编辑"
	// executeErr 是拦截未明确重新上架请求的业务错误。
	executeErr := service.Execute(context.Background(), RemoteItemInput{UserID: 1, CookieID: "account1", ItemID: "it1", Action: RemoteItemEditAction, Title: &title})
	if executeErr == nil || len(platform.calls) != 0 {
		t.Fatalf("下架商品不可因编辑意外重新上架: err=%v calls=%d", executeErr, len(platform.calls))
	}
}

// TestRemoteShelfRejectsNullDetailBeforePlatformWrite 验证本地 JSON null 不会触发 panic 或真实平台修改。
func TestRemoteShelfRejectsNullDetailBeforePlatformWrite(t *testing.T) {
	// catalog 包含不合法的空 JSON 对象根，不能在远端操作后才触发保存错误。
	catalog := &catalogMutationRepositoryStub{item: CatalogItem{ItemID: "it1", ItemDetail: "null"}}
	// platform 是无外部调用的测试平台记录器。
	platform := &remoteItemPlatformStub{}
	// service 是真实应用层用例。
	service, serviceErr := NewRemoteItemService(catalog, platform)
	if serviceErr != nil {
		t.Fatal(serviceErr)
	}
	// executeErr 是安全拒绝异常扩展信息的错误，不允许远端调用。
	executeErr := service.Execute(context.Background(), RemoteItemInput{UserID: 1, CookieID: "account1", ItemID: "it1", Action: RemoteItemDownShelfAction})
	if executeErr == nil || len(platform.calls) != 0 {
		t.Fatalf("扩展详情为 null 时不得修改平台: err=%v calls=%v", executeErr, platform.calls)
	}
}
