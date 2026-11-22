package mtop

import (
	"context"
	"errors"
	"strings"
)

// RedFlowerAPI 是闲鱼订单原生“求小红花”接口，路径和版本均使用 1.0。
const RedFlowerAPI = "https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.red.flower/1.0/"

// RequestRedFlowerContext 只对给定真实订单调用一次求小红花；会话与令牌刷新使用项目既有 MTOP 传输层，
// updatedCookies 仅供上层条件持久化，接口错误时不得把平台操作视为成功。
func (c *ClientImpl) RequestRedFlowerContext(ctx context.Context, cookiesStr, orderID string) (bool, []string, string, error) {
	if strings.TrimSpace(orderID) == "" {
		return false, nil, "", errors.New("求小红花缺少订单ID")
	}
	// result、updatedCookies、err 是单个订单的 MTOP 业务响应、续期 Cookie 和可能的明确失败。
	result, updatedCookies, err := c.accountTaskRequest(ctx, cookiesStr, firstNonEmptyURL(c.RedFlowerURL, RedFlowerAPI),
		"mtop.taobao.idlemessage.red.flower", "1.0",
		map[string]any{"orderId": orderID, "channel": "list"}, "https://www.goofish.com/")
	if err != nil {
		return false, nil, updatedCookies, err
	}
	return true, result.Ret, updatedCookies, nil
}
