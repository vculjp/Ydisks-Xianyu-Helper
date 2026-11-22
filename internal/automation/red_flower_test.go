package automation

import (
	"context"
	"log/slog"
	"testing"

	"xianyu-go/internal/db"
	"xianyu-go/internal/xianyu/mtop"
)

// TestRedFlowerPlannerGates 验证只有勾选了原生求花、启用了确认动作的自动付款订单才会追加末尾求花。
func TestRedFlowerPlannerGates(t *testing.T) {
	// deliver 是已经按规格匹配的发货模板动作，真实平台消息由运行协调器处理。
	deliver := db.AutomationAction{ActionType: ActionSendTemplate, Enabled: true, ConfigJSON: "{}"}
	// paid 是有订单标识的自动付款事件。
	paid := Task{Source: "ws", TriggerType: TriggerOrderPaid}
	// enabled 是勾选了“确认发货后求小红花”的付款规则。
	enabled := db.AutomationRule{TriggerType: TriggerOrderPaid, ConfigJSON: `{"request_red_flower":true}`, Actions: []db.AutomationAction{deliver}}
	// actions 是运行冻结前的动作链。
	actions := (actionPlanner{}).planRuleActions(paid, enabled)
	if len(actions) != 3 || actions[0].ActionType != ActionSendTemplate || actions[1].ActionType != ActionConfirmShipment || actions[2].ActionType != ActionRequestRedFlower {
		t.Fatalf("求花必须在发送内容、确认发货之后执行: %+v", actions)
	}
	// disabled 是未启用求花的历史规则，不应静默产生新平台副作用。
	disabled := enabled
	disabled.ConfigJSON = "{}"
	if len((actionPlanner{}).planRuleActions(paid, disabled)) != 2 {
		t.Fatal("旧规则不得自动求花")
	}
	// manual 是人工发货，只保留原来的发送和确认行为。
	manual := paid
	manual.Source = "manual"
	if len((actionPlanner{}).planRuleActions(manual, enabled)) != 2 {
		t.Fatal("人工发货不得自动追加求花")
	}
	// noConfirm 是显式关闭确认发货动作的规则，即使勾选求花也不应跳过确认闸门。
	noConfirm := enabled
	noConfirm.Actions = []db.AutomationAction{deliver, {ActionType: ActionConfirmShipment, Enabled: false}}
	if len((actionPlanner{}).planRuleActions(paid, noConfirm)) != 1 {
		t.Fatal("显式关闭确认发货时不得求花")
	}
	// unmatched 是不含任何发货内容的规则，不应凭空确认发货或求花。
	unmatched := enabled
	unmatched.Actions = nil
	if len((actionPlanner{}).planRuleActions(paid, unmatched)) != 0 {
		t.Fatal("没有发货动作不得求花")
	}
}

// TestRedFlowerRequiresConfirmedOrder 验证账号确认开关与订单真实已发货事实都不能被跳过。
func TestRedFlowerRequiresConfirmedOrder(t *testing.T) {
	// store、cleanup 是独立测试数据库及其释放函数。
	store, cleanup := newAutomationTestStore(t)
	defer cleanup()
	// ctx 是本地内存测试的生命周期。
	ctx := context.Background()
	// off 将夹具默认开启的自动确认发货关掉，验证求花绝不绕过该开关。
	off := false
	// admin 是测试账号的合法拥有者。
	admin, adminErr := store.Users.GetByUsername(ctx, "admin")
	if adminErr != nil || admin == nil {
		t.Fatalf("读取测试管理员失败: %v", adminErr)
	}
	if _, updateErr := store.Cookies.UpdateSettings(ctx, "cid", db.AccountSettingsUpdate{UserID: admin.ID, AutoConsign: &off}); updateErr != nil {
		t.Fatal(updateErr)
	}
	// gateway 只记录测试中的求花外部调用数量，不访问真实闲鱼。
	gateway := &fakeMTop{redFlowerOK: true, redFlowerRet: []string{"SUCCESS::调用成功"}}
	// executor 使用已有订单仓储和可选 MTOP 适配器，测试仅直接调用求花动作。
	executor := &automationActionExecutor{store: store, mtop: func() mtop.Client { return gateway }, logger: slog.Default()}
	// task 对应测试仓库内账号 cid 的虚拟订单。
	task := Task{AccountID: "cid", OrderID: "flower-test", Source: "ws", TriggerType: TriggerOrderPaid}
	// disabledErr 是尚未开启自动确认发货时的无动作结果。
	disabledErr := executor.requestRedFlower(ctx, task)
	if disabledErr != nil || gateway.redFlowerCalls != 0 {
		t.Fatalf("自动确认发货关闭时不应调用求花接口: err=%v calls=%d", disabledErr, gateway.redFlowerCalls)
	}
	// on 显式开启确认发货，使后续状态闸门进入核验。
	on := true
	if _, updateErr := store.Cookies.UpdateSettings(ctx, "cid", db.AccountSettingsUpdate{UserID: admin.ID, AutoConsign: &on}); updateErr != nil {
		t.Fatal(updateErr)
	}
	// unavailableErr 表示订单状态不存在时应拒绝外部求花。
	unavailableErr := executor.requestRedFlower(ctx, task)
	if unavailableErr == nil || gateway.redFlowerCalls != 0 {
		t.Fatalf("缺少订单已发货事实时不得调用求花接口: err=%v calls=%d", unavailableErr, gateway.redFlowerCalls)
	}
}

// TestPaidDeliveryConfirmsBeforeRequestingFlower 验证平台发货确认与求花在同一运行中顺序执行，
// 对已成功运行的重复付款事件不会重复投递发货内容、确认订单或请求小红花。
func TestPaidDeliveryConfirmsBeforeRequestingFlower(t *testing.T) {
	// store、cleanup 是独立 SQLite 测试环境与对应的数据库释放函数。
	store, cleanup := newAutomationTestStore(t)
	defer cleanup()
	// ctx 是本轮模拟付款自动化的执行上下文。
	ctx := context.Background()
	// admin 是测试帐号所属的合法用户。
	admin, adminErr := store.Users.GetByUsername(ctx, "admin")
	if adminErr != nil || admin == nil {
		t.Fatalf("读取测试用户失败: %v", adminErr)
	}
	// cardID 是仅供模拟账号发货的一份本地卡密库存。
	cardID := catchupCard(t, store, admin.ID)
	// ruleID 是显式启用了原生求花配置的唯一付款规则。
	ruleID, ruleErr := store.Automation.Create(ctx, db.AutomationRuleInput{
		UserID: admin.ID, CookieID: "cid", ItemID: "flower-item", Name: "模拟付款后求花",
		TriggerType: TriggerOrderPaid, Enabled: true, Priority: 100,
		ConfigJSON: `{"request_red_flower":true}`,
		Actions:    []db.AutomationActionInput{catchupCardAction(cardID)},
	})
	if ruleErr != nil || ruleID <= 0 {
		t.Fatalf("写入带求花选项的付款规则失败: %v", ruleErr)
	}
	// orderErr 是本地订单夹具写入失败时的错误；初始订单必须待发货。
	orderErr := store.Orders.Upsert(ctx, "flower-order", db.OrderUpsertOpts{
		CookieID: "cid", ItemID: "flower-item", BuyerID: "buyer-flower",
		ChatID: "flower-chat", OrderStatus: "pending_ship",
		Quantity: "1", Amount: "9.90", SpecName: "颜色", SpecValue: "黑",
	})
	if orderErr != nil {
		t.Fatal(orderErr)
	}
	// gateway 模拟平台明确确认发货与原生求小红花成功。
	gateway := &fakeMTop{
		consignOk: true, consignRet: []string{"SUCCESS::调用成功"},
		redFlowerOK: true, redFlowerRet: []string{"SUCCESS::调用成功"},
	}
	// sender 记录一次网盘文本发货但不联系真实买家。
	sender := &testSender{}
	// center 是通过注入模拟平台与消息发送器创建的正式自动化中心。
	center := NewWithDependencies(store, testSenderProvider{sender: sender}, nil, CenterDependencies{MTop: gateway})
	// task 是明确卖家角色、金额和规格均合法的付款通知。
	task := Task{Source: "ws", AccountID: "cid", OrderRole: OrderRoleSeller,
		TriggerType: TriggerOrderPaid, OrderID: "flower-order", ItemID: "flower-item",
		BuyerID: "buyer-flower", ChatID: "flower-chat",
	}
	if handleErr := center.HandleTask(ctx, task); handleErr != nil {
		t.Fatalf("自动发货、确认及求花链路失败: %v", handleErr)
	}
	// shipped 是平台确认结果写回的本地订单事实。
	shipped, shippedErr := store.Orders.Get(ctx, "flower-order")
	if shippedErr != nil || !shipped.SystemShipped || shipped.OrderStatus != "shipped" {
		t.Fatalf("求花前必须已确认发货: order=%+v err=%v", shipped, shippedErr)
	}
	if gateway.consignCalls != 1 || gateway.redFlowerCalls != 1 || gateway.redFlowerOrderIn != "flower-order" || len(sender.texts) != 1 {
		t.Fatalf("发货、平台确认、求花次数错误: consign=%d flower=%d sent=%v", gateway.consignCalls, gateway.redFlowerCalls, sender.texts)
	}
	// 重复事件必须复用既有运行收口，既不重新发链接也不重复求花。
	if handleErr := center.HandleTask(ctx, task); handleErr != nil {
		t.Fatalf("重复付款消息的幂等处理失败: %v", handleErr)
	}
	if gateway.consignCalls != 1 || gateway.redFlowerCalls != 1 || len(sender.texts) != 1 {
		t.Fatalf("重复通知触发了平台副作用: consign=%d flower=%d sent=%v", gateway.consignCalls, gateway.redFlowerCalls, sender.texts)
	}
}

// TestRedFlowerNotRequestedWhenConsignRejected 验证平台明确拒绝确认发货后，后续求花动作不会执行。
func TestRedFlowerNotRequestedWhenConsignRejected(t *testing.T) {
	// store、cleanup 让该失败流程拥有独立卡密库存，避免复用成功用例已消费的库存。
	store, cleanup := newAutomationTestStore(t)
	defer cleanup()
	// ctx 用于本次模拟订单提交。
	ctx := context.Background()
	// admin 是账号的合法所有者。
	admin, adminErr := store.Users.GetByUsername(ctx, "admin")
	if adminErr != nil || admin == nil {
		t.Fatalf("读取测试用户失败: %v", adminErr)
	}
	// cardID 是本用例专属的可发放卡密。
	cardID := catchupCard(t, store, admin.ID)
	// ruleErr 是带原生求花选项的自动发货规则创建错误。
	_, ruleErr := store.Automation.Create(ctx, db.AutomationRuleInput{
		UserID: admin.ID, CookieID: "cid", ItemID: "failed-flower-item", Name: "确认失败不求花",
		TriggerType: TriggerOrderPaid, Enabled: true, Priority: 100,
		ConfigJSON: `{"request_red_flower":true}`,
		Actions:    []db.AutomationActionInput{catchupCardAction(cardID)},
	})
	if ruleErr != nil {
		t.Fatal(ruleErr)
	}
	// upsertErr 是待发货订单的本地写入结果。
	if upsertErr := store.Orders.Upsert(ctx, "failed-flower-order", db.OrderUpsertOpts{
		CookieID: "cid", ItemID: "failed-flower-item", BuyerID: "buyer-failed",
		ChatID: "failed-chat", OrderStatus: "pending_ship",
		Quantity: "1", Amount: "9.90", SpecName: "颜色", SpecValue: "黑",
	}); upsertErr != nil {
		t.Fatal(upsertErr)
	}
	// gateway 让模拟平台明确拒绝确认发货，不允许后续求花。
	gateway := &fakeMTop{
		consignOk: false, consignRet: []string{"FAIL_BIZ::发货失败"},
		redFlowerOK: true, redFlowerRet: []string{"SUCCESS::调用成功"},
	}
	// sender 记录发货内容，真实买家不会收到该测试消息。
	sender := &testSender{}
	// center 用正式执行器组合本地模拟服务。
	center := NewWithDependencies(store, testSenderProvider{sender: sender}, nil, CenterDependencies{MTop: gateway})
	// task 是本订单唯一模拟付款通知。
	task := Task{
		Source: "ws", AccountID: "cid", OrderRole: OrderRoleSeller,
		TriggerType: TriggerOrderPaid, OrderID: "failed-flower-order",
		ItemID: "failed-flower-item", BuyerID: "buyer-failed", ChatID: "failed-chat",
	}
	if handleErr := center.HandleTask(ctx, task); handleErr == nil {
		t.Fatal("平台确认发货失败时自动化必须返回错误")
	}
	if gateway.consignCalls != 1 || gateway.redFlowerCalls != 0 || len(sender.texts) != 1 {
		t.Fatalf("确认发货失败时不该求花: consign=%d flower=%d sent=%v", gateway.consignCalls, gateway.redFlowerCalls, sender.texts)
	}
}
