package server

import (
	"github.com/go-chi/chi/v5"

	"xianyu-go/internal/auth"
)

// mountVersionedCollectorRoutes 挂载全站商品采集、AI 改写与批量转存模板的 `/api/v1/collector` 路由组。
func (s *Server) mountVersionedCollectorRoutes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(s.Auth.Middleware)
		r.Use(auth.RequireAuth)

		r.Post("/api/v1/collector/search", s.searchMarketItems)
		r.Post("/api/v1/collector/item-detail", s.collectMarketItemDetails)
		r.Post("/api/v1/collector/seller-items", s.collectSellerShopItems)
		r.Post("/api/v1/collector/ai-rewrite", s.rewriteCollectedItemWithAI)
		r.Post("/api/v1/collector/save-templates", s.saveCollectedItemsToTemplates)
		r.Post("/api/v1/collector/manual-verify/open", s.openCollectorManualVerify)
		r.Post("/api/v1/collector/manual-verify/complete", s.completeCollectorManualVerify)
		r.Post("/api/v1/collector/manual-verify/cancel", s.cancelCollectorManualVerify)

		r.Get("/api/v1/collector/radar/targets", s.listCollectorRadarTargets)
		r.Post("/api/v1/collector/radar/targets", s.addCollectorRadarTargets)
		r.Patch("/api/v1/collector/radar/targets/{id}", s.toggleCollectorRadarTarget)
		r.Delete("/api/v1/collector/radar/targets/{id}", s.deleteCollectorRadarTarget)
		r.Post("/api/v1/collector/radar/ai-keywords", s.suggestCollectorRadarAIKeywords)
		r.Post("/api/v1/collector/radar/scan/start", s.startCollectorRadarScan)
		r.Post("/api/v1/collector/radar/scan/stop", s.stopCollectorRadarScan)
		r.Get("/api/v1/collector/radar/scan/status", s.getCollectorRadarScanStatus)
		r.Put("/api/v1/collector/radar/schedule", s.updateCollectorRadarSchedule)
		r.Get("/api/v1/collector/radar/items", s.listCollectorRadarItems)
		r.Delete("/api/v1/collector/radar/items", s.clearCollectorRadarItems)
	})
}
