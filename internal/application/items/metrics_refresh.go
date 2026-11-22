package items

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

// RemoteItemRefreshMetricsAction 仅代表用户显式刷新当前一件商品，不允许从列表、定时器或批量循环触发。
const RemoteItemRefreshMetricsAction RemoteItemAction = "refresh_metrics"

// MetricRefreshPlatform 是单件详情统计读取端口；一次调用只接收一个商品，不查询账号全集或补发曝光接口。
type MetricRefreshPlatform interface {
	// FetchMetrics 按 ctx 取消当前 userID、cookieID、itemID 的详情查询，返回精确统计或平台错误。
	FetchMetrics(ctx context.Context, userID int64, cookieID, itemID string) (Metrics, error)
}

// refreshedMetricsDetail 验证 current 缓存后为 input 读取一件详情，并返回只更新统计的 JSON；任何失败均不写缓存、不自动重试。
func (service *RemoteItemService) refreshedMetricsDetail(ctx context.Context, current CatalogItem, input RemoteItemInput) (string, error) {
	if /* contextErr 表示调用方已取消或超时的上下文错误。 */ contextErr := ctx.Err(); contextErr != nil {
		return "", contextErr
	}
	// detail 是待保留的本地扩展字段，验证失败时必须在访问平台前结束。
	var detail map[string]json.RawMessage
	// rawDetail 是原有缓存文本；历史空串按空对象处理，但格式损坏必须在访问平台前失败。
	rawDetail := strings.TrimSpace(current.ItemDetail)
	if rawDetail == "" {
		rawDetail = "{}"
	}
	if /* decodeErr 是原有商品缓存的格式错误。 */ decodeErr := json.Unmarshal([]byte(rawDetail), &detail); decodeErr != nil || detail == nil {
		return "", errors.New("本地商品扩展信息损坏，请先修复后再刷新指标")
	}
	// platform、supported 是已有平台适配器提供的可选单件统计能力；不改变原编辑、上下架接口。
	platform, supported := service.platform.(MetricRefreshPlatform)
	if !supported {
		return "", errors.New("当前客户端不支持单件商品指标读取")
	}
	// metrics、fetchErr 只来自当前商品的一次详情查询，不增加循环、重试或其他指标接口。
	metrics, fetchErr := platform.FetchMetrics(ctx, input.UserID, input.CookieID, input.ItemID)
	if fetchErr != nil {
		return "", fetchErr
	}
	// 本次详情成功但缺少某项时写入 null，明确表示“最新详情未提供”，不能回退到旧标签伪造当前值。
	detail["browse_count"] = cachedMetricJSON(metrics.BrowseCount)
	// want_count 同样保留明确零与未知差异，并覆盖旧缓存标签来源。
	detail["want_count"] = cachedMetricJSON(metrics.WantCount)
	// encoded、encodeErr 是保留原字段的局部更新 JSON 及编码错误，不输出原始详情。
	encoded, encodeErr := json.Marshal(detail)
	return string(encoded), encodeErr
}

// cachedMetricJSON 将一次成功详情读取的指标写入独立 JSON 值；nil 写 null 以明确未知，不做中间字符串拼接。
func cachedMetricJSON(value *int64) json.RawMessage {
	if value == nil {
		return json.RawMessage("null")
	}
	return json.RawMessage(strconv.FormatInt(*value, 10))
}
