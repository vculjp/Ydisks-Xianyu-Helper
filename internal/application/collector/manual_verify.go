package collector

import (
	"context"
	"net/url"
	"strings"
)

// OpenManualVerify 校验账号归属并弹出对应闲鱼网页窗口供用户手动滑过安全验证。
func (s *Service) OpenManualVerify(ctx context.Context, userID int64, input OpenManualVerifyInput) (string, error) {
	if userID <= 0 {
		return "", invalid("用户会话无效")
	}
	if s.manualVerifier == nil {
		return "", invalid("当前环境未启用可视化浏览器验证功能")
	}
	// cookieID 是待恢复风控的目标账号。
	cookieID := strings.TrimSpace(input.CookieID)
	if cookieID == "" {
		return "", invalid("请先选择需要过验证的闲鱼账号")
	}
	// err 校验所选闲鱼账号是否归当前用户所有。
	if err := s.requireOwnedAccount(ctx, userID, cookieID); err != nil {
		return "", err
	}
	// targetURL 根据当前触发风控的业务场景精准选择对应闲鱼页面，确保生成的 x5sec 路径匹配。
	targetURL := buildManualVerifyTargetURL(input.Scene, input.Keyword, input.TargetID)
	// err 弹出桌面可见验证窗口。
	if err := s.manualVerifier.OpenVerifyWindow(ctx, cookieID, targetURL); err != nil {
		return "", err
	}
	return targetURL, nil
}

// CompleteManualVerify 确认用户已在弹出窗口完成手动验证，自动读取完整 Cookie Jar 快照落库并关闭窗口。
func (s *Service) CompleteManualVerify(ctx context.Context, userID int64, cookieID string) (ManualVerifyCompleteResult, error) {
	if userID <= 0 {
		return ManualVerifyCompleteResult{}, invalid("用户会话无效")
	}
	if s.manualVerifier == nil {
		return ManualVerifyCompleteResult{}, invalid("当前环境未启用可视化浏览器验证功能")
	}
	// normalizedID 是目标账号标识。
	normalizedID := strings.TrimSpace(cookieID)
	if normalizedID == "" {
		return ManualVerifyCompleteResult{}, invalid("账号标识不能为空")
	}
	// err 校验目标账号归属权限。
	if err := s.requireOwnedAccount(ctx, userID, normalizedID); err != nil {
		return ManualVerifyCompleteResult{}, err
	}
	// count、err 提取并保存完整 Cookie 快照。
	count, err := s.manualVerifier.CompleteVerifyWindow(ctx, normalizedID)
	if err != nil {
		return ManualVerifyCompleteResult{}, err
	}
	return ManualVerifyCompleteResult{CookieID: normalizedID, SyncedCount: count}, nil
}

// CancelManualVerify 关闭打开中的桌面验证窗口而不覆盖原凭证。
func (s *Service) CancelManualVerify(ctx context.Context, userID int64, cookieID string) error {
	if userID <= 0 {
		return invalid("用户会话无效")
	}
	if s.manualVerifier == nil {
		return nil
	}
	// normalizedID 是目标账号标识。
	normalizedID := strings.TrimSpace(cookieID)
	if normalizedID == "" {
		return nil
	}
	// err 校验账号归属后再关闭窗口。
	if err := s.requireOwnedAccount(ctx, userID, normalizedID); err != nil {
		return err
	}
	return s.manualVerifier.CancelVerifyWindow(ctx, normalizedID)
}

// buildManualVerifyTargetURL 根据采集页签自动构造能直接触发对应接口滑块框的闲鱼官方网址。
func buildManualVerifyTargetURL(scene, keyword, targetID string) string {
	switch strings.TrimSpace(scene) {
	case "detail":
		// cleanID 尝试提取合法商品 ID 以直接打开详情页触发 idle.pc.detail 的 x5sec。
		if ids, err := ExtractItemIDs([]string{targetID}); err == nil && len(ids) > 0 {
			return "https://www.goofish.com/item?id=" + url.QueryEscape(ids[0])
		}
	case "seller":
		// sellerID 尝试提取卖家 ID 以打开个人主页。
		if sellerID, err := ExtractSellerID(targetID); err == nil && sellerID != "" {
			return "https://www.goofish.com/personal?userId=" + url.QueryEscape(sellerID)
		}
	}
	// q 默认打开搜索结果页以直接触发 idlemtopsearch.pc.search 的滑块并写入对应路径 x5sec。
	q := strings.TrimSpace(keyword)
	if q == "" {
		q = "电子资料"
	}
	return "https://www.goofish.com/search?q=" + url.QueryEscape(q)
}
