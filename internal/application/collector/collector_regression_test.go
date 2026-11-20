package collector

import (
	"context"
	"errors"
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

// TestCollectorCommaSeparatedIDs 验证纯数字批量输入的逗号和去重，同时保留分享文案。
func TestCollectorCommaSeparatedIDs(t *testing.T) {
	// ids、err 保存本地解析出的有效商品数字标识。
	ids, err := ExtractItemIDs([]string{"10001,10002，10001", "【分享】好东西，https://www.goofish.com/item?id=10003"})
	if err != nil || len(ids) != 3 || ids[0] != "10001" || ids[1] != "10002" || ids[2] != "10003" {
		t.Fatal("数字 ID 列表解析错误")
	}
}

// TestCollectorExactPrice 验证精确到分的计算与非法金额保护。
func TestCollectorExactPrice(t *testing.T) {
	// cents、err 分别表示 0.29 元的精确分值和解析错误。
	cents, err := ParsePriceCents("0.29", false)
	if err != nil || cents != 29 {
		t.Fatalf("金额不准确: %d %v", cents, err)
	}
	// err 验证超出分值存储范围的金额必须报错。
	if _, err := ParsePriceCents("99999999999999999999.99", false); err == nil {
		t.Fatal("未拒绝溢出金额")
	}
	// err 验证原始价格缺失时禁止使用未知价格。
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

// TestCollectorRejectIncompleteSave 验证明示补全详情失败时不允许创建摘要模板。
func TestCollectorRejectIncompleteSave(t *testing.T) {
	// creator 记录实际写入的模板，必须保持为空。
	creator := &fakeTemplateCreator{}
	// platform 模拟明确的详情查询失败。
	platform := &fakePlatform{owned: true, detailErrByID: map[string]error{"10001": errors.New("fixture detail unavailable")}}
	// svc、err 为完全隔离的转存用例。
	svc, err := NewService(Dependencies{Platform: platform, ImageDownloader: fakeDownloader{}, ImageUploader: &fakeUploader{}, TemplateCreator: creator})
	if err != nil {
		t.Fatal(err)
	}
	// result、err 记录请求补全但详情不存在时的响应。
	result, err := svc.SaveToTemplates(context.Background(), 1, SaveTemplatesInput{CookieID: "a", FetchDetailIfMissing: true, Items: []SaveTemplateItem{{ItemID: "10001", Title: "摘要", Price: "1.00", ImageURLs: []string{"https://example.com/p.png"}}}})
	if err != nil || result.Succeeded != 0 || result.Failed != 1 || len(creator.created) != 0 {
		t.Fatal("详情失败仍写入模板")
	}
}

// existingCollectorTemplate 模拟已持久化完成的同内容转存，不提供任何外部调用。
type existingCollectorTemplate struct {
	// fakeTemplateCreator 记录不应发生的重复创建。
	fakeTemplateCreator
}

// FindCollectorTemplate 返回已保存的原模板，验证重试直接复用本地结果。
func (*existingCollectorTemplate) FindCollectorTemplate(context.Context, int64, string) (libraryapp.Template, error) {
	return libraryapp.Template{ID: 42, Title: "之前保存的模板", ImageIDs: []int64{1, 2}}, nil
}

// TestCollectorExistingTemplateReturnsBeforeExternalWork 验证重复提交时不会访问图片、AI 或详情端口。
func TestCollectorExistingTemplateReturnsBeforeExternalWork(t *testing.T) {
	// creator 是带本地幂等查找能力的测试替身。
	creator := &existingCollectorTemplate{}
	// platform 是只用于账号归属核对的虚拟平台端口。
	platform := &fakePlatform{owned: true}
	// svc 使用空图片端口；重复调用外部步骤将令测试失败。
	svc := &Service{platform: platform, templateCreator: creator}
	// res、err 是对既有模板的同内容请求结果。
	res, err := svc.SaveToTemplates(context.Background(), 1, SaveTemplatesInput{CookieID: "a", FetchDetailIfMissing: true, Items: []SaveTemplateItem{{ItemID: "10001", Title: "摘要"}}})
	if err != nil || res.Succeeded != 1 || res.Results[0].TemplateID != 42 || len(platform.detailCalls) != 0 || len(creator.created) != 0 {
		t.Fatal("重复转存未直接复用既有模板")
	}
}

// secondaryImageFailure 模拟第二张图片下载失败，验证部分图片不能标记完整转存。
type secondaryImageFailure struct{}

// Fetch 仅对第二张测试图片返回失败。
func (secondaryImageFailure) Fetch(_ context.Context, rawURL string) ([]byte, error) {
	if rawURL == "https://example.com/b.png" {
		return nil, errors.New("fixture secondary image unavailable")
	}
	return []byte("fixture image"), nil
}

// TestCollectorRejectMissingSecondaryImage 验证副图损坏时不创建缺图模板。
func TestCollectorRejectMissingSecondaryImage(t *testing.T) {
	// creator 记录模板创建次数。
	creator := &fakeTemplateCreator{}
	// svc、err 是本地测试服务和初始化异常。
	svc, err := NewService(Dependencies{Platform: &fakePlatform{owned: true}, ImageDownloader: secondaryImageFailure{}, ImageUploader: &fakeUploader{}, TemplateCreator: creator})
	if err != nil {
		t.Fatal(err)
	}
	// res、err 是副图下载失败后的逐件结果。
	res, err := svc.SaveToTemplates(context.Background(), 1, SaveTemplatesInput{Items: []SaveTemplateItem{{ItemID: "10001", Title: "测试", Price: "1.00", ImageURLs: []string{"https://example.com/a.png", "https://example.com/b.png"}}}})
	if err != nil || res.Failed != 1 || len(creator.created) != 0 {
		t.Fatal("缺失副图却成功创建模板")
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
