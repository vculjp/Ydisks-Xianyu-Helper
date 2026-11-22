package adapter

import (
	"errors"
	"strings"
	"testing"

	"xianyu-go/internal/xianyu/mtop"
)

// TestCollectorRiskWithoutVerificationLink 验证 RGV587 未提供验证码地址时不会虚构滑块弹窗，并保持可识别的风控错误链。
func TestCollectorRiskWithoutVerificationLink(t *testing.T) {
	// risk 是平台仅返回风控或拥堵代码、没有滑块链接的测试错误。
	risk := &mtop.RiskVerificationError{Ret: []string{"FAIL_SYS_USER_VALIDATE::RGV587_ERROR::SM"}}
	// formatted 是客服采集界面展示的最终错误，底层原因不得丢失。
	formatted := formatCollectorPlatformError(risk)
	if !errors.Is(formatted, risk) {
		t.Fatal("格式化后未保留风控错误链")
	}
	if !strings.Contains(formatted.Error(), "未提供可直接打开的滑块验证地址") || strings.Contains(formatted.Error(), "滑过后") {
		t.Fatal("无验证地址却声称窗口会弹出滑块或滑过后就能恢复")
	}
}

// TestCollectorRiskWithOfficialVerificationLink 验证平台确有验证地址时只提示人工按官网要求处理，不保证风控解除。
func TestCollectorRiskWithOfficialVerificationLink(t *testing.T) {
	// risk 模拟平台实际返回可供人工查看的官方验证地址。
	risk := &mtop.RiskVerificationError{Ret: []string{"FAIL_SYS_USER_VALIDATE"}, VerificationURL: "https://passport.goofish.com/punish"}
	// formatted 是本轮停止采集后返回给用户的提示。
	formatted := formatCollectorPlatformError(risk)
	if !errors.Is(formatted, risk) || !strings.Contains(formatted.Error(), "平台已提供验证地址") {
		t.Fatal("平台附带的验证地址未正确归类为人工验证场景")
	}
}
