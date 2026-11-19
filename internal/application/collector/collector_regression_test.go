package collector

import (
	"context"
	"testing"

	libraryapp "xianyu-go/internal/application/library"
)

// TestRadarScoreVelocityUnits 验证日均想要定点数的权重按真实人数计算，首次发现不冒充真实增量。
func TestRadarScoreVelocityUnits(t *testing.T) {
	// now 是固定观测时间；商品已发布五天，累计想要 100 人。
	now := int64(1700000000)
	// target 表示已经观测过的关键词目标。
	target := RadarWatchTarget{TargetType: "keyword", LastScannedAt: now - 3600}
	// item 模拟首次进入搜索样本的既有商品。
	item := CollectedItem{ItemID: "10001", WantCount: 100, PublishTimeUnix: now - 5*86400}
	// snap 是首次观测后的评分和增量。
	snap := buildUpdatedRadarSnapshot(now, target, item, RadarItemSnapshot{}, false)
	if snap.DeltaWant != 0 || snap.DailyVelocityX100 != 2000 || snap.ViralScore != 207 {
		t.Fatalf("首次观测评分不正确: delta=%d velocity=%d score=%d", snap.DeltaWant, snap.DailyVelocityX100, snap.ViralScore)
	}
}

// TestCollectorExactPrice 验证精确到分的计算与非法金额保护。
func TestCollectorExactPrice(t *testing.T) {
	// cents、err 分别表示 0.29 元的精确分值和解析错误。
	cents, err := ParsePriceCents("0.29", false)
	if err != nil || cents != 29 {
		t.Fatalf("金额不准确: %d %v", cents, err)
	}
	if _, err := ParsePriceCents("99999999999999999999.99", false); err == nil {
		t.Fatal("未拒绝溢出金额")
	}
	if _, err := ComputeTargetPriceCents("", "keep", ""); err == nil {
		t.Fatal("未知价格不应默认定价")
	}
}

// TestCollectorSummaryDescriptionAndIdempotencyKey 验证摘要补全及相同转存请求产生稳定幂等标识。
func TestCollectorSummaryDescriptionAndIdempotencyKey(t *testing.T) {
	// platform 模拟摘要原价缺失并补抓完整描述与真实价格。
	platform := &fakePlatform{owned: true, detailsByID: map[string]CollectedItem{
		"10001": {ItemID: "10001", Title: "标题", Description: "完整正文", Price: "0.99", ImageURLs: []string{"https://example.com/a.png"}, HasFullDetail: true},
	}}
	// creator 记录两次调用送往数据库的模板。
	creator := &fakeTemplateCreator{}
	// svc、err 是无外部依赖的测试服务与初始化错误。
	svc, err := NewService(Dependencies{Platform: platform, ImageDownloader: fakeDownloader{}, ImageUploader: &fakeUploader{}, TemplateCreator: creator})
	if err != nil {
		t.Fatal(err)
	}
	// input 模拟旧客户端用标题填充描述及未知售价的请求。
	input := SaveTemplatesInput{CookieID: "account", FetchDetailIfMissing: true, Items: []SaveTemplateItem{{ItemID: "10001", Title: "标题", Description: "标题", Price: "0.00"}}}
	// attempt 代表原请求及响应丢失后的同内容重试。
	for attempt := 0; attempt < 2; attempt++ {
		// result、saveErr 返回本批转存结果及应用层错误。
		result, saveErr := svc.SaveToTemplates(context.Background(), 1, input)
		if saveErr != nil || result.Succeeded != 1 {
			t.Fatalf("转存失败: %+v %v", result, saveErr)
		}
	}
	if creator.created[0].Description != "完整正文" || creator.created[0].PriceCents != 99 ||
		creator.created[0].CollectorKey == "" || creator.created[0].CollectorKey != creator.created[1].CollectorKey {
		t.Fatal("未正确补全原始描述、金额或稳定幂等键")
	}
}

// invalidImageUploader 模拟图片库逐文件返回业务校验失败而非整体异常。
type invalidImageUploader struct{}

// UploadImages 返回非法主图的独立结果，禁止模板收到零值图片主键。
func (invalidImageUploader) UploadImages(_ context.Context, _ int64, _ []libraryapp.ImageUpload) ([]libraryapp.UploadResult, error) {
	return []libraryapp.UploadResult{{Error: "图片格式无效"}}, nil
}

// TestCollectorRejectInvalidPrimaryImage 验证无效主图不会创建模板。
func TestCollectorRejectInvalidPrimaryImage(t *testing.T) {
	// creator 记录实际创建的模板，预期保持空列表。
	creator := &fakeTemplateCreator{}
	// svc、err 构造逐张图片校验失败的测试服务。
	svc, err := NewService(Dependencies{Platform: &fakePlatform{owned: true}, ImageDownloader: fakeDownloader{}, ImageUploader: invalidImageUploader{}, TemplateCreator: creator})
	if err != nil {
		t.Fatal(err)
	}
	// result、err 是主图校验失败后的逐条转存响应。
	result, err := svc.SaveToTemplates(context.Background(), 1, SaveTemplatesInput{Items: []SaveTemplateItem{{ItemID: "10001", Title: "标题", Price: "1.00", ImageURLs: []string{"https://example.com/a.png"}}}})
	if err != nil || result.Failed != 1 || len(creator.created) != 0 {
		t.Fatalf("无效主图被错误接受: %+v %v", result, err)
	}
}

// TestCollectorSellerRepeatedPageStops 验证重复分页不会持续请求后续页。
func TestCollectorSellerRepeatedPageStops(t *testing.T) {
	// platform 按页返回重复商品，第三页仅用于证明重复页之后不再继续。
	platform := &fakePlatform{owned: true, sellerPages: map[int][]CollectedItem{
		1: {{ItemID: "10001"}}, 2: {{ItemID: "10001"}}, 3: {{ItemID: "10003"}},
	}}
	// svc 是使用本地测试端口构造的服务。
	svc, err := NewService(Dependencies{Platform: platform, ImageDownloader: fakeDownloader{}, ImageUploader: &fakeUploader{}, TemplateCreator: &fakeTemplateCreator{}})
	if err != nil {
		t.Fatal(err)
	}
	// res、err 是三页请求遭遇重复页时的部分成功结果及错误。
	res, err := svc.CollectSellerItems(context.Background(), 1, SellerCollectInput{CookieID: "account", SellerInput: "12345", MaxPages: 3})
	if err != nil || len(res.Items) != 1 || res.Warning == "" {
		t.Fatalf("重复页未安全停止: %+v err=%v", res, err)
	}
}
