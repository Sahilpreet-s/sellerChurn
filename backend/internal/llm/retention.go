package llm

import (
	"encoding/json"
	"fmt"
	"strings"

	"sellerpulse/internal/models"
)

type GuideSection struct {
	Title   string   `json:"title"`
	Pitch   string   `json:"pitch"`
	Actions []string `json:"actions"`
}

const retentionSystem = `You are an expert Key Account Manager trainer at IndiaMART, India's largest B2B marketplace.
Your job: write a personalized retention call guide for an exec who will speak to the seller TODAY.

Rules:
- Reference the seller's EXACT metric numbers in the pitch, never generic percentages.
- Each section must have a clear opening pitch the exec can read aloud, and 3 concrete actions.
- If a competitor was mentioned, address it directly in the relevant section.
- If historical playbook data is provided, let it shape your recommendations — reference what has worked before.
- Output ONLY valid JSON: an array of objects with keys "title" (string), "pitch" (string), "actions" (string[]).
- 3–5 sections maximum.`

// RetentionGuide generates a personalized retention call guide via Gemini.
// playbook is optional — if non-nil, historical learnings are injected into the prompt.
func RetentionGuide(s models.Seller, playbook *models.PlaybookEntry) ([]GuideSection, error) {
	user := buildRetentionPrompt(s, playbook)
	raw, err := Call(retentionSystem, user, 4096)
	if err != nil {
		return nil, err
	}

	var sections []GuideSection
	if err := json.Unmarshal([]byte(raw), &sections); err != nil {
		return nil, fmt.Errorf("parse guide JSON: %w — raw: %s", err, raw)
	}
	return sections, nil
}

func buildRetentionPrompt(s models.Seller, playbook *models.PlaybookEntry) string {
	m := s.Metrics

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("SELLER: %s | %s | %s | %s package | ARR ₹%dk\n", s.Name, s.Company, s.City, s.PackageType, s.ARR/1000))
	sb.WriteString(fmt.Sprintf("CATEGORY: %s | ARCHETYPE: %s | CHURN CAUSE: %s\n", s.Category, s.Archetype, s.ChurnCause))
	sb.WriteString(fmt.Sprintf("RENEWAL: %d days | RISK SCORE: %d/100\n", s.DaysToRenewal, s.RiskScore))
	if s.PriorChurn {
		sb.WriteString("⚠ PRIOR CHURN: This seller was previously on Free/lapsed plan. Re-churn risk is 2.3× base rate.\n")
	}
	sb.WriteString("\nSIGNAL SNAPSHOT (last → 3-month drop):\n")
	sb.WriteString(fmt.Sprintf("  Login %%:       %.0f%%  (drop: %.0f%%)\n", latestF(m.LoginPct), dropF(m.LoginPct)))
	sb.WriteString(fmt.Sprintf("  BL Consumption: %.0f%%  (drop: %.0f%%)\n", latestF(m.BlConsumptionPct), dropF(m.BlConsumptionPct)))
	sb.WriteString(fmt.Sprintf("  PNS Pickup:    %.0f%%  (drop: %.0f%%)\n", latestF(m.PnsPickupRatePct), dropF(m.PnsPickupRatePct)))
	sb.WriteString(fmt.Sprintf("  LMS Reply:     %.0f%%  (drop: %.0f%%)\n", latestF(m.LmsReplyRatePct), dropF(m.LmsReplyRatePct)))
	sb.WriteString(fmt.Sprintf("  Retail BL %%:   %.0f%%  (high = poor lead fit)\n", latestF(m.RetailBlRecommendedPct)))
	sb.WriteString(fmt.Sprintf("  Catalog Score: %.0f\n", latestF(m.CatalogScore)))
	sb.WriteString(fmt.Sprintf("  Content QS:    %.0f\n", latestF(m.Cqs)))

	if len(s.CallInsights) > 0 {
		sb.WriteString("\nCALL HISTORY:\n")
		for _, c := range s.CallInsights {
			sb.WriteString(fmt.Sprintf("  [%s] %s — %s (%s)\n", c.Date, c.Sentiment, c.Summary, c.Disposition))
			if c.CompetitorMentioned != "" {
				sb.WriteString(fmt.Sprintf("    ⚠ Competitor mentioned: %s\n", c.CompetitorMentioned))
			}
			if c.Quote != "" {
				sb.WriteString(fmt.Sprintf("    Quote: \"%s\"\n", c.Quote))
			}
			if c.CommitmentByExec != "" {
				sb.WriteString(fmt.Sprintf("    Exec committed: %s\n", c.CommitmentByExec))
			}
		}
	}

	// Inject historical playbook learnings when available
	if playbook != nil && playbook.SampleSize >= 3 {
		sb.WriteString(fmt.Sprintf("\nHISTORICAL PLAYBOOK — %d similar %s cases (%.0f%% retention rate):\n",
			playbook.SampleSize, playbook.Archetype, playbook.RetentionRate*100))
		sb.WriteString(fmt.Sprintf("  KEY INSIGHT: %s\n", playbook.KeyInsight))
		if len(playbook.WinningApproaches) > 0 {
			sb.WriteString("  WHAT WORKS FOR THIS ARCHETYPE:\n")
			for _, a := range playbook.WinningApproaches {
				sb.WriteString(fmt.Sprintf("    ✓ %s\n", a))
			}
		}
		if len(playbook.DoNotDo) > 0 {
			sb.WriteString("  DO NOT DO:\n")
			for _, d := range playbook.DoNotDo {
				sb.WriteString(fmt.Sprintf("    ✗ %s\n", d))
			}
		}
	}

	sb.WriteString("\nGenerate the retention guide JSON now.")
	return sb.String()
}

func latestF(h []models.MetricHistory) float64 {
	if len(h) == 0 {
		return 0
	}
	return h[len(h)-1].Value
}

func dropF(h []models.MetricHistory) float64 {
	if len(h) < 2 {
		return 0
	}
	d := h[0].Value - h[len(h)-1].Value
	if d < 0 {
		return 0
	}
	return d
}
