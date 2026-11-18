package server

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	collectorapp "xianyu-go/internal/application/collector"
)

// listCollectorRadarTargets 处理 `GET /api/v1/collector/radar/targets` 监控池列表查询。
func (s *Server) listCollectorRadarTargets(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// list、err 读取监控目标列表。
	list, err := s.collectorApplication().ListRadarTargets(r.Context(), userID)
	if err != nil {
		writeCollectorError(w, r, err, "读取爆品监控目标失败")
		return
	}
	// out 转换为非 nil 数组。
	out := make([]collectorRadarTargetDTO, 0, len(list))
	// item 遍历应用层监控项。
	for _, item := range list {
		out = append(out, newCollectorRadarTargetDTO(item))
	}
	writeJSON(w, http.StatusOK, collectorRadarTargetsResponse{Targets: out})
}

// addCollectorRadarTargets 处理 `POST /api/v1/collector/radar/targets` 批量添加监控词/同行或导入种子词包。
func (s *Server) addCollectorRadarTargets(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解码批量新增请求体。
	var req collectorRadarAddTargetsRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// inputs 转换请求数组。
	inputs := make([]collectorapp.RadarTargetInput, 0, len(req.Targets))
	// raw 遍历客户端提交的目标输入。
	for _, raw := range req.Targets {
		inputs = append(inputs, collectorapp.RadarTargetInput{
			TargetType:  raw.TargetType,
			RawValue:    raw.RawValue,
			Label:       raw.Label,
			PublishDays: raw.PublishDays,
		})
	}
	// created、err 保存监控项。
	created, err := s.collectorApplication().AddRadarTargets(r.Context(), userID, inputs, req.ImportVirtualSeedPack)
	if err != nil {
		writeCollectorError(w, r, err, "添加爆品监控目标失败")
		return
	}
	// out 转换为响应 DTO 数组。
	out := make([]collectorRadarTargetDTO, 0, len(created))
	// item 遍历已落库监控项。
	for _, item := range created {
		out = append(out, newCollectorRadarTargetDTO(item))
	}
	writeJSON(w, http.StatusOK, collectorRadarTargetsResponse{Targets: out})
}

// toggleCollectorRadarTarget 处理 `PATCH /api/v1/collector/radar/targets/{id}` 监控目标启停切换。
func (s *Server) toggleCollectorRadarTarget(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// targetID、parseErr 解析路径主键。
	targetID, parseErr := strconv.ParseInt(strings.TrimSpace(chi.URLParam(r, "id")), 10, 64)
	if parseErr != nil || targetID <= 0 {
		writeErrRequest(w, r, http.StatusBadRequest, "监控目标 ID 无效")
		return
	}
	// req 解码启用状态请求体。
	var req collectorRadarToggleTargetRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// err 更新目标启用状态。
	if err := s.collectorApplication().ToggleRadarTarget(r.Context(), userID, targetID, req.Enabled); err != nil {
		writeCollectorError(w, r, err, "更新监控目标状态失败")
		return
	}
	writeJSON(w, http.StatusOK, collectorRadarMutationResponse{Success: true})
}

// deleteCollectorRadarTarget 处理 `DELETE /api/v1/collector/radar/targets/{id}` 删除监控目标。
func (s *Server) deleteCollectorRadarTarget(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// targetID、parseErr 解析路径主键。
	targetID, parseErr := strconv.ParseInt(strings.TrimSpace(chi.URLParam(r, "id")), 10, 64)
	if parseErr != nil || targetID <= 0 {
		writeErrRequest(w, r, http.StatusBadRequest, "监控目标 ID 无效")
		return
	}
	// err 删除目标记录。
	if err := s.collectorApplication().DeleteRadarTarget(r.Context(), userID, targetID); err != nil {
		writeCollectorError(w, r, err, "删除监控目标失败")
		return
	}
	writeJSON(w, http.StatusOK, collectorRadarMutationResponse{Success: true})
}

// suggestCollectorRadarAIKeywords 处理 `POST /api/v1/collector/radar/ai-keywords` 当季易爆搜索热词生成。
func (s *Server) suggestCollectorRadarAIKeywords(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解析赛道描述。
	var req collectorRadarAIKeywordsRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// keywords、err 调用大模型生成搜索热词。
	keywords, err := s.collectorApplication().SuggestRadarKeywords(r.Context(), userID, req.Niche)
	if err != nil {
		writeCollectorError(w, r, err, "生成 AI 当季爆品热词失败")
		return
	}
	if keywords == nil {
		keywords = []string{}
	}
	writeJSON(w, http.StatusOK, collectorRadarAIKeywordsResponse{Keywords: keywords})
}

// startCollectorRadarScan 处理 `POST /api/v1/collector/radar/scan/start` 启动全池慢速爆品巡检。
func (s *Server) startCollectorRadarScan(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解码指定采集账号。
	var req collectorRadarStartScanRequest
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// st、err 启动后台慢速巡检。
	st, err := s.collectorApplication().StartRadarScan(r.Context(), userID, req.CookieID)
	if err != nil {
		writeCollectorError(w, r, err, "启动爆品巡检失败")
		return
	}
	writeJSON(w, http.StatusOK, newCollectorRadarScanStatusResponse(st))
}

// stopCollectorRadarScan 处理 `POST /api/v1/collector/radar/scan/stop` 手动停止正在执行的爆品巡检。
func (s *Server) stopCollectorRadarScan(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// st、err 取消运行中的巡检任务。
	st, err := s.collectorApplication().StopRadarScan(r.Context(), userID)
	if err != nil {
		writeCollectorError(w, r, err, "停止爆品巡检失败")
		return
	}
	writeJSON(w, http.StatusOK, newCollectorRadarScanStatusResponse(st))
}

// getCollectorRadarScanStatus 处理 `GET /api/v1/collector/radar/scan/status` 查询实时巡检进度与定时配置。
func (s *Server) getCollectorRadarScanStatus(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// st、err 读取当前状态。
	st, err := s.collectorApplication().GetRadarScanStatus(r.Context(), userID)
	if err != nil {
		writeCollectorError(w, r, err, "查询爆品巡检状态失败")
		return
	}
	writeJSON(w, http.StatusOK, newCollectorRadarScanStatusResponse(st))
}

// updateCollectorRadarSchedule 处理 `PUT /api/v1/collector/radar/schedule` 更新可选低频定时自动巡检配置。
func (s *Server) updateCollectorRadarSchedule(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// req 解析定时配置请求体。
	var req collectorRadarScheduleDTO
	if !decodeCollectorJSON(w, r, &req) {
		return
	}
	// saved、err 校验并保存定时设置。
	saved, err := s.collectorApplication().UpdateRadarSchedule(r.Context(), userID, collectorapp.RadarScheduleConfig{
		Enabled:       req.Enabled,
		CookieID:      req.CookieID,
		IntervalHours: req.IntervalHours,
	})
	if err != nil {
		writeCollectorError(w, r, err, "保存定时巡检设置失败")
		return
	}
	writeJSON(w, http.StatusOK, collectorRadarScheduleDTO{
		Enabled:         saved.Enabled,
		CookieID:        saved.CookieID,
		IntervalHours:   saved.IntervalHours,
		LastAutoRunUnix: saved.LastAutoRunUnix,
	})
}

// listCollectorRadarItems 处理 `GET /api/v1/collector/radar/items` 查询黑马爆品快照榜单。
func (s *Server) listCollectorRadarItems(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// q 读取 URL 查询参数。
	q := r.URL.Query()
	// minWant、_ 解析最低想要人数参数。
	minWant, _ := strconv.Atoi(q.Get("min_want_count"))
	// minDelta、_ 解析最低新增 Δ想要参数。
	minDelta, _ := strconv.Atoi(q.Get("min_delta_want"))
	// maxAge、_ 解析最大上架小时数参数。
	maxAge, _ := strconv.Atoi(q.Get("max_age_hours"))
	// limit、_ 解析返回上限参数。
	limit, _ := strconv.Atoi(q.Get("limit"))

	// rows、err 执行榜单查询。
	rows, err := s.collectorApplication().ListRadarItems(r.Context(), userID, collectorapp.RadarListQuery{
		SortBy:       strings.TrimSpace(q.Get("sort_by")),
		SourceType:   strings.TrimSpace(q.Get("source_type")),
		MinWantCount: minWant,
		MinDeltaWant: minDelta,
		MaxAgeHours:  maxAge,
		Limit:        limit,
	})
	if err != nil {
		writeCollectorError(w, r, err, "查询黑马爆品列表失败")
		return
	}
	// out 转换为非 nil DTO 数组。
	out := make([]collectorRadarItemDTO, 0, len(rows))
	// item 遍历快照行。
	for _, item := range rows {
		out = append(out, newCollectorRadarItemDTO(item))
	}
	writeJSON(w, http.StatusOK, collectorRadarItemsResponse{Items: out})
}

// clearCollectorRadarItems 处理 `DELETE /api/v1/collector/radar/items` 清空历史爆品快照。
func (s *Server) clearCollectorRadarItems(w http.ResponseWriter, r *http.Request) {
	// userID、ok 获取当前登录用户标识。
	userID, ok := defaultReplyUserID(w, r)
	if !ok {
		return
	}
	// err 清空历史快照。
	if err := s.collectorApplication().ClearRadarItems(r.Context(), userID); err != nil {
		writeCollectorError(w, r, err, "清空爆品记录失败")
		return
	}
	writeJSON(w, http.StatusOK, collectorRadarMutationResponse{Success: true})
}
