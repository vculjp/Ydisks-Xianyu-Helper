package collector

import (
	"math"
)

// DefaultVirtualGoodsSeedKeywords 提供面向虚拟资源/电子资料卖家的精选高转化种子监控词包。
func DefaultVirtualGoodsSeedKeywords() []RadarTargetInput {
	return []RadarTargetInput{
		{TargetType: "keyword", RawValue: "Excel表格模板", Label: "办公表格模板", PublishDays: 3},
		{TargetType: "keyword", RawValue: "简历模板", Label: "求职简历模板", PublishDays: 3},
		{TargetType: "keyword", RawValue: "PPT模板", Label: "汇报述职PPT", PublishDays: 3},
		{TargetType: "keyword", RawValue: "AI教程资料", Label: "AI实操教程", PublishDays: 3},
		{TargetType: "keyword", RawValue: "考公笔记资料", Label: "考公备考资料", PublishDays: 3},
		{TargetType: "keyword", RawValue: "教资面试资料", Label: "教师资格资料", PublishDays: 3},
		{TargetType: "keyword", RawValue: "合同协议模板", Label: "商用合同模板", PublishDays: 7},
		{TargetType: "keyword", RawValue: "副业项目SOP", Label: "实操经验手册", PublishDays: 3},
	}
}

// buildUpdatedRadarSnapshot 结合商品当前数据、目标新发窗口与历史快照计算 Δ想要增量、日均飙升速率与黑马综合得分。
func buildUpdatedRadarSnapshot(
	nowUnix int64,
	target RadarWatchTarget,
	item CollectedItem,
	existing RadarItemSnapshot,
	hasExisting bool,
) RadarItemSnapshot {
	// targetHadBaseline 判断该监控目标此前是否已经完成过至少一轮基线扫描。
	targetHadBaseline := target.LastScannedAt > 0
	// pubUnix 优先采用卡片真实发布时间戳，次选历史已记录发布时间，最后按新发过滤窗口保守估算。
	pubUnix := item.PublishTimeUnix
	if pubUnix <= 0 && hasExisting && existing.PublishTimeUnix > 0 {
		pubUnix = existing.PublishTimeUnix
	}
	if pubUnix <= 0 && target.TargetType == "keyword" && target.PublishDays > 0 {
		// 若限定了近 N 天新发但卡片未带精确秒数，按窗口 75% 时长保守估算上架时刻，防止夸大增速。
		pubUnix = nowUnix - int64(target.PublishDays)*18*3600
	}

	// firstSeenAt、firstWant 维护首次观测基准。
	firstSeenAt := nowUnix
	// firstWant 记录首次观测到的想要人数。
	firstWant := item.WantCount
	// prevSeenAt、prevWant、deltaWant、scanCount 计算本轮对比上轮的变化量。
	prevSeenAt := nowUnix
	// prevWant 记录对比基准想要数。
	prevWant := item.WantCount
	// deltaWant 保存较上轮真实新增的想要人数。
	deltaWant := 0
	// scanCount 记录累计命中轮数。
	scanCount := 1

	if hasExisting {
		firstSeenAt = existing.FirstSeenAt
		firstWant = existing.FirstWantCount
		scanCount = existing.ScanCount + 1
		// 间隔不足 60 秒的同轮重复命中（例如两个监控词同时扫到同一爆品）累加而不清零已算出的增量。
		if nowUnix-existing.LatestSeenAt < 60 {
			prevSeenAt = existing.PrevSeenAt
			prevWant = existing.PrevWantCount
			// diff 是同轮内可能刚涨的微增。
			diff := item.WantCount - existing.LatestWantCount
			if diff > 0 {
				deltaWant = existing.DeltaWant + diff
			} else {
				deltaWant = existing.DeltaWant
			}
		} else {
			prevSeenAt = existing.LatestSeenAt
			prevWant = existing.LatestWantCount
			if item.WantCount > existing.LatestWantCount {
				deltaWant = item.WantCount - existing.LatestWantCount
			}
		}
	} else if targetHadBaseline && item.WantCount > 0 {
		// 对已经建立过基线的同行店铺或新发词池，本轮新冒出来且已有想要的商品直接计为新上榜起量增量。
		prevWant = 0
		deltaWant = item.WantCount
	}

	// ageHours 估算商品已上架小时数（保底按 2 小时计算以避免刚发几分钟出现极端除零高分）。
	ageHours := 72.0
	if pubUnix > 0 && nowUnix > pubUnix {
		ageHours = math.Max(float64(nowUnix-pubUnix)/3600.0, 2.0)
	} else if hasExisting && nowUnix > firstSeenAt {
		ageHours = math.Max(float64(nowUnix-firstSeenAt)/3600.0, 6.0)
	}
	// dailyVelocity 计算日均想要人数（想要/天）。
	dailyVelocity := float64(item.WantCount) / (ageHours / 24.0)
	// velocityX100 转为保留两位小数的定点整数。
	velocityX100 := int(math.Round(dailyVelocity * 100.0))

	// cappedWant 限制历史总想要基数权重上限，防止挂了一年的老链接仅靠存量霸榜。
	cappedWant := item.WantCount
	if cappedWant > 200 {
		cappedWant = 200
	}
	// freshnessBonus 为 24 小时与 72 小时内的新发商品提供新鲜度加分。
	freshnessBonus := 0
	if pubUnix > 0 {
		if ageHours <= 24 {
			freshnessBonus = 90
		} else if ageHours <= 72 {
			freshnessBonus = 45
		}
	}
	// viralScore 综合：Δ想要增量权重最高（×18） + 日均飙升速率（×0.35） + 基础想要验证（×2） + 新发加权。
	viralScore := deltaWant*18 + (velocityX100*35)/100 + cappedWant*2 + freshnessBonus

	// sourceLabel 记录可读来源名称。
	sourceLabel := target.Label
	if sourceLabel == "" {
		sourceLabel = target.TargetValue
	}

	return RadarItemSnapshot{
		ItemID:            item.ItemID,
		Title:             item.Title,
		Price:             item.Price,
		OriginalPrice:     item.OriginalPrice,
		PicURL:            item.PicURL,
		Area:              item.Area,
		SellerID:          item.SellerID,
		SellerNick:        item.SellerNick,
		IsFreeShipping:    item.IsFreeShipping,
		SourceType:        target.TargetType,
		SourceLabel:       sourceLabel,
		PublishTimeUnix:   pubUnix,
		FirstSeenAt:       firstSeenAt,
		FirstWantCount:    firstWant,
		PrevSeenAt:        prevSeenAt,
		PrevWantCount:     prevWant,
		LatestSeenAt:      nowUnix,
		LatestWantCount:   item.WantCount,
		DeltaWant:         deltaWant,
		DailyVelocityX100: velocityX100,
		DailyVelocity:     float64(velocityX100) / 100.0,
		ViralScore:        viralScore,
		ScanCount:         scanCount,
		WebURL:            "https://www.goofish.com/item?id=" + item.ItemID,
	}
}
