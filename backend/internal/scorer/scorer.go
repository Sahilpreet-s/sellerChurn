package scorer

import (
	"math"
	"strings"

	"sellerpulse/internal/models"
)

func latest(h []models.MetricHistory) float64 {
	if len(h) == 0 {
		return 0
	}
	return h[len(h)-1].Value
}

func trendDrop(h []models.MetricHistory) float64 {
	if len(h) < 2 {
		return 0
	}
	return h[0].Value - h[len(h)-1].Value
}

func maxZ(v float64) float64 {
	if v < 0 {
		return 0
	}
	return v
}

// CalcRisk mirrors the TypeScript calcRisk formula exactly.
func CalcRisk(s models.RawSeller) int {
	m := s.Metrics
	loginRisk   := (100 - latest(m.LoginPct))               * 0.15 + maxZ(trendDrop(m.LoginPct))               * 0.35
	blRisk      := (100 - latest(m.BlConsumptionPct))       * 0.15 + maxZ(trendDrop(m.BlConsumptionPct))       * 0.35
	pnsRisk     := (100 - latest(m.PnsPickupRatePct))       * 0.12 + maxZ(trendDrop(m.PnsPickupRatePct))       * 0.30
	lmsRisk     := (100 - latest(m.LmsReplyRatePct))        * 0.12 + maxZ(trendDrop(m.LmsReplyRatePct))        * 0.30
	retailRisk  := latest(m.RetailBlRecommendedPct)         * 0.12
	catalogRisk := (100 - latest(m.CatalogScore))           * 0.06
	cqsRisk     := (100 - latest(m.Cqs))                   * 0.08

	score := math.Min(92, math.Round(loginRisk+blRisk+pnsRisk+lmsRisk+retailRisk+catalogRisk+cqsRisk))

	if s.PriorChurn {
		score = math.Min(92, math.Round(score*1.30))
	}

	// Seasonality dampener for scaffolding/construction
	if len(m.LoginPct) > 0 {
		lastMonth := m.LoginPct[len(m.LoginPct)-1].Month
		isConstruction := strings.Contains(s.Category, "Scaffold") || strings.Contains(s.Category, "Construction")
		isSeason := lastMonth == "Mar" || lastMonth == "Apr" || lastMonth == "May"
		if isConstruction && isSeason {
			score = math.Min(92, math.Round(score*0.85))
		}
	}

	return int(score)
}

// IsInactiveSeller returns true when all three primary engagement signals are at or near zero.
// These sellers are Tier 1 — flagged directly at riskScore=95 without running XGBoost or LLM.
func IsInactiveSeller(s models.RawSeller) bool {
	return latest(s.Metrics.LoginPct) <= 5 &&
		latest(s.Metrics.BlConsumptionPct) <= 5 &&
		latest(s.Metrics.PnsPickupRatePct) <= 5
}

// RiskBand returns the display band for a score.
func RiskBand(score int) string {
	if score >= 55 {
		return "High"
	}
	if score >= 30 {
		return "Medium"
	}
	return "Low"
}
