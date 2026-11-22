package adapter

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	itemapp "xianyu-go/internal/application/items"
	"xianyu-go/internal/xianyu/mtop"
)

// itemMetricsTransport 是同步集成测试的内存传输，不建立任何真实平台或外部网络连接。
type itemMetricsTransport struct {
	// payload 是当前一轮应返回的单页商品列表 JSON。
	payload string
	// calls 记录列表请求数；测试按顺序调用客户端，无并发访问。
	calls int
}

// RoundTrip 仅响应 request 的商品列表路径，返回预置响应或拒绝任何详情/额外平台 API。
func (transport *itemMetricsTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	transport.calls++
	if request.URL.Path != "/h5/mtop.idle.web.xyh.item.list/1.0/" {
		return nil, fmt.Errorf("商品同步不允许额外请求: %s", request.URL.Path)
	}
	return &http.Response{
		StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}},
		Body: io.NopCloser(strings.NewReader(transport.payload)), Request: request,
	}, nil
}

// TestItemMetricsSurviveListSync 验证真实 MTOP 解析、全量/分页同步、SQLite 持久化及商品读取的统计链路；t 仅使用虚构账号。
func TestItemMetricsSurviveListSync(t *testing.T) {
	// mode 选择已有全量或分页同步入口，两条入口均不得扇出统计请求。
	for _, mode := range []string{"all", "page"} {
		t.Run(mode, func(t *testing.T) {
			// store、cleanup 管理本轮独立 SQLite 和关闭责任。
			store, cleanup := newAdapterTestStore(t)
			defer cleanup()
			// ctx 是本测试顺序执行同步和读取的上下文。
			ctx := context.Background()
			// owner、ownerErr 从隔离账号读取所有者，不读取或输出平台凭证。
			owner, ownerErr := store.Users.GetByUsername(ctx, "admin")
			if ownerErr != nil {
				t.Fatal(ownerErr)
			}
			// transport 截获每一次 MTOP 出站并以内存夹具响应。
			transport := &itemMetricsTransport{}
			// client 执行真实协议解析，仅传输边界被替换。
			client := &mtop.ClientImpl{HTTPClient: &http.Client{Transport: transport}}
			// repository 复用生产同步写库路径；客户端工厂只返回本测试的内存客户端。
			repository := NewItemSyncRepository(store, func() mtop.Client { return client }, nil, nil, nil)
			// catalog 通过生产商品读取接口检验持久化结果，不依赖 SQL 行内部表示。
			catalog := NewItemCatalogRepository(store)
			// phase 依次返回有统计与无统计的同一商品，验证普通同步不会清空最近一次已读取统计。
			for phase := 0; phase < 2; phase++ {
				transport.payload = `{"ret":["SUCCESS::调用成功"],"data":{"pageCount":1,"cardList":[{"cardData":{"id":"metrics","exposureCount":125,"browseCount":0,"wantNum":7}}]}}`
				if phase == 1 {
					transport.payload = `{"ret":["SUCCESS::调用成功"],"data":{"pageCount":1,"cardList":[{"cardData":{"id":"metrics","itemStatus":0}}]}}`
				}
				// query 限制本轮只有一页，未知统计不会驱动补全请求。
				query := itemapp.SyncQuery{UserID: owner.ID, CookieID: "cid", PageNumber: 1, PageSize: 20, MaxPages: 1}
				// syncErr 保存当前生产同步入口的错误。
				var syncErr error
				if mode == "all" {
					_, syncErr = repository.SyncAll(ctx, query)
				} else {
					_, syncErr = repository.SyncPage(ctx, query)
				}
				if syncErr != nil {
					t.Fatal(syncErr)
				}
				// item、readErr 是从数据库重新读出的完整商品缓存及读取错误。
				item, readErr := catalog.Get(ctx, "cid", "metrics")
				if readErr != nil {
					t.Fatal(readErr)
				}
				// metrics 是应用层从已持久化详情派生的三项统计。
				metrics := itemapp.MetricsFromDetail(item.ItemDetail)
				if phase == 0 {
					if metrics.ExposureCount == nil || *metrics.ExposureCount != 125 || metrics.BrowseCount == nil || *metrics.BrowseCount != 0 || metrics.WantCount == nil || *metrics.WantCount != 7 {
						t.Fatal("同步后没有保留精确统计及真实零值")
					}
				} else if metrics.ExposureCount == nil || *metrics.ExposureCount != 125 || metrics.BrowseCount == nil || *metrics.BrowseCount != 0 || metrics.WantCount == nil || *metrics.WantCount != 7 {
					t.Fatal("普通列表同步清空了最近一次已读取统计")
				}
				if transport.calls != phase+1 {
					t.Fatalf("单页同步出现额外平台调用: %d", transport.calls)
				}
			}
		})
	}
}
