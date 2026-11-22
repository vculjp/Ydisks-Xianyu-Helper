package db

import (
	"context"
	"errors"
	"testing"
)

// TestDeletedItemIsNotResurrectedBySync 验证逻辑删除后平台列表再次返回同一 ID 也不会恢复本地商品。
func TestDeletedItemIsNotResurrectedBySync(t *testing.T) {
	// store、cleanup 是本次独立的 SQLite 测试数据库和释放回调。
	store, cleanup := newTestDB(t)
	defer cleanup()
	// ctx 是本轮持久化操作共享的生命周期。
	ctx := context.Background()
	// created、createErr 是测试账号归属用户的创建结果。
	created, createErr := store.Users.Create(ctx, "delete-tombstone-owner", "delete-tombstone-owner@example.com", "password")
	if createErr != nil || !created {
		t.Fatalf("创建测试用户失败: %v", createErr)
	}
	// user、userErr 是隔离的测试用户，不涉及真实登录凭证。
	user, userErr := store.Users.GetByUsername(ctx, "delete-tombstone-owner")
	if userErr != nil {
		t.Fatal(userErr)
	}
	// err 是准备测试账号凭证时的数据库错误。
	if err := store.Cookies.Save(ctx, "delete-tombstone-account", "unb=test", user.ID); err != nil {
		t.Fatal(err)
	}
	// item 是即将被用户删除的本地商品。
	item := &ItemInfoRow{CookieID: "delete-tombstone-account", ItemID: "deleted-item", ItemTitle: "待删除商品"}
	if err := store.Items.Upsert(ctx, item); err != nil {
		t.Fatal(err)
	}
	if err := store.Items.Delete(ctx, item.CookieID, item.ItemID); err != nil {
		t.Fatal(err)
	}
	// result、syncErr 是平台列表再次返回该商品时的全集同步结果。
	result, syncErr := store.Items.SyncFromRemote(ctx, item.CookieID, []ItemInfoRow{{
		CookieID: item.CookieID, ItemID: item.ItemID, ItemTitle: "平台再次返回的标题",
	}})
	if syncErr != nil {
		t.Fatal(syncErr)
	}
	// current、getErr 必须是逻辑删除后的不可见状态，而不是被同步复活。
	current, getErr := store.Items.Get(ctx, item.CookieID, item.ItemID)
	if !errors.Is(getErr, ErrNotFound) || current != nil {
		t.Fatalf("已删除商品不得被同步复活: result=%+v item=%+v err=%v", result, current, getErr)
	}
}
