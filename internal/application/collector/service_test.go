package collector

import (
	"context"
	"errors"
	"testing"

	libraryapp "xianyu-go/internal/application/library"
)

// fakePlatform 模拟闲鱼平台采集端口并记录调用轨迹。
type fakePlatform struct {
	// owned 控制账号归属判断返回值。
	owned bool
	// searchItems 是搜索接口固定返回的商品列表。
	searchItems []CollectedItem
	// detailsByID 按商品 ID 提供预设详情或错误。
	detailsByID map[string]CollectedItem
	// detailErrByID 按商品 ID 提供预设错误。
	detailErrByID map[string]error
	// sellerPages 按页码提供预设店铺商品切片。
	sellerPages map[int][]CollectedItem
	// sellerErrByPage 按页码模拟风控或网络错误。
	sellerErrByPage map[int]error
	// abortErr 标记需要被判定为风控熔断的错误实例。
	abortErr error
	// detailCalls 记录被请求过详情的商品 ID 顺序。
	detailCalls []string
}

// OwnsAccount 返回预设的账号归属状态。
func (f *fakePlatform) OwnsAccount(_ context.Context, _ int64, _ string) (bool, error) {
	return f.owned, nil
}

// SearchMarket 返回预设的全站搜索结果。
func (f *fakePlatform) SearchMarket(_ context.Context, _ string, _ PlatformSearchParams) ([]CollectedItem, bool, int, error) {
	return append([]CollectedItem(nil), f.searchItems...), false, len(f.searchItems), nil
}

// FetchItemDetail 返回预设商品详情并记录请求顺序。
func (f *fakePlatform) FetchItemDetail(_ context.Context, _, itemID string, _ bool) (CollectedItem, error) {
	f.detailCalls = append(f.detailCalls, itemID)
	// err、exists 检查是否存在预设单品错误。
	if err, exists := f.detailErrByID[itemID]; exists {
		return CollectedItem{}, err
	}
	return f.detailsByID[itemID], nil
}

// FetchSellerPage 返回预设的店铺分页商品。
func (f *fakePlatform) FetchSellerPage(_ context.Context, _, _ string, pageNumber, _ int, _ bool) ([]CollectedItem, bool, int, error) {
	// err、exists 检查是否存在预设店铺分页错误。
	if err, exists := f.sellerErrByPage[pageNumber]; exists {
		return nil, false, 0, err
	}
	// items 是当前页商品列表。
	items := f.sellerPages[pageNumber]
	return items, pageNumber < len(f.sellerPages), 10, nil
}

// IsAbortError 判断错误是否为预设的风控熔断错误。
func (f *fakePlatform) IsAbortError(err error) bool {
	return f.abortErr != nil && errors.Is(err, f.abortErr)
}

// fakeRewriter 模拟大模型防重改写端口。
type fakeRewriter struct{}

// Rewrite 返回添加差异化前缀的新标题与新文案。
func (fakeRewriter) Rewrite(_ context.Context, _ int64, input RewriteInput) (RewriteResult, error) {
	return RewriteResult{
		Title:       "精选整理：" + input.Title,
		Description: input.Description + "\n（24小时自动发货）",
	}, nil
}

// fakeDownloader 模拟公网商品图片下载器。
type fakeDownloader struct{}

// Fetch 返回伪造的 PNG 文件头字节。
func (fakeDownloader) Fetch(_ context.Context, _ string) ([]byte, error) {
	return []byte("fake-image-bytes"), nil
}

// fakeUploader 模拟图片库上传器并递增分配主键。
type fakeUploader struct {
	// nextID 保存下一个分配的图片主键。
	nextID int64
}

// UploadImages 为每个上传文件分配唯一图片库主键。
func (u *fakeUploader) UploadImages(_ context.Context, _ int64, files []libraryapp.ImageUpload) ([]libraryapp.UploadResult, error) {
	// out 保存上传结果列表。
	out := make([]libraryapp.UploadResult, 0, len(files))
	// file 是单张待保存图片。
	for _, file := range files {
		u.nextID++
		out = append(out, libraryapp.UploadResult{
			Image: libraryapp.Image{ID: u.nextID, Filename: file.Filename},
		})
	}
	return out, nil
}

// fakeTemplateCreator 模拟商品模板创建器并记录最后保存的模板。
type fakeTemplateCreator struct {
	// created 保存已创建的全部模板快照。
	created []libraryapp.Template
}

// CreateTemplate 记录模板并分配递增主键。
func (c *fakeTemplateCreator) CreateTemplate(_ context.Context, input libraryapp.Template) (libraryapp.Template, error) {
	input.ID = int64(len(c.created) + 1)
	c.created = append(c.created, input)
	return input, nil
}

// TestExtractIDsAndPriceCalculation 验证链接提取商品/卖家 ID 及三种定价策略分值计算。
func TestExtractIDsAndPriceCalculation(t *testing.T) {
	// ids、err 测试从分享文案、标准链接和纯数字中去重提取商品 ID。
	ids, err := ExtractItemIDs([]string{
		"【闲鱼】https://www.goofish.com/item?id=1099053019895&ut_sk=1 点击链接直接打开\n1099053019895\n8877665544",
	})
	if err != nil || len(ids) != 2 || ids[0] != "1099053019895" || ids[1] != "8877665544" {
		t.Fatalf("ExtractItemIDs unexpected: ids=%v err=%v", ids, err)
	}
	// sellerID、sellerErr 测试从同行个人空间链接提取 userId。
	sellerID, sellerErr := ExtractSellerID("https://www.goofish.com/personal?spm=a21ybx&userId=2177750131")
	if sellerErr != nil || sellerID != "2177750131" {
		t.Fatalf("ExtractSellerID unexpected: id=%q err=%v", sellerID, sellerErr)
	}
	// offsetCents、offsetErr 验证降价超过原价时自动保底 1 分（0.01 元）。
	offsetCents, offsetErr := ComputeTargetPriceCents("5.00", "offset", "-10.00")
	if offsetErr != nil || offsetCents != 1 {
		t.Fatalf("expected floor 1 cent, got %d err=%v", offsetCents, offsetErr)
	}
}

// TestCollectorWorkflowAndRiskAbort 验证搜索想要数排序、详情风控熔断及一键补全详情+AI改写转存商品模板闭环。
func TestCollectorWorkflowAndRiskAbort(t *testing.T) {
	// riskErr 模拟闲鱼 RGV587 风控验证错误。
	riskErr := errors.New("RGV587 risk control")
	// platform 配置预设搜索结果与详情响应。
	platform := &fakePlatform{
		owned:    true,
		abortErr: riskErr,
		searchItems: []CollectedItem{
			{ItemID: "10001", Title: "普通模板", Price: "5.00", WantCount: 12},
			{ItemID: "10002", Title: "爆款资料", Price: "9.90", WantCount: 380},
		},
		detailsByID: map[string]CollectedItem{
			"10002": {
				ItemID:        "10002",
				Title:         "爆款资料",
				Description:   "完整高清教材",
				Price:         "9.90",
				ImageURLs:     []string{"https://img.alicdn.com/1.jpg", "https://img.alicdn.com/2.jpg"},
				HasFullDetail: true,
			},
		},
		detailErrByID: map[string]error{
			"10003": riskErr,
		},
	}
	// creator 记录生成的商品模板。
	creator := &fakeTemplateCreator{}
	// svc、svcErr 构造待测采集服务。
	svc, svcErr := NewService(Dependencies{
		Platform:        platform,
		Rewriter:        fakeRewriter{},
		ImageDownloader: fakeDownloader{},
		ImageUploader:   &fakeUploader{},
		TemplateCreator: creator,
	})
	if svcErr != nil {
		t.Fatalf("NewService failed: %v", svcErr)
	}

	// searchRes、searchErr 验证按想要数降序与最低想要数筛选。
	searchRes, searchErr := svc.SearchKeyword(context.Background(), 1, SearchQuery{
		CookieID:     "acc_1",
		Keyword:      "资料",
		SortMode:     "want_desc",
		MinWantCount: 50,
	})
	if searchErr != nil || len(searchRes.Items) != 1 || searchRes.Items[0].ItemID != "10002" {
		t.Fatalf("unexpected search result: %+v err=%v", searchRes, searchErr)
	}

	// detailBatch、detailErr 验证批量抓详情遇到风控立即熔断，不再继续请求第 3 个商品 10004。
	detailBatch, detailErr := svc.CollectItemDetails(context.Background(), 1, DetailCollectInput{
		CookieID:  "acc_1",
		RawInputs: []string{"10002\n10003\n10004"},
	})
	if detailErr != nil {
		t.Fatalf("CollectItemDetails failed: %v", detailErr)
	}
	if !detailBatch.AbortedByRisk || len(detailBatch.Items) != 1 || len(platform.detailCalls) != 2 {
		t.Fatalf("expected immediate risk abort before 10004, calls=%v result=%+v", platform.detailCalls, detailBatch)
	}

	// saveRes、saveErr 验证一键补抓多图 + AI 防重改写 + 绑定发货模板 T1 生成本地商品模板。
	saveRes, saveErr := svc.SaveToTemplates(context.Background(), 1, SaveTemplatesInput{
		CookieID:             "acc_1",
		FetchDetailIfMissing: true,
		EnableAIRewrite:      true,
		PriceMode:            "offset",
		PriceValue:           "-1.00",
		Quantity:             10,
		PostageMode:          "none",
		DeliveryTemplateID:   1,
		CustomVariables:      map[string]string{"link": "https://pan.quark.cn/s/real"},
		Items: []SaveTemplateItem{
			{ItemID: "10002", Title: "爆款资料", Price: "9.90", HasFullDetail: false},
		},
	})
	if saveErr != nil || saveRes.Succeeded != 1 || len(creator.created) != 1 {
		t.Fatalf("SaveToTemplates failed: res=%+v err=%v", saveRes, saveErr)
	}
	// saved 核对最终落库的改写标题、折扣后价格（890 分 = 8.90 元）、2 张图片与发货模板绑定。
	saved := creator.created[0]
	if saved.PriceCents != 890 || len(saved.ImageIDs) != 2 || !saved.Automation.PaidDelivery.Enabled {
		t.Fatalf("unexpected saved template: %+v", saved)
	}
}

// fakeManualVerifier 记录测试中的人工验证窗口打开、完成与关闭调用。
type fakeManualVerifier struct {
	// openedURL 记录最近一次弹出的目标闲鱼网址。
	openedURL string
	// canceled 记录是否调用了取消关闭。
	canceled bool
}

// OpenVerifyWindow 记录打开参数。
func (f *fakeManualVerifier) OpenVerifyWindow(_ context.Context, _, targetURL string) error {
	f.openedURL = targetURL
	return nil
}

// CompleteVerifyWindow 返回固定同步条数。
func (f *fakeManualVerifier) CompleteVerifyWindow(_ context.Context, _ string) (int, error) {
	return 24, nil
}

// CancelVerifyWindow 记录取消标记。
func (f *fakeManualVerifier) CancelVerifyWindow(_ context.Context, _ string) error {
	f.canceled = true
	return nil
}

// TestServiceManualVerifyFlow 验证按场景生成闲鱼过滑块网址、归属校验与同步恢复流程。
func TestServiceManualVerifyFlow(t *testing.T) {
	// verifier 模拟桌面浏览器验证窗口。
	verifier := &fakeManualVerifier{}
	// svc、err 构造带人工验证端口的采集服务。
	svc, err := NewService(Dependencies{
		Platform:        &fakePlatform{owned: true},
		Rewriter:        fakeRewriter{},
		ImageDownloader: fakeDownloader{},
		ImageUploader:   &fakeUploader{},
		TemplateCreator: &fakeTemplateCreator{},
		ManualVerifier:  verifier,
	})
	if err != nil {
		t.Fatalf("NewService failed: %v", err)
	}
	// targetURL、openErr 测试搜索场景生成闲鱼搜索页链接。
	targetURL, openErr := svc.OpenManualVerify(context.Background(), 1, OpenManualVerifyInput{
		CookieID: "acc_1",
		Scene:    "search",
		Keyword:  "Excel函数",
	})
	if openErr != nil || targetURL != "https://www.goofish.com/search?q=Excel%E5%87%BD%E6%95%B0" {
		t.Fatalf("unexpected open result: url=%q err=%v", targetURL, openErr)
	}
	// completeRes、completeErr 测试同步完整 Cookie 快照。
	completeRes, completeErr := svc.CompleteManualVerify(context.Background(), 1, "acc_1")
	if completeErr != nil || completeRes.SyncedCount != 24 {
		t.Fatalf("unexpected complete result: %+v err=%v", completeRes, completeErr)
	}
	// cancelErr 断言取消验证窗口调用成功。
	if cancelErr := svc.CancelManualVerify(context.Background(), 1, "acc_1"); cancelErr != nil || !verifier.canceled {
		t.Fatalf("unexpected cancel result: canceled=%v err=%v", verifier.canceled, cancelErr)
	}
}
