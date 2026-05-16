package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"sellerpulse/internal/audio"
	"sellerpulse/internal/batch"
	"sellerpulse/internal/llm"
	"sellerpulse/internal/models"
	"sellerpulse/internal/outcome"
	"sellerpulse/internal/patterns"
	"sellerpulse/internal/playbook"
	"sellerpulse/internal/scorer"
)

// Store holds the shared application state.
type Store struct {
	Sellers         []models.Seller
	Patterns        []models.PatternAlert
	OutcomeStore    *outcome.Store
	MLServiceURL    string
	TranscriptsFile string
}

func NewStore(sellers []models.Seller, db *outcome.Store, mlURL string, transcriptsFile string) *Store {
	s := &Store{
		Sellers:         sellers,
		OutcomeStore:    db,
		MLServiceURL:    mlURL,
		TranscriptsFile: transcriptsFile,
	}
	s.Patterns = patterns.Detect(sellers)
	return s
}

func (st *Store) findSeller(id string) (models.Seller, bool) {
	for _, s := range st.Sellers {
		if s.ID == id {
			return s, true
		}
	}
	return models.Seller{}, false
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// GET /api/v1/sellers
func (st *Store) ListSellers(c *gin.Context) {
	// Load all nightly-computed states once and merge into the seller list.
	computed, _ := st.OutcomeStore.GetAllComputedStates()
	sellers := make([]models.Seller, len(st.Sellers))
	copy(sellers, st.Sellers)
	for i, s := range sellers {
		if cs, ok := computed[s.ID]; ok {
			sellers[i].RiskScore = cs.RiskScore
			sellers[i].Archetype = cs.Archetype
			sellers[i].ChurnCause = cs.ChurnCause
			sellers[i].ChurnCauseReason = cs.ChurnCauseReason
			sellers[i].MLChurnProb = cs.MLChurnProb
			sellers[i].MLTopFeatures = cs.MLTopFeatures
		}
	}
	filtered := sellers
	if risk := c.Query("risk"); risk != "" {
		var out []models.Seller
		for _, s := range filtered {
			if scorer.RiskBand(s.RiskScore) == risk {
				out = append(out, s)
			}
		}
		filtered = out
	}
	if status := c.Query("status"); status != "" {
		var out []models.Seller
		for _, s := range filtered {
			if s.Status == status {
				out = append(out, s)
			}
		}
		filtered = out
	}
	if pkg := c.Query("package"); pkg != "" {
		var out []models.Seller
		for _, s := range filtered {
			if s.PackageType == pkg {
				out = append(out, s)
			}
		}
		filtered = out
	}
	if q := c.Query("q"); q != "" {
		var out []models.Seller
		for _, s := range filtered {
			lq := q
			if containsCI(s.Name, lq) || containsCI(s.Company, lq) || containsCI(s.ID, lq) {
				out = append(out, s)
			}
		}
		filtered = out
	}
	c.JSON(http.StatusOK, filtered)
}

// GET /api/v1/sellers/:id
func (st *Store) GetSeller(c *gin.Context) {
	s, ok := st.findSeller(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "seller not found"})
		return
	}
	// Merge DB call insights on top of seed insights.
	dbInsights, _ := st.OutcomeStore.GetCallInsights(s.ID)
	if len(dbInsights) > 0 {
		s.CallInsights = append(dbInsights, s.CallInsights...)
	}
	// Merge nightly-computed enrichment when available.
	if cs, _ := st.OutcomeStore.GetComputedState(s.ID); cs != nil {
		s.RiskScore = cs.RiskScore
		s.Archetype = cs.Archetype
		s.ChurnCause = cs.ChurnCause
		s.ChurnCauseReason = cs.ChurnCauseReason
		s.MLChurnProb = cs.MLChurnProb
		s.MLTopFeatures = cs.MLTopFeatures
	}
	c.JSON(http.StatusOK, s)
}

// GET /api/v1/stats
func (st *Store) GetStats(c *gin.Context) {
	var high, med, low int
	var arrAtRisk int
	minDays := int(^uint(0) >> 1)
	for _, s := range st.Sellers {
		switch scorer.RiskBand(s.RiskScore) {
		case "High":
			high++
			arrAtRisk += s.ARR
		case "Medium":
			med++
		default:
			low++
		}
		if s.DaysToRenewal > 0 && s.DaysToRenewal < minDays {
			minDays = s.DaysToRenewal
		}
	}
	cohortDate := time.Now().UTC().AddDate(0, 0, minDays).Format("2006-01-02")
	c.JSON(http.StatusOK, gin.H{
		"total":      len(st.Sellers),
		"high":       high,
		"medium":     med,
		"low":        low,
		"arrAtRisk":  arrAtRisk,
		"cohortDate": cohortDate,
	})
}

// GET /api/v1/patterns
func (st *Store) GetPatterns(c *gin.Context) {
	c.JSON(http.StatusOK, st.Patterns)
}

// POST /api/v1/sellers/:id/outcome
func (st *Store) LogOutcome(c *gin.Context) {
	sellerID := c.Param("id")
	s, ok := st.findSeller(sellerID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "seller not found"})
		return
	}

	var body struct {
		Outcome             string   `json:"outcome" binding:"required"`
		Notes               string   `json:"notes"`
		Disposition         string   `json:"disposition"`
		ChurnReasons        []string `json:"churnReasons"`
		CompetitorMentioned string   `json:"competitorMentioned"`
		ExecCommitment      string   `json:"execCommitment"`
		FollowUpDate        string   `json:"followUpDate"`
		CustomReason        string   `json:"customReason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Encode disposition as numeric for ML
	dispositionScore := 0.0
	switch body.Disposition {
	case "Skeptical":
		dispositionScore = 0.5
	case "Hostile":
		dispositionScore = 1.0
	}

	// Build feature snapshot — metrics + executive feedback signals
	m := s.Metrics
	features := map[string]float64{
		"loginPct_last":      latestF(m.LoginPct),
		"loginPct_drop":      dropF(m.LoginPct),
		"blPct_last":         latestF(m.BlConsumptionPct),
		"blPct_drop":         dropF(m.BlConsumptionPct),
		"pnsPct_last":        latestF(m.PnsPickupRatePct),
		"pnsPct_drop":        dropF(m.PnsPickupRatePct),
		"lmsPct_last":        latestF(m.LmsReplyRatePct),
		"lmsPct_drop":        dropF(m.LmsReplyRatePct),
		"retailPct_last":     latestF(m.RetailBlRecommendedPct),
		"catalogScore":       latestF(m.CatalogScore),
		"cqs":                latestF(m.Cqs),
		"priorChurn":         boolToFloat(s.PriorChurn),
		"daysToRenewal":      float64(s.DaysToRenewal),
		"arr_norm":           float64(s.ARR) / 350000.0,
		"hasCompetitor":      boolToFloat(body.CompetitorMentioned != ""),
		"disposition":        dispositionScore,
		"churnReasonCount":   float64(len(body.ChurnReasons)) / 9.0,
		"hasExecCommitment":  boolToFloat(body.ExecCommitment != ""),
	}

	rec, err := st.OutcomeStore.LogOutcome(
		sellerID, body.Outcome, body.Notes, body.Disposition,
		body.ChurnReasons, body.CompetitorMentioned, body.ExecCommitment,
		body.FollowUpDate, body.CustomReason, s.RiskScore, s.Archetype, features,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Update seller status in memory
	for i, sel := range st.Sellers {
		if sel.ID == sellerID {
			if body.Outcome == "Resolved" {
				st.Sellers[i].Status = "Resolved"
			}
			break
		}
	}

	totalOutcomes := st.OutcomeStore.CountOutcomes()

	// Feed labeled example to ML training corpus (fire-and-forget, never blocks response).
	go func() {
		payload, _ := json.Marshal(map[string]any{
			"sellerId":        sellerID,
			"outcome":         body.Outcome,
			"featureSnapshot": features,
		})
		resp, err := http.Post(st.MLServiceURL+"/outcomes", "application/json", bytes.NewReader(payload))
		if err == nil {
			resp.Body.Close()
		}
	}()

	// Rebuild playbook asynchronously every 10 real outcomes so synthesis improves over time.
	if totalOutcomes%10 == 0 {
		store := st
		go func() {
			if _, err := playbook.Synthesize(store.OutcomeStore); err != nil {
				log.Printf("[playbook] async rebuild: %v", err)
				return
			}
			log.Printf("[playbook] rebuilt after %d outcomes", totalOutcomes)
		}()
	}

	c.JSON(http.StatusOK, gin.H{
		"record":        rec,
		"totalOutcomes": totalOutcomes,
		"nextRetrainAt": 5000,
		"message":       fmt.Sprintf("Outcome logged. %d training examples collected.", totalOutcomes),
	})
}

// POST /api/v1/sellers/:id/guide
func (st *Store) GetRetentionGuide(c *gin.Context) {
	sellerID := c.Param("id")
	s, ok := st.findSeller(sellerID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "seller not found"})
		return
	}

	// Primary path: return the pre-generated guide from the nightly batch.
	if cs, _ := st.OutcomeStore.GetComputedState(sellerID); cs != nil && cs.GuideJSON != "" {
		var sections []llm.GuideSection
		if err := json.Unmarshal([]byte(cs.GuideJSON), &sections); err == nil {
			c.JSON(http.StatusOK, gin.H{"sections": sections, "cached": true, "source": "nightly_batch", "computedAt": cs.ComputedAt})
			return
		}
	}

	// Fallback: no nightly data yet — generate on demand.
	// Merge DB call insights so the guide has real transcript data.
	dbInsights, _ := st.OutcomeStore.GetCallInsights(sellerID)
	if len(dbInsights) > 0 {
		s.CallInsights = append(dbInsights, s.CallInsights...)
	}

	// Get ML probability on-demand for the prompt.
	mlProb := fetchMLProb(sellerID, s, st.MLServiceURL)

	pb, _ := st.OutcomeStore.GetPlaybookEntry(s.Archetype)
	sections, err := llm.RetentionGuide(s, pb, mlProb)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Persist so subsequent calls don't hit Gemini again.
	guideBytes, _ := json.Marshal(sections)
	st.OutcomeStore.SaveComputedState(models.ComputedState{
		SellerID:    sellerID,
		RiskScore:   s.RiskScore,
		Archetype:   s.Archetype,
		ChurnCause:  s.ChurnCause,
		MLChurnProb: mlProb,
		GuideJSON:   string(guideBytes),
		ComputedAt:  time.Now().UTC().Format(time.RFC3339),
	})

	c.JSON(http.StatusOK, gin.H{"sections": sections, "cached": false, "source": "on_demand"})
}

// fetchMLProb pushes features to the ML service and returns the churn probability.
// Returns 0 (no signal) if the ML service is unavailable — guide falls back to rule-based only.
func fetchMLProb(sellerID string, s models.Seller, mlServiceURL string) float64 {
	features := map[string]float64{
		"loginPct_last":     latestF(s.Metrics.LoginPct),
		"loginPct_drop":     dropF(s.Metrics.LoginPct),
		"blPct_last":        latestF(s.Metrics.BlConsumptionPct),
		"blPct_drop":        dropF(s.Metrics.BlConsumptionPct),
		"pnsPct_last":       latestF(s.Metrics.PnsPickupRatePct),
		"pnsPct_drop":       dropF(s.Metrics.PnsPickupRatePct),
		"lmsPct_last":       latestF(s.Metrics.LmsReplyRatePct),
		"lmsPct_drop":       dropF(s.Metrics.LmsReplyRatePct),
		"retailPct_last":    latestF(s.Metrics.RetailBlRecommendedPct),
		"catalogScore":      latestF(s.Metrics.CatalogScore),
		"cqs":               latestF(s.Metrics.Cqs),
		"priorChurn":        boolToFloat(s.PriorChurn),
		"daysToRenewal":     float64(s.DaysToRenewal),
		"arr_norm":          float64(s.ARR) / 350000.0,
		"hasCompetitor":     0,
		"disposition":       0,
		"churnReasonCount":  0,
		"hasExecCommitment": 0,
	}
	payload, _ := json.Marshal(map[string]any{"sellerId": sellerID, "features": features})
	http.Post(mlServiceURL+"/features", "application/json", bytes.NewReader(payload))

	resp, err := http.Get(mlServiceURL + "/predict/" + sellerID)
	if err != nil || resp.StatusCode != http.StatusOK {
		return 0
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var pred struct {
		ChurnProb float64 `json:"churnProb"`
	}
	json.Unmarshal(body, &pred)
	return pred.ChurnProb
}

// POST /api/v1/audio/upload
func (st *Store) UploadAudio(c *gin.Context) {
	var body struct {
		SellerID    string `json:"sellerId" binding:"required"`
		Transcript  string `json:"transcript" binding:"required"`
		Agent       string `json:"agent"`
		DurationMin int    `json:"durationMin"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.Agent == "" {
		body.Agent = "Unknown Agent"
	}

	insight, err := audio.ProcessTranscript(body.Transcript, body.SellerID, body.Agent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if body.DurationMin > 0 {
		insight.DurationMin = body.DurationMin
	}

	if err := st.OutcomeStore.SaveCallInsight(insight); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save insight: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, insight)
}


// GET /api/v1/playbook
func (st *Store) GetPlaybook(c *gin.Context) {
	entries, err := st.OutcomeStore.GetAllPlaybookEntries()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if entries == nil {
		entries = []models.PlaybookEntry{}
	}
	c.JSON(http.StatusOK, entries)
}

// POST /api/v1/playbook/rebuild
func (st *Store) RebuildPlaybook(c *gin.Context) {
	entries, err := playbook.Synthesize(st.OutcomeStore)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if entries == nil {
		entries = []models.PlaybookEntry{}
	}
	c.JSON(http.StatusOK, gin.H{
		"rebuilt": len(entries),
		"entries": entries,
	})
}

// POST /api/v1/batch/nightly
func (st *Store) RunNightlyBatch(c *gin.Context) {
	log.Printf("[batch] nightly run triggered via API")
	count, err := batch.Run(st.Sellers, st.OutcomeStore, st.MLServiceURL, st.TranscriptsFile)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"processed": count,
		"message":   fmt.Sprintf("Nightly batch complete. %d sellers enriched.", count),
	})
}

// GET /api/v1/ml/prediction/:id
func (st *Store) GetMLPrediction(c *gin.Context) {
	sellerID := c.Param("id")
	resp, err := http.Get(st.MLServiceURL + "/predict/" + sellerID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ML service unavailable"})
		return
	}
	defer resp.Body.Close()
	var pred models.MLPrediction
	json.NewDecoder(resp.Body).Decode(&pred)
	c.JSON(http.StatusOK, pred)
}

// GET /api/v1/ml/stats
func (st *Store) GetMLStats(c *gin.Context) {
	resp, err := http.Get(st.MLServiceURL + "/stats")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ML service unavailable"})
		return
	}
	defer resp.Body.Close()
	var stats models.MLStats
	json.NewDecoder(resp.Body).Decode(&stats)
	c.JSON(http.StatusOK, stats)
}

// POST /api/v1/ml/train
func (st *Store) TriggerTraining(c *gin.Context) {
	resp, err := http.Post(st.MLServiceURL+"/train", "application/json", bytes.NewBufferString("{}"))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ML service unavailable"})
		return
	}
	defer resp.Body.Close()
	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	c.JSON(http.StatusOK, result)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

func containsCI(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub ||
		len(sub) == 0 ||
		indexCI(s, sub) >= 0)
}

func indexCI(s, sub string) int {
	ls := toLower(s)
	lsub := toLower(sub)
	for i := 0; i <= len(ls)-len(lsub); i++ {
		if ls[i:i+len(lsub)] == lsub {
			return i
		}
	}
	return -1
}

func toLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

