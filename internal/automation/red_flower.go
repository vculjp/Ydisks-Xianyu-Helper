package automation

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"xianyu-go/internal/xianyu/mtop"
)

// requestRedFlower 在已确认的卖家发货订单上调用原生求花接口，前置检查在平台请求前完成；
// 一个自动化运行只执行一次该动作，若外部结果不确定则隔离人工核对，绝不自动重放求花请求。
func (e *automationActionExecutor) requestRedFlower(ctx context.Context, task Task) error {
	if err := checkRunExecution(ctx); err != nil {
		return fmt.Errorf("%w: %w", errActionNotPerformed, err)
	}
	if strings.TrimSpace(task.OrderID) == "" {
		return fmt.Errorf("%w: 求小红花缺少订单ID", errActionNotPerformed)
	}
	// enabled、settingErr 表示账号自动确认发货设置；关闭时不得通过求花绕过订单状态闸门。
	enabled, settingErr := e.store.Cookies.GetAutoConsign(ctx, task.AccountID)
	if settingErr != nil {
		return fmt.Errorf("%w: 读取求花前确认发货开关: %v", errActionNotPerformed, settingErr)
	}
	if !enabled {
		e.logger.Info("账号未启用自动确认发货，跳过求小红花", "account", task.AccountID, "order_id", task.OrderID)
		return nil
	}
	// order、orderErr 是必须由本机确认发货结果证明的订单；绝不以发过聊天链接推断已发货。
	order, orderErr := e.store.Orders.Get(ctx, task.OrderID)
	if orderErr != nil {
		return fmt.Errorf("%w: 读取求花订单状态: %v", errActionNotPerformed, orderErr)
	}
	if order.CookieID != task.AccountID || !order.SystemShipped || (order.OrderStatus != "shipped" && order.OrderStatus != "completed") {
		return fmt.Errorf("%w: 订单未由本账号确认发货，禁止求小红花", errActionNotPerformed)
	}
	// client 是支持原生求花能力的既有 MTOP 实现；缺少该能力时不退化为聊天消息。
	client, supported := e.mtop().(redFlowerClient)
	if !supported {
		return fmt.Errorf("%w: 平台客户端尚不支持求小红花", errActionNotPerformed)
	}
	// session 从既有凭证视图读取 Cookie；MTOP 请求期间不持有账号锁。
	session, sessionErr := e.openShipmentConsignSession(ctx, task.AccountID)
	if sessionErr != nil {
		return fmt.Errorf("%w: 读取求花账号凭证: %v", errActionNotPerformed, sessionErr)
	}
	// ok、returns、updatedCookie、requestErr 是平台一次求花结果及令牌续期响应。
	ok, returns, updatedCookie, requestErr := client.RequestRedFlowerContext(session.requestContext, session.cookieStr, task.OrderID)
	// cookieState 将平台响应 Cookie 条件写回，避免覆盖并发续期的账号凭证。
	cookieState := e.persistShipmentConsignCookies(ctx, task.AccountID, session, shipmentConsignResult{
		succeeded: ok, returns: returns, updatedCookie: updatedCookie, callErr: requestErr,
	})
	if requestErr != nil {
		if mtop.IsSessionExpiredErr(requestErr) || mtop.IsMTopTokenExpiredErr(requestErr) {
			return fmt.Errorf("%w: 求花账号凭证已失效: %v", errActionNotPerformed, requestErr)
		}
		// responseError 是平台有明确拒绝码时的确定失败；没有业务响应时传输结果未知，不自动重放。
		var responseError *mtop.MTopResponseError
		if errors.As(requestErr, &responseError) {
			return fmt.Errorf("%w: 平台拒绝求小红花: %v", errActionNotPerformed, requestErr)
		}
		return uncertainAction(fmt.Errorf("求小红花远端结果不确定: %w", requestErr))
	}
	if !ok {
		return fmt.Errorf("%w: 平台未确认求小红花成功", errActionNotPerformed)
	}
	// 远端已确认求花成功时，即使随后 Cookie 条件写回冲突，也不能重放平台副作用。
	if len(cookieState.errors) > 0 {
		e.logger.Warn("求小红花成功但账号凭证更新需核对", "account", task.AccountID, "order_id", task.OrderID, "err", errors.Join(cookieState.errors...))
	}
	e.logger.Info("订单求小红花成功", "account", task.AccountID, "order_id", task.OrderID)
	return nil
}
