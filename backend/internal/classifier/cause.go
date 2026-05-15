package classifier

import (
	"fmt"
	"strings"

	"sellerpulse/internal/models"
	"sellerpulse/internal/scorer"
)

var platformIssues = map[string]bool{
	"BL filters not working":  true,
	"Catalog edits rejected":  true,
	"PNS routing":             true,
	"Drop in enquiries":       true,
	"Lead quality dropped":    true,
}

func hasCompetitor(insights []models.CallInsight) (bool, string) {
	for _, c := range insights {
		if c.CompetitorMentioned != "" {
			return true, c.CompetitorMentioned
		}
	}
	return false, ""
}

func hasPlatformIssue(insights []models.CallInsight) bool {
	for _, c := range insights {
		for _, issue := range c.Issues {
			if platformIssues[issue] {
				return true
			}
		}
	}
	return false
}

func latestVal(h []models.MetricHistory) float64 {
	if len(h) == 0 {
		return 0
	}
	return h[len(h)-1].Value
}

func dropVal(h []models.MetricHistory) float64 {
	if len(h) < 2 {
		return 0
	}
	return h[0].Value - h[len(h)-1].Value
}

// ChurnCause returns the classified cause for the seller's churn risk.
func ChurnCause(s models.RawSeller) string {
	m := s.Metrics
	withComp, _  := hasCompetitor(s.CallInsights)
	withPlat     := hasPlatformIssue(s.CallInsights)
	highRetail   := latestVal(m.RetailBlRecommendedPct) > 52
	allDecline   := dropVal(m.LoginPct) > 10 && dropVal(m.BlConsumptionPct) > 10 && dropVal(m.PnsPickupRatePct) > 8

	switch {
	case withComp && !withPlat && !highRetail:
		return "EXTERNAL"
	case (withPlat || highRetail) && !withComp && !allDecline:
		return "PLATFORM_FAILURE"
	case allDecline && !withComp && !withPlat && !highRetail:
		return "BEHAVIORAL"
	default:
		return "MIXED"
	}
}

// ChurnCauseReason builds the one-line explanation shown in the UI.
func ChurnCauseReason(s models.RawSeller, cause string) string {
	m := s.Metrics
	switch cause {
	case "BEHAVIORAL":
		return fmt.Sprintf(
			"Login −%.0f%%, BL −%.0f%%, PNS −%.0f%% over 3 months — disengagement pattern, no platform trigger",
			dropVal(m.LoginPct), dropVal(m.BlConsumptionPct), dropVal(m.PnsPickupRatePct),
		)
	case "PLATFORM_FAILURE":
		if latestVal(m.RetailBlRecommendedPct) > 52 {
			return fmt.Sprintf("%.0f%% of recommended BLs are retail — BL filter mismatch likely a platform config issue", latestVal(m.RetailBlRecommendedPct))
		}
		return "Seller reported platform issues (BL filters / PNS routing / catalog edits) on calls — escalate to Product"
	case "EXTERNAL":
		_, comp := hasCompetitor(s.CallInsights)
		if comp != "" {
			return fmt.Sprintf("Competitor \"%s\" mentioned on call — pricing or feature comparison driving exit risk", comp)
		}
		return "Competitor pricing offer mentioned — external pressure driving exit risk"
	case "MIXED":
		if latestVal(m.RetailBlRecommendedPct) > 52 {
			return "Combination of behavioural decline and lead-fit mismatch — requires Sales Manager coordination"
		}
		return "Combination of behavioural decline and call-based complaints — requires Sales Manager coordination"
	}
	return ""
}

// Archetype classifies the seller into one of 6 behavioural archetypes.
func Archetype(s models.RawSeller) string {
	m := s.Metrics
	withComp, _  := hasCompetitor(s.CallInsights)
	withPlat     := hasPlatformIssue(s.CallInsights)
	isScaffold   := strings.Contains(s.Category, "Scaffold") || strings.Contains(s.Category, "Construction")

	if latestVal(m.LoginPct) > 78 && latestVal(m.BlConsumptionPct) > 60 {
		return "Healthy"
	}
	if s.PriorChurn && latestVal(m.CatalogScore) < 50 {
		return "Overwhelmed Starter"
	}
	if withComp {
		return "Competitor Target"
	}
	if withPlat || latestVal(m.RetailBlRecommendedPct) > 52 {
		return "Platform Victim"
	}
	if isScaffold {
		return "Seasonal Dip"
	}
	return "ROI Doubter"
}

// RiskBand re-exports from scorer for convenience.
var RiskBand = scorer.RiskBand
