package adapter

import (
	"context"
	"errors"
	"testing"

	collectorapp "xianyu-go/internal/application/collector"
)

// TestCollectorSafetyDisabledAccountUsesNoPlatformClient 验证所有采集入口均在本地阻断已停用账号。
func TestCollectorSafetyDisabledAccountUsesNoPlatformClient(t *testing.T) {
	// store 是临时 SQLite 测试库；cleanup 释放本地数据库，不访问真实账号。
	store, cleanup := newAdapterTestStore(t)
	defer cleanup()
	// ctx 仅用于本地测试数据库和采集端口调用。
	ctx := context.Background()
	// err 保存设置测试账号停用状态时的本地写入错误。
	if err := store.Cookies.SetStatus(ctx, "cid", false); err != nil {
		t.Fatal("无法准备停用账号")
	}
	// port 故意不提供平台客户端：如果任何入口越过本地拦截，测试将失败而不是访问网络。
	port := &CollectorPlatformPort{store: store}
	// searchErr 保存已停用账号的关键词搜索结果，包括后台雷达使用的搜索入口。
	_, _, _, searchErr := port.SearchMarket(ctx, "cid", collectorapp.PlatformSearchParams{Background: true})
	// detailErr 保存商品详情入口拒绝访问的错误。
	_, detailErr := port.FetchItemDetail(ctx, "cid", "test-item", false)
	// sellerErr 保存店铺分页入口拒绝访问的错误。
	_, _, _, sellerErr := port.FetchSellerPage(ctx, "cid", "test-seller", 1, 10, false)
	for _ /* callErr 是各入口的错误，必须同时支持上层中止整批。 */, callErr := range []error{searchErr, detailErr, sellerErr} {
		if !errors.Is(callErr, collectorapp.ErrCollectorAccountStopped) || !port.IsAbortError(callErr) {
			t.Fatal("已停用账号未返回采集终止错误")
		}
	}
}

// TestCollectorSafetyPausedAccountUsesNoPlatformClient 验证暂停账号不能读取采集会话或访问平台。
func TestCollectorSafetyPausedAccountUsesNoPlatformClient(t *testing.T) {
	// store、cleanup 使用临时数据库并负责释放测试资源。
	store, cleanup := newAdapterTestStore(t)
	defer cleanup()
	// ctx 是本地测试上下文。
	ctx := context.Background()
	// err 保存准备暂停状态时的写入错误。
	if _, err := store.Cookies.SetPause(ctx, "cid", 30); err != nil {
		t.Fatal(err)
	}
	// port 不包含任何真实平台客户端，越过门禁即为测试失败。
	port := &CollectorPlatformPort{store: store}
	// err 是读取会话前应返回的安全拒绝结果。
	if _, _, _, _, err := port.beginSession(ctx, "cid", false); !errors.Is(err, collectorapp.ErrCollectorAccountStopped) {
		t.Fatal("暂停账号未被采集门禁拒绝")
	}
}

// TestCollectorSafetyRejectsConcurrentCalls 验证不同账号的重叠操作不会排队、读取凭证或访问平台。
func TestCollectorSafetyRejectsConcurrentCalls(t *testing.T) {
	// port 持有共享采集闸门；无数据库与客户端以确保不会触发远端请求。
	port := &CollectorPlatformPort{}
	port.requestMu.Lock()
	defer port.requestMu.Unlock()
	// ctx 是本地测试请求上下文。
	ctx := context.Background()
	// searchErr、detailErr、sellerErr 分别验证三个采集入口的重入拒绝语义。
	_, _, _, searchErr := port.SearchMarket(ctx, "a", collectorapp.PlatformSearchParams{})
	// detailErr 验证详情入口拒绝额外采集。
	_, detailErr := port.FetchItemDetail(ctx, "b", "item", false)
	// sellerErr 验证后台店铺入口拒绝额外采集。
	_, _, _, sellerErr := port.FetchSellerPage(ctx, "c", "seller", 1, 10, true)
	for _ /* callErr 是当前入口的本地拒绝结果。 */, callErr := range []error{searchErr, detailErr, sellerErr} {
		if !errors.Is(callErr, collectorapp.ErrCollectorBusy) || !port.IsAbortError(callErr) {
			t.Fatal("重叠采集请求未被本地闸门拒绝")
		}
	}
}
