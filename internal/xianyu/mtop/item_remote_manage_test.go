package mtop

import (
	"context"
	"fmt"
	"net/http"
	"testing"
)

// TestEditExistingItemPreservesRemoteDetails 验证真实 MTOP 调用形状，平台图片、分类、库存与规格不会被本地摘要覆盖。
func TestEditExistingItemPreservesRemoteDetails(t *testing.T) {
	// received 保存平台模拟器收到的完整编辑载荷，必须保留旧主图与原始分类。
	var received map[string]any
	// count 统计平台请求数，必须严格为一次详情读取加一次编辑提交。
	count := 0
	// transport 完全替代网络传输，不会向真实闲鱼发送请求。
	transport := &dispatchTransport{handlers: map[string]http.HandlerFunc{
		"mtop.idle.pc.idleitem.editDetail": func(w http.ResponseWriter, _ *http.Request) {
			count++
			fmt.Fprint(w, `{"ret":["SUCCESS::调用成功"],"data":{"itemId":"it1","imageInfoDOList":[{"url":"https://example.com/pic.jpg"}],"itemTextDTO":{"title":"旧标题","desc":"旧描述","titleDescSeparate":false},"itemPriceDTO":{"priceInCent":"200","origPriceInCent":"300"},"itemCatDTO":{"catId":"5001"},"quantity":"8","itemSkuList":[{"skuId":"s1"}],"itemPostFeeDTO":{"canFreeShipping":"false"},"userRightsProtocols":[{"enable":"false"}]}}`)
		},
		"mtop.idle.pc.idleitem.edit": func(w http.ResponseWriter, r *http.Request) {
			count++
			received, _ = parseDataURL(readBody(r))
			fmt.Fprint(w, `{"ret":["SUCCESS::调用成功"],"data":{"success":true}}`)
		},
	}}
	// client 使用本地模拟 HTTP Transport，测试永远不调用真实平台。
	client := &ClientImpl{HTTPClient: &http.Client{Transport: transport}}
	// title 和 priceCents 是用户明确改动的标题和分值，原描述必须保留。
	title, priceCents := "新的网盘资料标题", int64(990)
	// updated、err 保存平台返回的新 Cookie 与操作结果，不输出真实凭证。
	_, err := client.EditExistingItem(context.Background(), consignCookies, "it1", RemoteItemEdit{Title: &title, PriceCents: &priceCents})
	if err != nil || count != 2 {
		t.Fatalf("模拟编辑应恰好读取并提交各一次: count=%d err=%v", count, err)
	}
	// text 和 price 是最终提交的原字段结构，只允许明确字段变化。
	text, price := mapFromAny(received["itemTextDTO"]), mapFromAny(received["itemPriceDTO"])
	if text["title"] != title || text["desc"] != "旧描述" || text["titleDescSeparate"] != true || price["priceInCent"] != "990" || price["origPriceInCent"] != "300" {
		t.Fatalf("独立标题/描述或价格被错误覆盖: text=%v price=%v", text, price)
	}
	// postage 和 protocols 是转换成布尔值的原始配送与用户协议配置。
	postage := mapFromAny(received["itemPostFeeDTO"])
	// protocols 是编辑载荷中保留的原用户权益协议列表。
	protocols, _ := received["userRightsProtocols"].([]any)
	if received["itemId"] != "it1" || received["quantity"] != "8" || len(received["imageInfoDOList"].([]any)) != 1 ||
		len(received["itemSkuList"].([]any)) != 1 || postage["canFreeShipping"] != false || mapFromAny(protocols[0])["enable"] != false {
		t.Fatalf("平台编辑载荷丢失原始商品字段")
	}
}

// TestDownShelfOnlySucceedsWhenPlatformConfirms 验证下架必须检查 data.success=true，不能仅凭 HTTP 200。
func TestDownShelfOnlySucceedsWhenPlatformConfirms(t *testing.T) {
	// callCount 是模拟平台仅接收一条下架请求的计数器。
	callCount := 0
	// transport 返回顶层成功但业务未确认，模拟平台拒绝下架。
	transport := &dispatchTransport{handlers: map[string]http.HandlerFunc{
		"mtop.taobao.idle.item.downshelf": func(w http.ResponseWriter, r *http.Request) {
			callCount++
			// request 是通过真实签名 MTOP 通道提交的下架商品标识。
			request, _ := parseDataURL(readBody(r))
			if request["itemId"] != "it1" {
				t.Error("下架请求商品 ID 错误")
			}
			fmt.Fprint(w, `{"ret":["SUCCESS::调用成功"],"data":{"success":false}}`)
		},
	}}
	// client 只使用本地响应回调，不会对外发起网络请求。
	client := &ClientImpl{HTTPClient: &http.Client{Transport: transport}}
	// err 为业务下架拒绝，明确禁止修改本地状态。
	_, err := client.DownShelfItem(context.Background(), consignCookies, "it1")
	if err == nil || callCount != 1 {
		t.Fatalf("未确认下架时必须拒绝: count=%d err=%v", callCount, err)
	}
	// 第二轮只把业务成功改为 true，确认方法不把其它字段当作下架成功。
	transport.handlers["mtop.taobao.idle.item.downshelf"] = func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"ret":["SUCCESS::调用成功"],"data":{"success":true}}`)
	}
	// successErr 是模拟业务明确确认下架的结果。
	_, successErr := client.DownShelfItem(context.Background(), consignCookies, "it1")
	if successErr != nil {
		t.Fatalf("平台确认成功时应完成下架: %v", successErr)
	}
}

// TestExistingItemEditRejectsIncompleteSnapshot 验证平台详情缺主图或类目时绝不发起编辑写请求。
func TestExistingItemEditRejectsIncompleteSnapshot(t *testing.T) {
	// editCount 验证原详情不完整时编辑接口调用次数必须为零。
	editCount := 0
	// transport 只返回缺失图片的商品详情，不做实际平台写操作。
	transport := &dispatchTransport{handlers: map[string]http.HandlerFunc{
		"mtop.idle.pc.idleitem.editDetail": func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprint(w, `{"ret":["SUCCESS::调用成功"],"data":{"itemTextDTO":{"title":"原","desc":"描述"},"itemPriceDTO":{"priceInCent":"200"},"itemCatDTO":{"catId":"5001"}}}`)
		},
		"mtop.idle.pc.idleitem.edit": func(w http.ResponseWriter, _ *http.Request) {
			editCount++
			fmt.Fprint(w, `{"ret":["SUCCESS::调用成功"]}`)
		},
	}}
	// client 是在本地模拟器中执行真实平台请求构造的被测实例。
	client := &ClientImpl{HTTPClient: &http.Client{Transport: transport}}
	// err 必须明确拒绝危险编辑。
	_, err := client.EditExistingItem(context.Background(), consignCookies, "it1", RemoteItemEdit{})
	if err == nil || editCount != 0 {
		t.Fatalf("缺少主图不得编辑: calls=%d err=%v", editCount, err)
	}
}
