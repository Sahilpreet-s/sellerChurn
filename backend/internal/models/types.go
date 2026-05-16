package models

// MetricHistory is one month's reading for a signal.
type MetricHistory struct {
	Month string  `json:"month"`
	Value float64 `json:"value"`
}

// CallInsight is a structured extraction from a call recording or MERP note.
type CallInsight struct {
	ID                  string   `json:"id"`
	SellerID            string   `json:"sellerId"`
	Date                string   `json:"date"`
	DurationMin         int      `json:"durationMin"`
	Agent               string   `json:"agent"`
	Sentiment           string   `json:"sentiment"` // Positive | Neutral | Negative
	Summary             string   `json:"summary"`
	Issues              []string `json:"issues"`
	Quote               string   `json:"quote,omitempty"`
	Disposition         string   `json:"disposition,omitempty"`  // Willing | Skeptical | Hostile
	CompetitorMentioned string   `json:"competitorMentioned,omitempty"`
	CommitmentByExec    string   `json:"commitmentByExec,omitempty"`
	Source              string   `json:"source,omitempty"` // AUDIO | MERP | MANUAL
}

// SellerMetrics holds 3-month time-series for each engagement signal.
type SellerMetrics struct {
	LoginPct               []MetricHistory `json:"loginPct"`
	BlConsumptionPct       []MetricHistory `json:"blConsumptionPct"`
	PnsPickupRatePct       []MetricHistory `json:"pnsPickupRatePct"`
	LmsReplyRatePct        []MetricHistory `json:"lmsReplyRatePct"`
	RetailBlRecommendedPct []MetricHistory `json:"retailBlRecommendedPct"`
	CatalogScore           []MetricHistory `json:"catalogScore"`
	Cqs                    []MetricHistory `json:"cqs"`
	Blni                   []MetricHistory `json:"blni"`
	BlActiveDays           []MetricHistory `json:"blActiveDays"`
}

// LeadsMonthData holds one month of IndiaMART lead volume and consumption data.
type LeadsMonthData struct {
	Month        string `json:"month"`
	BlConsumed   int    `json:"blConsumed"`
	TotalEnq     int    `json:"totalEnq"`
	Cons0to4hrs  int    `json:"cons0to4hrs"`
	Cons4to24hrs int    `json:"cons4to24hrs"`
	ConsGt1day   int    `json:"consGt1day"`
	BlLapsed     int    `json:"blLapsed"`
}

// RawSeller is the on-disk representation (sellers.json). No derived fields.
type RawSeller struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	Company      string           `json:"company"`
	City         string           `json:"city"`
	Category     string           `json:"category"`
	PackageType  string           `json:"packageType"`
	ARR          int              `json:"arr"`
	Status       string           `json:"status"`
	PriorChurn   bool             `json:"priorChurn"`
	Metrics      SellerMetrics    `json:"metrics"`
	LeadsHistory []LeadsMonthData `json:"leadsHistory"`
	CallInsights []CallInsight    `json:"callInsights"`
}

// Seller is the fully enriched object served to the frontend.
type Seller struct {
	RawSeller
	RenewalDate      string  `json:"renewalDate"`
	DaysToRenewal    int     `json:"daysToRenewal"`
	RiskScore        int     `json:"riskScore"`
	ChurnCause       string  `json:"churnCause"`       // BEHAVIORAL | PLATFORM_FAILURE | EXTERNAL | MIXED
	ChurnCauseReason string  `json:"churnCauseReason"`
	Archetype        string  `json:"archetype"`
	MLChurnProb      float64 `json:"mlChurnProb"`      // from Python XGBoost service
	MLTopFeatures    []string `json:"mlTopFeatures"`   // top 3 features driving ML score
}

// PatternAlert is a systemic issue detected across multiple sellers.
type PatternAlert struct {
	ID          string   `json:"id"`
	Type        string   `json:"type"`        // PLATFORM | SEASONAL | LEAD_FIT
	Severity    string   `json:"severity"`    // High | Medium
	Title       string   `json:"title"`
	Narrative   string   `json:"narrative"`
	AffectedIDs []string `json:"affectedIds"`
	AffectedCount int    `json:"affectedCount"`
}

// OutcomeRecord is written to SQLite when a KAM logs the result of a retention call.
type OutcomeRecord struct {
	ID                  int64    `json:"id"`
	SellerID            string   `json:"sellerId"`
	Outcome             string   `json:"outcome"` // Resolved | Escalated | Churned
	Notes               string   `json:"notes"`
	Disposition         string   `json:"disposition,omitempty"`          // Willing | Skeptical | Hostile
	ChurnReasons        []string `json:"churnReasons,omitempty"`         // predefined reason codes
	CompetitorMentioned string   `json:"competitorMentioned,omitempty"`
	ExecCommitment      string   `json:"execCommitment,omitempty"`
	FollowUpDate        string   `json:"followUpDate,omitempty"`
	CustomReason        string   `json:"customReason,omitempty"`
	RiskScoreAtTime     int      `json:"riskScoreAtTime"`
	FeatureSnapshot     string   `json:"featureSnapshot"`
	LoggedAt            string   `json:"loggedAt"`
}

// MLStats is returned by the Python service.
type MLStats struct {
	TrainingExamples int     `json:"trainingExamples"`
	AUC              float64 `json:"auc"`
	NextRetrainAt    int     `json:"nextRetrainAt"`
	LastTrainedAt    string  `json:"lastTrainedAt"`
	ModelActive      bool    `json:"modelActive"`
}

// PlaybookEntry is a synthesized, archetype-level retention playbook generated by Gemini
// from accumulated historical outcomes. Updated in batch whenever enough new outcomes exist.
type PlaybookEntry struct {
	Archetype         string   `json:"archetype"`
	SampleSize        int      `json:"sampleSize"`
	RetentionRate     float64  `json:"retentionRate"`
	WinningApproaches []string `json:"winningApproaches"`
	FailedApproaches  []string `json:"failedApproaches"`
	KeyInsight        string   `json:"keyInsight"`
	DoNotDo           []string `json:"doNotDo"`
	UpdatedAt         string   `json:"updatedAt"`
}

// MLPrediction is the per-seller response from the Python service.
type MLPrediction struct {
	SellerID     string   `json:"sellerId"`
	ChurnProb    float64  `json:"churnProb"`
	TopFeatures  []string `json:"topFeatures"`
	ModelVersion string   `json:"modelVersion"`
}
