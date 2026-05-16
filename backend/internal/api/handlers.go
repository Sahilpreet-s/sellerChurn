package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"sellerpulse/internal/audio"
	"sellerpulse/internal/llm"
	"sellerpulse/internal/models"
	"sellerpulse/internal/outcome"
	"sellerpulse/internal/patterns"
	"sellerpulse/internal/playbook"
	"sellerpulse/internal/scorer"
)

// Store holds the shared application state.
type Store struct {
	Sellers      []models.Seller
	Patterns     []models.PatternAlert
	OutcomeStore *outcome.Store
	MLServiceURL string
	// Cached retention guides: sellerID → sections
	guideCacheMu chan struct{}
	guideCache   map[string][]llm.GuideSection
}

func NewStore(sellers []models.Seller, db *outcome.Store, mlURL string) *Store {
	s := &Store{
		Sellers:      sellers,
		OutcomeStore: db,
		MLServiceURL: mlURL,
		guideCacheMu: make(chan struct{}, 1),
		guideCache:   make(map[string][]llm.GuideSection),
	}
	s.guideCacheMu <- struct{}{} // initialize semaphore
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
	filtered := st.Sellers
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
	// Merge any DB-stored call insights on top of seed insights
	dbInsights, _ := st.OutcomeStore.GetCallInsights(s.ID)
	if len(dbInsights) > 0 {
		s.CallInsights = append(dbInsights, s.CallInsights...)
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

	// Rebuild playbook asynchronously every 10 real outcomes so the guide improves over time.
	// Invalidate guide cache so next generation uses the fresh playbook.
	if totalOutcomes%10 == 0 {
		store := st
		go func() {
			if _, err := playbook.Synthesize(store.OutcomeStore); err != nil {
				log.Printf("[playbook] async rebuild: %v", err)
				return
			}
			<-store.guideCacheMu
			store.guideCache = make(map[string][]llm.GuideSection)
			store.guideCacheMu <- struct{}{}
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

	// Return cached if available
	<-st.guideCacheMu
	cached, hit := st.guideCache[sellerID]
	st.guideCacheMu <- struct{}{}
	if hit {
		c.JSON(http.StatusOK, gin.H{"sections": cached, "cached": true})
		return
	}

	// Enrich guide with historical playbook learnings for this archetype (nil-safe if no entry yet)
	pb, _ := st.OutcomeStore.GetPlaybookEntry(s.Archetype)

	sections, err := llm.RetentionGuide(s, pb)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	<-st.guideCacheMu
	st.guideCache[sellerID] = sections
	st.guideCacheMu <- struct{}{}

	c.JSON(http.StatusOK, gin.H{"sections": sections, "cached": false})
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

	// Invalidate guide cache — next guide generation will use the fresh playbook
	<-st.guideCacheMu
	st.guideCache = make(map[string][]llm.GuideSection)
	st.guideCacheMu <- struct{}{}

	if entries == nil {
		entries = []models.PlaybookEntry{}
	}
	c.JSON(http.StatusOK, gin.H{
		"rebuilt": len(entries),
		"entries": entries,
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

