package mtop

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestMarketCollectSearchDetailAndSellerShop 验证全站关键词搜索、单品详情采集及同行店铺列表（含省略 cardList 空列表协议）的完整解析与签名传输。
func TestMarketCollectSearchDetailAndSellerShop(t *testing.T) {
	// server 模拟闲鱼 H5 MTOP 网关，分别响应搜索、详情与个人主页列表三种 API。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// apiName 读取网关查询参数中的目标 MTOP 方法名。
		apiName := r.URL.Query().Get("api")
		w.Header().Set("Content-Type", "application/json")
		switch apiName {
		case "mtop.taobao.idlemtopsearch.pc.search":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret": []string{"SUCCESS::调用成功"},
				"data": map[string]any{
					"nextPage":   true,
					"totalCount": 120,
					"resultList": []any{
						map[string]any{
							"data": map[string]any{
								"item": map[string]any{
									"main": map[string]any{
										"targetUrl": "fleamarket://item?id=8800112233",
										"clickParam": map[string]any{
											"args": map[string]any{
												"price":     "12.80",
												"seller_id": "220011",
												"cat_id":    "50023914",
											},
										},
										"exContent": map[string]any{
											"itemId":       "8800112233",
											"title":        "<em>Excel</em>函数速查电子资料全套",
											"oriPrice":     "¥29.90",
											"picUrl":       "//img.alicdn.com/bao/uploaded/i1/cover1.jpg",
											"area":         "浙江 杭州",
											"userNickName": "学霸资料馆",
											"fishTags": map[string]any{
												"r3": map[string]any{
													"tagList": []any{
														map[string]any{"data": map[string]any{"content": "236人想要"}},
														map[string]any{"data": map[string]any{"content": "包邮"}},
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			})
		case "mtop.taobao.idle.pc.detail":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret": []string{"SUCCESS::调用成功"},
				"data": map[string]any{
					"itemDO": map[string]any{
						"itemId":       "8800112233",
						"title":        "Excel函数速查电子资料全套",
						"desc":         "全套高清整理，拍下自动秒发网盘链接！\n包含百个真实案例。",
						"soldPrice":    "12.80",
						"oriPrice":     "29.90",
						"wantCnt":      236,
						"browseCnt":    1980,
						"categoryId":   "50023914",
						"transportFee": "0.00",
						"imageInfos": []any{
							map[string]any{"url": "//img.alicdn.com/bao/uploaded/i1/cover1.jpg"},
							map[string]any{"url": "http://img.alicdn.com/bao/uploaded/i2/detail2.png"},
						},
					},
					"sellerDO": map[string]any{
						"sellerId": "220011",
						"nick":     "学霸资料馆",
						"city":     "杭州",
					},
				},
			})
		case "mtop.idle.web.xyh.item.list":
			// parseFormErr 解析表单以检查请求的是有商品卖家还是空店铺卖家。
			_ = r.ParseForm()
			// rawPayload 是客户端发送的 data JSON 字符串。
			rawPayload := r.FormValue("data")
			if strings.Contains(rawPayload, `"userId":"empty_seller"`) {
				// 验证成功响应省略 cardList 时按空列表返回而非报错。
				_ = json.NewEncoder(w).Encode(map[string]any{
					"ret":  []string{"SUCCESS::调用成功"},
					"data": map[string]any{},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret": []string{"SUCCESS::调用成功"},
				"data": map[string]any{
					"totalCount": 1,
					"cardList": []any{
						map[string]any{
							"cardType": 1,
							"cardData": map[string]any{
								"title":      "PPT汇报模板合集电子版",
								"categoryId": "50023914",
								"priceInfo":  map[string]any{"price": "6.60", "preText": "¥"},
								"picInfo":    map[string]any{"picUrl": "//img.alicdn.com/bao/uploaded/i3/ppt.jpg"},
								"detailParams": map[string]any{
									"itemId":   "9900112244",
									"userNick": "学霸资料馆",
									"wantCnt":  "45",
									"isSKU":    false,
								},
							},
						},
					},
				},
			})
		default:
			t.Fatalf("unexpected api: %s", apiName)
		}
	}))
	defer server.Close()

	// client 构造绑定到本地模拟网关的 MTOP 客户端。
	client := &ClientImpl{
		MarketSearchURL:   server.URL,
		ItemDetailURL:     server.URL,
		SellerItemListURL: server.URL,
	}
	// testCookies 是带签名令牌格式的伪造测试 Cookie（不含任何真实凭证）。
	testCookies := "unb=10001; _m_h5_tk=deadbeef0123456789abcdef_1790000000000"

	// searchRes、searchErr 验证全站关键词搜索与筛选项编码。
	searchRes, searchErr := client.SearchMarketItems(context.Background(), testCookies, MarketSearchRequest{
		Keyword:     "Excel资料",
		PageNumber:  1,
		RowsPerPage: 20,
		SortField:   "create",
		SortValue:   "desc",
		MinPrice:    "1",
		MaxPrice:    "50",
		PublishDays: 7,
	})
	if searchErr != nil {
		t.Fatalf("SearchMarketItems failed: %v", searchErr)
	}
	if len(searchRes.Items) != 1 || !searchRes.HasMore {
		t.Fatalf("unexpected search result: %+v", searchRes)
	}
	// gotSearch 是首条搜索到的商品快照。
	gotSearch := searchRes.Items[0]
	if gotSearch.ItemID != "8800112233" || gotSearch.Title != "Excel函数速查电子资料全套" || gotSearch.WantCount != 236 || !gotSearch.IsFreeShipping {
		t.Fatalf("unexpected search item fields: %+v", gotSearch)
	}
	if gotSearch.PicURL != "https://img.alicdn.com/bao/uploaded/i1/cover1.jpg" {
		t.Fatalf("expected https pic url, got %q", gotSearch.PicURL)
	}

	// detailItem、_、detailErr 验证单品详情完整文案与多张图片解析。
	detailItem, _, detailErr := client.FetchMarketItemDetail(context.Background(), testCookies, "8800112233")
	if detailErr != nil {
		t.Fatalf("FetchMarketItemDetail failed: %v", detailErr)
	}
	if !detailItem.HasFullDetail || len(detailItem.ImageURLs) != 2 || detailItem.BrowseCount != 1980 {
		t.Fatalf("unexpected detail item: %+v", detailItem)
	}
	if detailItem.ImageURLs[1] != "https://img.alicdn.com/bao/uploaded/i2/detail2.png" {
		t.Fatalf("expected normalized https second image, got %q", detailItem.ImageURLs[1])
	}

	// shopRes、shopErr 验证同行店铺商品列表解析。
	shopRes, shopErr := client.FetchSellerShopPage(context.Background(), testCookies, "220011", 1, 20)
	if shopErr != nil {
		t.Fatalf("FetchSellerShopPage failed: %v", shopErr)
	}
	if len(shopRes.Items) != 1 || shopRes.Items[0].ItemID != "9900112244" || shopRes.Items[0].WantCount != 45 {
		t.Fatalf("unexpected shop result: %+v", shopRes)
	}

	// emptyShopRes、emptyShopErr 验证同行无在售商品（省略 cardList）时按空页正常返回。
	emptyShopRes, emptyShopErr := client.FetchSellerShopPage(context.Background(), testCookies, "empty_seller", 1, 20)
	if emptyShopErr != nil {
		t.Fatalf("expected empty cardList to succeed, got error: %v", emptyShopErr)
	}
	if len(emptyShopRes.Items) != 0 || emptyShopRes.HasMore {
		t.Fatalf("expected empty shop result, got %+v", emptyShopRes)
	}
}

// TestMarketCollectStopsImmediatelyOnRiskControl 验证遇到 RGV587 风控返回码时立即中止并归类为风控错误，绝不重复请求。
func TestMarketCollectStopsImmediatelyOnRiskControl(t *testing.T) {
	// calls 统计模拟网关被请求的总次数，确保遇风控只请求 1 次。
	calls := 0
	// server 模拟返回闲鱼标准 RGV587 滑块风控响应。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ret":  []string{"FAIL_SYS_USER_VALIDATE::RGV587_ERROR::SM::哎哟喂,被挤爆啦,请稍后重试"},
			"data": map[string]any{"url": "https://h5api.m.goofish.com/_____tmd_____/punish"},
		})
	}))
	defer server.Close()

	// client 构造测试客户端。
	client := &ClientImpl{MarketSearchURL: server.URL}
	// err 保存搜索返回的风控错误。
	_, err := client.SearchMarketItems(context.Background(), "unb=10001; _m_h5_tk=tok_1", MarketSearchRequest{Keyword: "测试"})
	if err == nil || !IsRiskVerificationErr(err) {
		t.Fatalf("expected risk verification error, got: %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected exactly 1 call on risk control, got %d", calls)
	}
}
