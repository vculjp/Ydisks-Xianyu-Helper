package collector

import (
	"context"
	"testing"

	"xianyu-go/internal/catalog"
)

// TestCollectedSourceSavedAsPublishableTemplate 验证采集来源的完整类目、SKU、图片和原始快照从请求落入商品模板。
func TestCollectedSourceSavedAsPublishableTemplate(t *testing.T) {
	// platform 是不触网的采集替身，不会触发真实平台接口。
	platform := &fakePlatform{owned: true}
	// creator 将最终资源库模板保存为内存快照，核验实际传入的字段。
	creator := &fakeTemplateCreator{}
	// uploader 模拟主图和规格图两次落库后的主键。
	uploader := &fakeUploader{}
	// service 使用已有的生产转存编排和受控图片接口。
	service, err := NewService(Dependencies{Platform: platform, ImageDownloader: fakeDownloader{}, ImageUploader: uploader, TemplateCreator: creator})
	if err != nil {
		t.Fatal(err)
	}
	// source 是已有用户授权商品详情中明确的频道分类、固定运费和多 SKU。
	source := catalog.SourceInfo{
		ItemID: "1122334455", WebURL: "https://www.goofish.com/item?id=1122334455",
		Category:    catalog.Category{CatID: "5", CatName: "真实类目", ChannelCatID: "6", TBCatID: "7"},
		Specs:       []catalog.Spec{{Name: "颜色", Values: []catalog.SpecValue{{Value: "蓝", ImageURL: "https://img.alicdn.com/blue.jpg"}, {Value: "黑"}}}},
		SKUs:        []catalog.SKU{{ValueLabels: []string{"蓝"}, Price: "8.00", Quantity: 3}, {ValueLabels: []string{"黑"}, Price: "9.00", Quantity: 2}},
		PostageMode: "fixed", Postage: "3.50", Quantity: 5,
	}
	// saved 是单品来源转存结果，售价设置为原价。
	saved, err := service.SaveToTemplates(context.Background(), 1, SaveTemplatesInput{
		CookieID: "test-account", PriceMode: "keep", Quantity: 5, PostageMode: "source",
		Items: []SaveTemplateItem{{ItemID: source.ItemID, Title: "真实商品", Description: "真实描述", Price: "8.00",
			ImageURLs: []string{"https://img.alicdn.com/main.jpg"}, HasFullDetail: true, Source: source}},
	})
	if err != nil || saved.Succeeded != 1 || len(creator.created) != 1 {
		t.Fatalf("原商品转存失败：%+v %v", saved, err)
	}
	// template 是落库前的完整模板快照。
	template := creator.created[0]
	if template.Category.CatID != "5" || template.Category.ChannelCatID != "6" || template.PostageMode != "fixed" || template.PostageCents != 350 {
		t.Fatalf("类目或运费未落入可发布模板：%+v", template)
	}
	if template.Specs == nil || len(template.Specs.SKUs) != 2 || len(template.Specs.SpecImageIDs) != 1 || template.Specs.SKUs[1].PriceCents != 900 {
		t.Fatalf("来源 SKU 或规格图片没有写入：%+v", template.Specs)
	}
	if template.Source.WebURL != source.WebURL || template.Source.Category.TBCatID != "7" {
		t.Fatalf("原商品公开信息快照丢失：%+v", template.Source)
	}
	if len(platform.detailCalls) > 0 {
		t.Fatalf("已有详情不应重复发起采集：%v", platform.detailCalls)
	}
}
