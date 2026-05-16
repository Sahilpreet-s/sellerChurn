// Package batch runs the nightly seller enrichment pipeline.
// For each unresolved seller it:
//   1. Tier 1 check: if login≤5 && BL≤5 && PNS≤5 → riskScore=95, static guide, no LLM/XGBoost
//   2. Builds feature vector and pushes to ML service
//   3. Fetches XGBoost churn probability → riskScore = round(prob × 92)
//   4. Single Gemini call: autonomously classifies cause + archetype + generates guide
//   5. Persists everything to seller_computed
package batch

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"time"

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

		// Rate-limit between LLM calls to respect Gemini free-tier quota.
		if geminiCalls > 0 {
			log.Printf("[batch] waiting %v before next seller...", batchDelay)
			time.Sleep(batchDelay)
		}

		txCount, err := processSeller(s, transcripts[s.ID], store, mlServiceURL)
		geminiCalls += txCount
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
	// Tier 1: completely inactive sellers — skip XGBoost and LLM entirely.
	if scorer.IsInactiveSeller(s.RawSeller) {
		state := models.ComputedState{
			SellerID:         s.ID,
			RiskScore:        95,
			Archetype:        "Seller Inactive",
			ChurnCause:       "Seller Disengaged",
			ChurnCauseReason: "Seller completely inactive — login, BL consumption, and PNS pickup all at or near zero.",
			MLChurnProb:      0.95,
			MLTopFeatures:    nil,
			GuideJSON:        llm.InactiveSellerGuideJSON(),
			ComputedAt:       time.Now().UTC().Format(time.RFC3339),
		}
		if err := store.SaveComputedState(state); err != nil {
			return 0, fmt.Errorf("save computed state: %w", err)
		}
		log.Printf("[batch] %s: Tier 1 inactive — risk=95, no LLM call", s.ID)
		return 0, nil
	}

	// Step 1: merge call insights from DB with seed data.
	dbInsights, _ := store.GetCallInsights(s.ID)
	raw := s.RawSeller
	raw.CallInsights = mergeInsights(dbInsights, s.CallInsights)
	enriched := s
	enriched.CallInsights = raw.CallInsights

	// Step 2: build feature vector and push to ML service.
	features := buildFeatures(s, raw.CallInsights)
	if err := pushFeatures(s.ID, features, mlServiceURL); err != nil {
		log.Printf("[batch] %s: push features (non-fatal): %v", s.ID, err)
	}

	// Step 3: fetch XGBoost churn probability — primary risk source.
	mlProb, mlTopFeatures := fetchMLPrediction(s.ID, mlServiceURL)
	riskScore := int(math.Round(mlProb * 92))
	log.Printf("[batch] %s: ml=%.0f%% risk=%d", s.ID, mlProb*100, riskScore)

	enriched.RiskScore = riskScore
	enriched.MLChurnProb = mlProb
	enriched.MLTopFeatures = mlTopFeatures

	// Step 4: get historical playbook for LLM context (nil-safe).
	pb, _ := store.GetPlaybookEntry(s.Archetype)

	// Step 5: single LLM call — autonomous cause + archetype + guide.
	result, err := llm.AnalyzeSeller(enriched, pb, transcripts)
	if err != nil {
		return 1, fmt.Errorf("analyze seller: %w", err)
	}
	log.Printf("[batch] %s: cause=%s archetype=%s guide=%d sections",
		s.ID, result.ChurnCause, result.Archetype, len(result.RetentionGuide))

	// Step 6: persist computed state + guide to DB.
	guideBytes, _ := json.Marshal(result.RetentionGuide)
	state := models.ComputedState{
		SellerID:         s.ID,
		RiskScore:        riskScore,
		Archetype:        result.Archetype,
		ChurnCause:       result.ChurnCause,
		ChurnCauseReason: result.ChurnCauseReason,
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
		return 0, nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var pred mlPredictResponse
	json.Unmarshal(body, &pred)
	return pred.ChurnProb, pred.TopFeatures
}

// ─── Feature building ─────────────────────────────────────────────────────────

// buildFeatures derives the 18-column ML feature vector from seller metrics + call insights.
func buildFeatures(s models.Seller, insights []models.CallInsight) map[string]float64 {
	m := s.Metrics
	hasCompetitor := 0.0
	hasExecCommitment := 0.0
	dispositionScore := 0.0
	issueSet := make(map[string]bool)

	// Find most-recent call for disposition; count all distinct issues.
	var latestDate string
	var latestDisposition string
	for _, c := range insights {
		if c.CompetitorMentioned != "" {
			hasCompetitor = 1.0
		}
		if c.CommitmentByExec != "" {
			hasExecCommitment = 1.0
		}
		for _, issue := range c.Issues {
			issueSet[issue] = true
		}
		if c.Date > latestDate {
			latestDate = c.Date
			latestDisposition = c.Disposition
		}
	}

	switch latestDisposition {
	case "Skeptical":
		dispositionScore = 0.5
	case "Hostile":
		dispositionScore = 1.0
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
		"churnReasonCount":  float64(len(issueSet)) / 9.0,
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
	// Sort descending by date so most-recent appears first.
	sort.Slice(out, func(i, j int) bool { return out[i].Date > out[j].Date })
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
