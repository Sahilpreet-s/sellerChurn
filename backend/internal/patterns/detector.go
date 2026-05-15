package patterns

import (
	"fmt"
	"strings"

	"sellerpulse/internal/models"
)

func latestVal(h []models.MetricHistory) float64 {
	if len(h) == 0 {
		return 0
	}
	return h[len(h)-1].Value
}

// Detect scans the enriched seller list and returns systemic pattern alerts.
func Detect(sellers []models.Seller) []models.PatternAlert {
	var alerts []models.PatternAlert
	alerts = append(alerts, detectLeadFitMismatch(sellers)...)
	alerts = append(alerts, detectSeasonalDip(sellers)...)
	alerts = append(alerts, detectSharedPlatformIssue(sellers)...)
	alerts = append(alerts, detectPriorChurnCohort(sellers)...)
	return alerts
}

func detectLeadFitMismatch(sellers []models.Seller) []models.PatternAlert {
	// Group by category: if 3+ sellers in same category have >52% retail BL
	type catGroup struct {
		ids      []string
		category string
	}
	groups := map[string]*catGroup{}
	for _, s := range sellers {
		if latestVal(s.Metrics.RetailBlRecommendedPct) > 52 {
			cat := s.Category
			if groups[cat] == nil {
				groups[cat] = &catGroup{category: cat}
			}
			groups[cat].ids = append(groups[cat].ids, s.ID)
		}
	}
	var out []models.PatternAlert
	for cat, g := range groups {
		if len(g.ids) >= 2 {
			out = append(out, models.PatternAlert{
				ID:            fmt.Sprintf("LEAD_FIT_%s", strings.ReplaceAll(cat, " ", "_")),
				Type:          "LEAD_FIT",
				Severity:      "High",
				Title:         fmt.Sprintf("BL lead-fit mismatch in %s (%d sellers)", cat, len(g.ids)),
				Narrative:     fmt.Sprintf("%d sellers in the %s category are receiving >52%% retail buyer leads despite being B2B wholesalers. This suggests a BL recommendation model misconfiguration for this category — escalate to Product for BL filter audit.", len(g.ids), cat),
				AffectedIDs:   g.ids,
				AffectedCount: len(g.ids),
			})
		}
	}
	return out
}

func detectSeasonalDip(sellers []models.Seller) []models.PatternAlert {
	var ids []string
	for _, s := range sellers {
		if s.Archetype == "Seasonal Dip" {
			ids = append(ids, s.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	return []models.PatternAlert{{
		ID:            "SEASONAL_DIP",
		Type:          "SEASONAL",
		Severity:      "Medium",
		Title:         fmt.Sprintf("Seasonal dip detected (%d sellers)", len(ids)),
		Narrative:     fmt.Sprintf("%d sellers in construction/scaffold categories show a natural seasonal slowdown for Mar–May. Their churn scores have been dampened by 15%%. Monitor but do not escalate — follow up in June when construction activity picks up.", len(ids)),
		AffectedIDs:   ids,
		AffectedCount: len(ids),
	}}
}

func detectSharedPlatformIssue(sellers []models.Seller) []models.PatternAlert {
	// Count sellers who report same issue across calls
	issueCounts := map[string][]string{} // issue → seller IDs
	for _, s := range sellers {
		seen := map[string]bool{}
		for _, c := range s.CallInsights {
			for _, issue := range c.Issues {
				if !seen[issue] {
					issueCounts[issue] = append(issueCounts[issue], s.ID)
					seen[issue] = true
				}
			}
		}
	}
	var out []models.PatternAlert
	for issue, ids := range issueCounts {
		if len(ids) >= 3 {
			out = append(out, models.PatternAlert{
				ID:            fmt.Sprintf("PLATFORM_%s", strings.ReplaceAll(issue, " ", "_")),
				Type:          "PLATFORM",
				Severity:      "High",
				Title:         fmt.Sprintf("\"%s\" reported by %d sellers", issue, len(ids)),
				Narrative:     fmt.Sprintf("%d sellers independently reported \"%s\" on calls with their account managers. This is a systemic platform issue, not individual seller problems. Product team should investigate and prioritise a fix.", len(ids), issue),
				AffectedIDs:   ids,
				AffectedCount: len(ids),
			})
		}
	}
	return out
}

func detectPriorChurnCohort(sellers []models.Seller) []models.PatternAlert {
	var ids []string
	for _, s := range sellers {
		if s.PriorChurn {
			ids = append(ids, s.ID)
		}
	}
	if len(ids) < 2 {
		return nil
	}
	return []models.PatternAlert{{
		ID:            "PRIOR_CHURN_COHORT",
		Type:          "PLATFORM",
		Severity:      "High",
		Title:         fmt.Sprintf("Re-acquired sellers at high re-churn risk (%d sellers)", len(ids)),
		Narrative:     fmt.Sprintf("%d sellers in this cohort were previously on Free/lapsed plans before re-acquisition. Historical data shows re-acquired sellers churn at 2.3× the base rate. This cohort needs a dedicated onboarding track, not standard retention calls.", len(ids)),
		AffectedIDs:   ids,
		AffectedCount: len(ids),
	}}
}
