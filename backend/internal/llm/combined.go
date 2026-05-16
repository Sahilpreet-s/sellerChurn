package llm

import (
	"encoding/json"
	"fmt"
	"strings"

	"sellerpulse/internal/models"
)

const combinedSystem = `You are an IndiaMART seller retention intelligence system with two responsibilities:
1. Extract structured insights from today's call transcript(s) between the KAM and the seller
2. Generate a personalized retention call guide for the KAM based on all available data

Rules for call insight extraction:
- Extract what the seller actually said, not what you infer
- Quote the seller verbatim where a strong complaint or objection is present
- Disposition reflects the seller's attitude toward continuing with IndiaMART

Rules for the retention guide:
- Reference the seller's EXACT metric numbers in pitches — never use generic language like "your metrics dropped"
- Each section needs an opening pitch the KAM reads aloud, and exactly 3 concrete actions
- If a competitor was mentioned in the transcript, address it directly in the relevant section
- Historical playbook data shows what actually worked for this seller type — let it shape your recommendations
- 3–5 guide sections maximum

Output ONLY valid JSON matching the exact structure — no explanation, no markdown.`

// CombinedResult is the single Gemini response containing both the extracted call insight
// and the generated retention guide. Replaces two separate LLM calls in the nightly batch.
type CombinedResult struct {
	CallInsight    BatchInsight   `json:"callInsight"`
	RetentionGuide []GuideSection `json:"retentionGuide"`
}

// BatchInsight mirrors CallInsight fields that Gemini extracts from the transcript.
type BatchInsight struct {
	Sentiment           string   `json:"sentiment"`
	Summary             string   `json:"summary"`
	Issues              []string `json:"issues"`
	Quote               string   `json:"quote"`
	Disposition         string   `json:"disposition"`
	CompetitorMentioned string   `json:"competitorMentioned"`
	CommitmentByExec    string   `json:"commitmentByExec"`
}

// ProcessSellerBatch performs a single Gemini call that simultaneously extracts structured
// call insights from today's transcript(s) and generates a personalized retention guide.
// Having the raw transcript in the same context as the guide generation produces more
// coherent output — the guide can directly reference what the seller said verbatim.
func ProcessSellerBatch(s models.Seller, transcripts []string, pb *models.PlaybookEntry, mlChurnProb float64) (CombinedResult, error) {
	prompt := buildCombinedPrompt(s, transcripts, pb, mlChurnProb)
	raw, err := Call(combinedSystem, prompt, 4096)
	if err != nil {
		return CombinedResult{}, err
	}

	var result CombinedResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return CombinedResult{}, fmt.Errorf("parse combined JSON: %w — raw: %s", err, raw)
	}
	return result, nil
}

func buildCombinedPrompt(s models.Seller, transcripts []string, pb *models.PlaybookEntry, mlChurnProb float64) string {
	m := s.Metrics
	var sb strings.Builder

	// Seller profile
	sb.WriteString(fmt.Sprintf("SELLER: %s | %s | %s | %s package | ARR ₹%dk\n",
		s.Name, s.Company, s.City, s.PackageType, s.ARR/1000))
	sb.WriteString(fmt.Sprintf("CATEGORY: %s | ARCHETYPE: %s | CHURN CAUSE: %s\n",
		s.Category, s.Archetype, s.ChurnCause))
	sb.WriteString(fmt.Sprintf("RENEWAL: %d days | RULE-BASED RISK: %d/100\n",
		s.DaysToRenewal, s.RiskScore))
	if mlChurnProb > 0 {
		sb.WriteString(fmt.Sprintf("ML CHURN PROBABILITY: %.0f%% (XGBoost — contextualise alongside rule-based score, not in isolation)\n",
			mlChurnProb*100))
	}
	if s.PriorChurn {
		sb.WriteString("PRIOR CHURN: This seller previously lapsed. Re-churn risk is 2.3x base rate.\n")
	}

	// Engagement signals
	sb.WriteString("\nENGAGEMENT SIGNALS (latest value → 3-month drop):\n")
	sb.WriteString(fmt.Sprintf("  Login %%:        %.0f%%  (drop: %.0f%%)\n", latestF(m.LoginPct), dropF(m.LoginPct)))
	sb.WriteString(fmt.Sprintf("  BL Consumption: %.0f%%  (drop: %.0f%%)\n", latestF(m.BlConsumptionPct), dropF(m.BlConsumptionPct)))
	sb.WriteString(fmt.Sprintf("  PNS Pickup:     %.0f%%  (drop: %.0f%%)\n", latestF(m.PnsPickupRatePct), dropF(m.PnsPickupRatePct)))
	sb.WriteString(fmt.Sprintf("  LMS Reply:      %.0f%%  (drop: %.0f%%)\n", latestF(m.LmsReplyRatePct), dropF(m.LmsReplyRatePct)))
	sb.WriteString(fmt.Sprintf("  Retail BL %%:    %.0f%%  (high = poor lead fit for B2B sellers)\n", latestF(m.RetailBlRecommendedPct)))
	sb.WriteString(fmt.Sprintf("  Catalog Score:  %.0f\n", latestF(m.CatalogScore)))
	sb.WriteString(fmt.Sprintf("  Content QS:     %.0f\n", latestF(m.Cqs)))

	// Historical playbook
	if pb != nil && pb.SampleSize >= 3 {
		sb.WriteString(fmt.Sprintf("\nHISTORICAL PLAYBOOK — %d similar %s cases (%.0f%% retention rate):\n",
			pb.SampleSize, pb.Archetype, pb.RetentionRate*100))
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

	// Previous call history (from prior nights)
	if len(s.CallInsights) > 0 {
		sb.WriteString("\nPREVIOUS CALL HISTORY:\n")
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

	// Today's transcripts
	sb.WriteString("\nTODAY'S CALL TRANSCRIPT(S):\n")
	for i, t := range transcripts {
		if len(transcripts) > 1 {
			sb.WriteString(fmt.Sprintf("--- Transcript %d ---\n", i+1))
		}
		sb.WriteString(t)
		sb.WriteString("\n")
	}

	// Output schema
	sb.WriteString(`
Return JSON with exactly this structure:
{
  "callInsight": {
    "sentiment": "Positive" | "Neutral" | "Negative",
    "summary": "1-2 sentence plain-English summary of today's interaction",
    "issues": ["specific pain point raised, e.g. BL filters not working"],
    "quote": "verbatim seller complaint if present, else empty string",
    "disposition": "Willing" | "Skeptical" | "Hostile",
    "competitorMentioned": "competitor name if mentioned, else empty string",
    "commitmentByExec": "what the KAM promised to do, else empty string"
  },
  "retentionGuide": [
    {
      "title": "section title",
      "pitch": "opening pitch the KAM reads aloud — must reference exact metric numbers from above",
      "actions": ["action 1", "action 2", "action 3"]
    }
  ]
}`)

	return sb.String()
}
