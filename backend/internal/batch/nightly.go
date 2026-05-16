// Package batch runs the nightly seller enrichment pipeline.
// For each unresolved seller it:
//   1. Extracts structured insights from the day's call transcripts (Gemini)
//   2. Re-derives risk score, churn cause, and archetype with fresh call insight data
//   3. Pushes the feature vector to the ML service and fetches a churn probability
//   4. Generates a personalized retention guide (Gemini validates both rule + ML signals)
//   5. Persists everything to seller_computed so the API serves pure DB reads next day
package batch

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"sellerpulse/internal/classifier"
	"sellerpulse/internal/llm"
	"sellerpulse/internal/models"
	"sellerpulse/internal/outcome"
	"sellerpulse/internal/playbook"
	"sellerpulse/internal/scorer"
)

// batchDelay is the pause between Gemini calls to stay under the free-tier 5 req/min limit.
const batchDelay = 13 * time.Second

// LoadTranscripts reads the mock transcript file.
// Format: { "S-20001": ["transcript text 1", "transcript text 2"], ... }
func LoadTranscripts(path string) (map[string][]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m map[string][]string
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return m, nil
}

// Run executes the nightly pipeline for all unresolved sellers.
// Returns the count of sellers successfully processed.
func Run(sellers []models.Seller, store *outcome.Store, mlServiceURL string, transcriptsFile string) (int, error) {
	transcripts := make(map[string][]string)
	if transcriptsFile != "" {
		t, err := LoadTranscripts(transcriptsFile)
		if err != nil {
			log.Printf("[batch] warn: transcripts file: %v", err)
		} else {
			transcripts = t
			log.Printf("[batch] loaded transcripts for %d sellers", len(t))
		}
	}

	processed := 0
	geminiCalls := 0
	for _, s := range sellers {
		if s.Status == "Resolved" {
			continue
		}

		// Rate-limit between sellers to respect Gemini free-tier quota.
		if geminiCalls > 0 {
			log.Printf("[batch] waiting %v before next seller...", batchDelay)
			time.Sleep(batchDelay)
		}

		txCount, err := processSeller(s, transcripts[s.ID], store, mlServiceURL)
		geminiCalls += txCount + 1 // transcript extractions + guide generation
		if err != nil {
			log.Printf("[batch] warn: %s (%s): %v", s.ID, s.Name, err)
			continue
		}
		processed++
	}

	// Rebuild playbook from accumulated outcomes after all sellers are enriched.
	log.Printf("[batch] rebuilding playbook...")
	if _, err := playbook.Synthesize(store); err != nil {
		log.Printf("[batch] playbook warn: %v", err)
	}

	return processed, nil
}

// processSeller runs the full enrichment pipeline for a single seller.
// Returns the number of Gemini calls made (for rate-limit accounting).
func processSeller(s models.Seller, transcripts []string, store *outcome.Store, mlServiceURL string) (int, error) {
	// Step 1: fetch existing call insights from DB (accumulated from previous nights).
	dbInsights, _ := store.GetCallInsights(s.ID)

	// Step 2: re-derive enrichment using the existing insight picture.
	// Today's transcript is processed inside the combined LLM call below — not separately.
	raw := s.RawSeller
	raw.CallInsights = mergeInsights(dbInsights, s.CallInsights)

	riskScore := scorer.CalcRisk(raw)
	cause := classifier.ChurnCause(raw)
	causeReason := classifier.ChurnCauseReason(raw, cause)
	archetype := classifier.Archetype(raw)

	// Step 3: push feature vector to ML service and fetch churn probability.
	features := buildFeatures(s, raw.CallInsights)
	if err := pushFeatures(s.ID, features, mlServiceURL); err != nil {
		log.Printf("[batch] %s: push features (non-fatal): %v", s.ID, err)
	}
	mlProb, mlTopFeatures := fetchMLPrediction(s.ID, mlServiceURL)
	log.Printf("[batch] %s: risk=%d archetype=%s ml=%.0f%%", s.ID, riskScore, archetype, mlProb*100)

	// Step 4: build enriched seller with fresh signals.
	enriched := s
	enriched.RiskScore = riskScore
	enriched.ChurnCause = cause
	enriched.ChurnCauseReason = causeReason
	enriched.Archetype = archetype
	enriched.CallInsights = raw.CallInsights
	enriched.MLChurnProb = mlProb
	enriched.MLTopFeatures = mlTopFeatures

	// Step 5: get historical playbook for this archetype (nil-safe).
	pb, _ := store.GetPlaybookEntry(archetype)

	// Step 6: try the Python LangGraph agent first.
	// The agent does LLM-based cause classification + guide generation with full context
	// (metrics, call insights, XGBoost output). Falls back to Go LLM on any error.
	var guide []llm.GuideSection
	if ar, agentErr := callPythonAgent(enriched, mlServiceURL); agentErr == nil {
		cause = ar.ChurnCause
		causeReason = ar.CauseReason
		mlProb = ar.ChurnProb
		mlTopFeatures = ar.TopFeatures
		guide = ar.Guide
		log.Printf("[batch] %s: agent cause=%s guide=%d sections", s.ID, cause, len(guide))
	} else {
		log.Printf("[batch] %s: python agent unavailable (%v) — falling back to Go LLM", s.ID, agentErr)
		// Fallback: transcript-aware combined call or guide-only, same as before.
		if len(transcripts) > 0 {
			result, err := llm.ProcessSellerBatch(enriched, transcripts, pb, mlProb)
			if err != nil {
				return 1, fmt.Errorf("combined batch call: %w", err)
			}
			insight := models.CallInsight{
				ID:                  fmt.Sprintf("BATCH-%s-%d", s.ID, time.Now().UnixNano()),
				SellerID:            s.ID,
				Date:                time.Now().Format("2006-01-02"),
				Agent:               "Nightly-Batch",
				Sentiment:           result.CallInsight.Sentiment,
				Summary:             result.CallInsight.Summary,
				Issues:              result.CallInsight.Issues,
				Quote:               result.CallInsight.Quote,
				Disposition:         result.CallInsight.Disposition,
				CompetitorMentioned: result.CallInsight.CompetitorMentioned,
				CommitmentByExec:    result.CallInsight.CommitmentByExec,
				Source:              "BATCH",
			}
			store.SaveCallInsight(insight)
			log.Printf("[batch] %s: fallback insight extracted (sentiment: %s) + guide (%d sections)",
				s.ID, insight.Sentiment, len(result.RetentionGuide))
			guide = result.RetentionGuide
		} else {
			var err error
			guide, err = llm.RetentionGuide(enriched, pb, mlProb)
			if err != nil {
				return 1, fmt.Errorf("guide generation: %w", err)
			}
			log.Printf("[batch] %s: fallback guide generated (%d sections)", s.ID, len(guide))
		}
	}

	// Step 7: persist computed state + guide to DB.
	guideBytes, _ := json.Marshal(guide)
	state := models.ComputedState{
		SellerID:         s.ID,
		RiskScore:        riskScore,
		Archetype:        archetype,
		ChurnCause:       cause,
		ChurnCauseReason: causeReason,
		MLChurnProb:      mlProb,
		MLTopFeatures:    mlTopFeatures,
		GuideJSON:        string(guideBytes),
		ComputedAt:       time.Now().UTC().Format(time.RFC3339),
	}
	if err := store.SaveComputedState(state); err != nil {
		return 1, fmt.Errorf("save computed state: %w", err)
	}

	log.Printf("[batch] %s: done", s.ID)
	return 1, nil
}

// ─── Python agent helper ──────────────────────────────────────────────────────

type agentResult struct {
	ChurnCause  string           `json:"churnCause"`
	CauseReason string           `json:"causeReason"`
	ChurnProb   float64          `json:"churnProb"`
	TopFeatures []string         `json:"topFeatures"`
	Guide       []llm.GuideSection `json:"guide"`
}

// callPythonAgent sends the full seller to the LangGraph agent endpoint and returns
// the classified cause, reason, guide, and updated ML probability.
// Returns an error if the agent service is unavailable — caller should fall back to Go LLM.
func callPythonAgent(s models.Seller, mlServiceURL string) (*agentResult, error) {
	payload, _ := json.Marshal(map[string]any{"seller": s})
	resp, err := http.Post(mlServiceURL+"/agent/analyze", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("agent request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("agent %d: %s", resp.StatusCode, body)
	}
	var ar agentResult
	if err := json.NewDecoder(resp.Body).Decode(&ar); err != nil {
		return nil, fmt.Errorf("agent decode: %w", err)
	}
	return &ar, nil
}

// ─── ML helpers ──────────────────────────────────────────────────────────────

func pushFeatures(sellerID string, features map[string]float64, mlServiceURL string) error {
	payload, _ := json.Marshal(map[string]any{
		"sellerId": sellerID,
		"features": features,
	})
	resp, err := http.Post(mlServiceURL+"/features", "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

type mlPredictResponse struct {
	ChurnProb   float64  `json:"churnProb"`
	TopFeatures []string `json:"topFeatures"`
}

func fetchMLPrediction(sellerID string, mlServiceURL string) (float64, []string) {
	resp, err := http.Get(mlServiceURL + "/predict/" + sellerID)
	if err != nil || resp.StatusCode != http.StatusOK {
		return 0, nil // ML not yet available — guide uses rule-based signals only
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var pred mlPredictResponse
	json.Unmarshal(body, &pred)
	return pred.ChurnProb, pred.TopFeatures
}

// ─── Feature building ─────────────────────────────────────────────────────────

// buildFeatures derives the 18-column ML feature vector from seller metrics + call insights.
// Call insights substitute for KAM form fields (disposition, competitor, exec commitment).
func buildFeatures(s models.Seller, insights []models.CallInsight) map[string]float64 {
	m := s.Metrics
	hasCompetitor := 0.0
	dispositionScore := 0.0
	hasExecCommitment := 0.0

	for _, c := range insights {
		if c.CompetitorMentioned != "" {
			hasCompetitor = 1.0
		}
		if c.CommitmentByExec != "" {
			hasExecCommitment = 1.0
		}
		switch c.Disposition {
		case "Skeptical":
			if dispositionScore < 0.5 {
				dispositionScore = 0.5
			}
		case "Hostile":
			dispositionScore = 1.0
		}
	}

	return map[string]float64{
		"loginPct_last":     latestF(m.LoginPct),
		"loginPct_drop":     dropF(m.LoginPct),
		"blPct_last":        latestF(m.BlConsumptionPct),
		"blPct_drop":        dropF(m.BlConsumptionPct),
		"pnsPct_last":       latestF(m.PnsPickupRatePct),
		"pnsPct_drop":       dropF(m.PnsPickupRatePct),
		"lmsPct_last":       latestF(m.LmsReplyRatePct),
		"lmsPct_drop":       dropF(m.LmsReplyRatePct),
		"retailPct_last":    latestF(m.RetailBlRecommendedPct),
		"catalogScore":      latestF(m.CatalogScore),
		"cqs":               latestF(m.Cqs),
		"priorChurn":        boolToFloat(s.PriorChurn),
		"daysToRenewal":     float64(s.DaysToRenewal),
		"arr_norm":          float64(s.ARR) / 350000.0,
		"hasCompetitor":     hasCompetitor,
		"disposition":       dispositionScore,
		"churnReasonCount":  0,
		"hasExecCommitment": hasExecCommitment,
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func mergeInsights(db, seed []models.CallInsight) []models.CallInsight {
	seen := make(map[string]bool)
	var out []models.CallInsight
	for _, c := range db {
		seen[c.ID] = true
		out = append(out, c)
	}
	for _, c := range seed {
		if !seen[c.ID] {
			out = append(out, c)
		}
	}
	return out
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

func boolToFloat(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
