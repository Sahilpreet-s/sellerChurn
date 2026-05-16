package llm

import (
	"encoding/json"
	"fmt"
	"strings"

	"sellerpulse/internal/models"
)

// FullAnalysisResult is the single LLM response that classifies cause, archetype,
// and generates the retention guide in one Gemini call.
type FullAnalysisResult struct {
	ChurnCause       string         `json:"churnCause"`
	ChurnCauseReason string         `json:"churnCauseReason"`
	Archetype        string         `json:"archetype"`
	RetentionGuide   []GuideSection `json:"retentionGuide"`
}

const analyzeSystem = `You are an IndiaMART seller retention intelligence system.

Given a seller's profile, XGBoost churn probability, engagement metrics, and call history,
you must output a single JSON object with four fields.

CHURN CAUSE — pick exactly one:
  "Seller Disengaged"  — seller withdrawing from platform activity (login/BL/PNS all declining, no external trigger)
  "External"           — competitor pressure or market forces are the primary driver
  "Mixed"              — combination of platform issues, lead-fit problems, or multiple concurrent causes

ARCHETYPE — pick exactly one:
  "Overwhelmed Starter"  — new or re-acquired seller who never properly onboarded; low catalog, high prior-churn flag
  "ROI Doubter"          — declining ROI perception; needs concrete value demonstration with real numbers
  "Platform Victim"      — platform issue (BL filter, PNS routing, catalog edits) causing frustration
  "Competitor Target"    — actively comparing or negotiating with a competitor
  "Seasonal Dip"         — decline is seasonal (scaffold/construction in Mar–May); dampen urgency
  "Healthy"              — engaged seller showing stable or growing signals; upsell opportunity

RETENTION GUIDE rules:
  - Reference the seller's EXACT metric numbers in pitches — never generic language
  - Each section: opening pitch the KAM reads aloud + exactly 3 concrete actions
  - If a competitor was mentioned, address it directly in the relevant section
  - Historical playbook data shows what actually worked — let it shape recommendations
  - XGBoost topFeatures are the primary signal — anchor your guide around them
  - 3–5 sections maximum

Output ONLY valid JSON — no explanation, no markdown:
{
  "churnCause": "...",
  "churnCauseReason": "one concise sentence explaining why",
  "archetype": "...",
  "retentionGuide": [
    { "title": "...", "pitch": "...", "actions": ["...", "...", "..."] }
  ]
}`

// inactiveGuideJSON is the pre-built static guide served to Tier 1 (completely inactive) sellers.
// These sellers bypass all LLM and XGBoost calls.
var inactiveGuideJSON string

func init() {
	sections := []GuideSection{
		{
			Title: "Urgent Executive Outreach",
			Pitch: "This seller has gone completely dark — login, BL consumption, and PNS pickup are all at or near zero. Every day of inaction increases churn probability. The exec must reach out personally within 24 hours, not through the KAM layer.",
			Actions: []string{
				"Personal call from VP/Director level — not the assigned KAM — within 24 hours",
				"Send a personalised WhatsApp message referencing the seller by name with a specific renewal date",
				"Escalate to Account Director if no response within 48 hours",
			},
		},
		{
			Title: "Diagnose the Root Cause",
			Pitch: "Before prescribing a solution, understand why they went silent. Ask open-ended questions — do not lead with platform features. The answer determines whether this is a platform failure, a business problem, or a competitor win.",
			Actions: []string{
				"Ask: 'What's changed in your business in the last 2 months that's made IndiaMART less useful for you?'",
				"Ask: 'Are you actively using any other lead platform right now?' — do not assume",
				"Log disposition and any competitor mention immediately after the call for retraining data",
			},
		},
		{
			Title: "Recovery Plan",
			Pitch: "Once you know the root cause, offer a concrete recovery path — not discounts, but proof of value. Reactivate their BL credits, walk through lead quality live, and agree a 30-day milestone.",
			Actions: []string{
				"Offer a free BL audit call with a product specialist to unblock any platform issue",
				"Show live leads in their category that matched their business profile in the last 30 days",
				"Set a 30-day checkpoint: if login and BL consumption don't recover to target levels, escalate to retention deal desk",
			},
		},
	}
	b, _ := json.Marshal(sections)
	inactiveGuideJSON = string(b)
}

// InactiveSellerGuideJSON returns the pre-built static retention guide for Tier 1 sellers.
func InactiveSellerGuideJSON() string { return inactiveGuideJSON }

// AnalyzeSeller performs a single Gemini call that classifies churn cause, assigns an archetype,
// and generates a personalized retention guide — all anchored on the XGBoost output already
// embedded in s.MLChurnProb and s.MLTopFeatures.
func AnalyzeSeller(s models.Seller, pb *models.PlaybookEntry, transcripts []string) (FullAnalysisResult, error) {
	prompt := buildAnalyzePrompt(s, pb, transcripts)
	raw, err := Call(analyzeSystem, prompt, 4096)
	if err != nil {
		return FullAnalysisResult{}, err
	}

	var result FullAnalysisResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return FullAnalysisResult{}, fmt.Errorf("parse analysis JSON: %w — raw: %s", err, raw)
	}
	return result, nil
}

func buildAnalyzePrompt(s models.Seller, pb *models.PlaybookEntry, transcripts []string) string {
	m := s.Metrics
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("SELLER: %s | %s | %s | %s package | ARR ₹%dk\n",
		s.Name, s.Company, s.City, s.PackageType, s.ARR/1000))
	sb.WriteString(fmt.Sprintf("CATEGORY: %s | RENEWAL: %d days\n", s.Category, s.DaysToRenewal))
	if s.PriorChurn {
		sb.WriteString("PRIOR CHURN: Yes — re-churn risk is 2.3x base rate\n")
	}

	// XGBoost output — primary anchor for the guide
	if s.MLChurnProb > 0 {
		sb.WriteString(fmt.Sprintf("\nXGBOOST CHURN PROBABILITY: %.0f%% (primary signal — anchor your analysis here)\n", s.MLChurnProb*100))
		if len(s.MLTopFeatures) > 0 {
			sb.WriteString("TOP DRIVING FEATURES:\n")
			for _, f := range s.MLTopFeatures {
				sb.WriteString(fmt.Sprintf("  - %s\n", f))
			}
		}
	}

	// Engagement snapshot
	sb.WriteString("\nENGAGEMENT SIGNALS (latest → 3-month drop):\n")
	sb.WriteString(fmt.Sprintf("  Login %%:        %.0f%%  (drop: %.0f%%)\n", latestF(m.LoginPct), dropF(m.LoginPct)))
	sb.WriteString(fmt.Sprintf("  BL Consumption: %.0f%%  (drop: %.0f%%)\n", latestF(m.BlConsumptionPct), dropF(m.BlConsumptionPct)))
	sb.WriteString(fmt.Sprintf("  PNS Pickup:     %.0f%%  (drop: %.0f%%)\n", latestF(m.PnsPickupRatePct), dropF(m.PnsPickupRatePct)))
	sb.WriteString(fmt.Sprintf("  LMS Reply:      %.0f%%  (drop: %.0f%%)\n", latestF(m.LmsReplyRatePct), dropF(m.LmsReplyRatePct)))
	sb.WriteString(fmt.Sprintf("  Retail BL %%:    %.0f%%  (high = poor lead fit for B2B sellers)\n", latestF(m.RetailBlRecommendedPct)))
	sb.WriteString(fmt.Sprintf("  Catalog Score:  %.0f\n", latestF(m.CatalogScore)))
	sb.WriteString(fmt.Sprintf("  Content QS:     %.0f\n", latestF(m.Cqs)))

	// Historical playbook
	if pb != nil && pb.SampleSize >= 3 {
		sb.WriteString(fmt.Sprintf("\nHISTORICAL PLAYBOOK — %d similar cases (%.0f%% retention rate):\n",
			pb.SampleSize, pb.RetentionRate*100))
		sb.WriteString(fmt.Sprintf("  KEY INSIGHT: %s\n", pb.KeyInsight))
		if len(pb.WinningApproaches) > 0 {
			sb.WriteString("  WHAT WORKS:\n")
			for _, a := range pb.WinningApproaches {
				sb.WriteString(fmt.Sprintf("    + %s\n", a))
			}
		}
		if len(pb.DoNotDo) > 0 {
			sb.WriteString("  DO NOT DO:\n")
			for _, d := range pb.DoNotDo {
				sb.WriteString(fmt.Sprintf("    - %s\n", d))
			}
		}
	}

	// Call history
	if len(s.CallInsights) > 0 {
		sb.WriteString("\nCALL HISTORY:\n")
		for _, c := range s.CallInsights {
			sb.WriteString(fmt.Sprintf("  [%s] %s — %s (%s)\n", c.Date, c.Sentiment, c.Summary, c.Disposition))
			if c.CompetitorMentioned != "" {
				sb.WriteString(fmt.Sprintf("    Competitor mentioned: %s\n", c.CompetitorMentioned))
			}
			if c.Quote != "" {
				sb.WriteString(fmt.Sprintf("    Quote: \"%s\"\n", c.Quote))
			}
			if c.CommitmentByExec != "" {
				sb.WriteString(fmt.Sprintf("    Exec committed: %s\n", c.CommitmentByExec))
			}
		}
	}

	// Transcripts (optional — nightly batch only)
	if len(transcripts) > 0 {
		sb.WriteString("\nTODAY'S CALL TRANSCRIPT(S):\n")
		for i, t := range transcripts {
			if len(transcripts) > 1 {
				sb.WriteString(fmt.Sprintf("--- Transcript %d ---\n", i+1))
			}
			sb.WriteString(t)
			sb.WriteString("\n")
		}
	}

	sb.WriteString("\nOutput the JSON analysis now.")
	return sb.String()
}
