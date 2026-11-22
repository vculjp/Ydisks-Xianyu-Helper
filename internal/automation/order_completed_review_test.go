package automation

import (
	"context"
	"testing"

	"xianyu-go/internal/db"
)

// TestOrderCompletedImmediatelySendsReviewRequest 验证开启开关后，确认收货事件立即发送一次求评价并累计提醒次数。
func TestOrderCompletedImmediatelySendsReviewRequest(t *testing.T) {
	// store、cleanup 保存隔离数据库及关闭责任。
	store, cleanup := newAutomationTestStore(t)
	defer cleanup()
	// ctx 是数据库操作与事件处理共用的上下文。
	ctx := context.Background()
	// admin 是规则归属用户。
	admin, err := store.Users.GetByUsername(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	// ruleID 是开启“确认收货后立即求评价”的规则主键。
	ruleID, err := store.Automation.Create(ctx, db.AutomationRuleInput{
		UserID: admin.ID, CookieID: "cid", ItemID: "item-1", Name: "确认收货立即求评价",
		TriggerType: TriggerReviewMissingTimeout, ConfigJSON: `{"trigger_on_completed":true,"max_attempts":1}`,
		Enabled: true,
		Actions: []db.AutomationActionInput{{ActionType: ActionSendText, MessageTemplate: "收到啦，麻烦给个五星好评～", Enabled: true, SortOrder: 1}},
	})
	if err != nil {
		t.Fatal(err)
	}
	// sender 记录实际发出的聊天文案，用于确认只发送一次。
	sender := &testSender{}
	// center 使用真实存储和测试发送器执行确认收货事件。
	center := New(store, testSenderProvider{sender: sender}, nil)
	// task 是平台在买家确认收货后投递的完成事件。
	task := Task{AccountID: "cid", TriggerType: TriggerOrderCompleted, OrderID: "order-completed-immediate", ItemID: "item-1", BuyerID: "buyer-1", ChatID: "chat-1"}
	if // err 保存首次事件处理错误。
	err := center.HandleTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	if len(sender.texts) != 1 || sender.texts[0] != "收到啦，麻烦给个五星好评～" {
		t.Fatalf("确认收货后应立即发送一次求评价，实际=%v", sender.texts)
	}
	// order 保存事件处理后的订单事实。
	order, err := store.Orders.Get(ctx, task.OrderID)
	if err != nil || order == nil {
		t.Fatalf("读取订单失败: order=%+v err=%v", order, err)
	}
	if order.ReviewRequestCount != 1 || order.LastReviewRequestAt == "" {
		t.Fatalf("首次求评价应累计次数和时间: %+v", order)
	}
	// run 保存本次立即求评价的运行记录，触发类型必须是求评价以便审计口径一致。
	var runTrigger string
	var runRuleID int64
	if err := store.DB.QueryRowContext(ctx, `SELECT trigger_type,rule_id FROM automation_runs WHERE order_id=?`, task.OrderID).Scan(&runTrigger, &runRuleID); err != nil {
		t.Fatal(err)
	}
	if runTrigger != TriggerReviewMissingTimeout || runRuleID != ruleID {
		t.Fatalf("立即求评价运行错误: trigger=%s rule=%d", runTrigger, runRuleID)
	}
	// 重复投递同一完成事件不得再次发送。
	if err := center.HandleTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	if len(sender.texts) != 1 {
		t.Fatalf("重复完成事件不得重复发送: %v", sender.texts)
	}
}

// TestOrderCompletedWithoutImmediateFlagKeepsFactOnlyBehavior 验证未开启开关时仍只更新订单完成事实。
func TestOrderCompletedWithoutImmediateFlagKeepsFactOnlyBehavior(t *testing.T) {
	// store、cleanup 保存隔离数据库及关闭责任。
	store, cleanup := newAutomationTestStore(t)
	defer cleanup()
	// ctx 是数据库操作与事件处理共用的上下文。
	ctx := context.Background()
	// admin 是规则归属用户。
	admin, err := store.Users.GetByUsername(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if // err 保存创建超时求评价规则时的错误。
	_, err := store.Automation.Create(ctx, db.AutomationRuleInput{
		UserID: admin.ID, CookieID: "cid", ItemID: "item-1", Name: "超时求评价",
		TriggerType: TriggerReviewMissingTimeout, ConfigJSON: `{"after_shipped_hours":72,"max_attempts":1}`,
		Enabled: true,
		Actions: []db.AutomationActionInput{{ActionType: ActionSendText, MessageTemplate: "记得评价哦", Enabled: true, SortOrder: 1}},
	}); err != nil {
		t.Fatal(err)
	}
	// sender 记录聊天发送；未开启立即模式时不应有内容。
	sender := &testSender{}
	center := New(store, testSenderProvider{sender: sender}, nil)
	// task 是买家确认收货事件。
	task := Task{AccountID: "cid", TriggerType: TriggerOrderCompleted, OrderID: "order-completed-timeout", ItemID: "item-1", BuyerID: "buyer-1", ChatID: "chat-1"}
	if err := center.HandleTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	if len(sender.texts) != 0 {
		t.Fatalf("未开启立即模式不应发送: %v", sender.texts)
	}
	// order 保存完成事实，确认事件仍被正常记录。
	order, err := store.Orders.Get(ctx, task.OrderID)
	if err != nil || order == nil || order.CompletedAt == "" {
		t.Fatalf("订单完成事实未记录: order=%+v err=%v", order, err)
	}
}
