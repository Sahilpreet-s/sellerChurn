package outcome

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
	"sellerpulse/internal/models"
)

type Store struct {
	db *sql.DB
}

func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS seller_computed (
			seller_id          TEXT PRIMARY KEY,
			risk_score         INTEGER,
			archetype          TEXT,
			churn_cause        TEXT,
			churn_cause_reason TEXT,
			ml_churn_prob      REAL,
			ml_top_features    TEXT,
			guide_json         TEXT,
			computed_at        TEXT
		);
		CREATE TABLE IF NOT EXISTS outcomes (
			id                   INTEGER PRIMARY KEY AUTOINCREMENT,
			seller_id            TEXT NOT NULL,
			outcome              TEXT NOT NULL,
			notes                TEXT,
			disposition          TEXT,
			churn_reasons        TEXT,
			competitor_mentioned TEXT,
			exec_commitment      TEXT,
			follow_up_date       TEXT,
			custom_reason        TEXT,
			risk_score           INTEGER,
			feature_snapshot     TEXT,
			archetype            TEXT,
			logged_at            DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS playbook_entries (
			archetype      TEXT PRIMARY KEY,
			sample_size    INTEGER,
			retention_rate REAL,
			synthesis      TEXT NOT NULL,
			updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS call_insights (
			id                   TEXT PRIMARY KEY,
			seller_id            TEXT NOT NULL,
			date                 TEXT,
			duration_min         INTEGER,
			agent                TEXT,
			sentiment            TEXT,
			summary              TEXT,
			issues               TEXT,
			quote                TEXT,
			disposition          TEXT,
			competitor_mentioned TEXT,
			commitment_by_exec   TEXT,
			source               TEXT,
			created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		return nil, fmt.Errorf("create tables: %w", err)
	}

	// Migration: add archetype column to pre-existing outcomes tables (ignore error if already exists)
	db.Exec(`ALTER TABLE outcomes ADD COLUMN archetype TEXT`)

	return &Store{db: db}, nil
}

// LogOutcome saves a KAM-logged retention outcome and the feature snapshot.
func (s *Store) LogOutcome(sellerID, outcome, notes, disposition string, churnReasons []string, competitorMentioned, execCommitment, followUpDate, customReason string, riskScore int, archetype string, features map[string]float64) (models.OutcomeRecord, error) {
	snap, _ := json.Marshal(features)
	reasons, _ := json.Marshal(churnReasons)
	now := time.Now().UTC().Format(time.RFC3339)

	res, err := s.db.Exec(
		`INSERT INTO outcomes (seller_id, outcome, notes, disposition, churn_reasons, competitor_mentioned, exec_commitment, follow_up_date, custom_reason, risk_score, archetype, feature_snapshot, logged_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		sellerID, outcome, notes, disposition, string(reasons), competitorMentioned, execCommitment, followUpDate, customReason, riskScore, archetype, string(snap), now,
	)
	if err != nil {
		return models.OutcomeRecord{}, err
	}
	id, _ := res.LastInsertId()
	return models.OutcomeRecord{
		ID: id, SellerID: sellerID, Outcome: outcome,
		Notes: notes, Disposition: disposition, ChurnReasons: churnReasons,
		CompetitorMentioned: competitorMentioned, ExecCommitment: execCommitment,
		FollowUpDate: followUpDate, CustomReason: customReason,
		RiskScoreAtTime: riskScore, FeatureSnapshot: string(snap), LoggedAt: now,
	}, nil
}

// CountOutcomes returns total labeled rows available for ML training.
func (s *Store) CountOutcomes() int {
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM outcomes`).Scan(&n)
	return n
}

// SaveCallInsight persists a processed call insight (audio or MERP).
func (s *Store) SaveCallInsight(c models.CallInsight) error {
	issues, _ := json.Marshal(c.Issues)
	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO call_insights
		(id, seller_id, date, duration_min, agent, sentiment, summary, issues, quote,
		 disposition, competitor_mentioned, commitment_by_exec, source)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		c.ID, c.SellerID, c.Date, c.DurationMin, c.Agent, c.Sentiment,
		c.Summary, string(issues), c.Quote, c.Disposition,
		c.CompetitorMentioned, c.CommitmentByExec, c.Source,
	)
	return err
}

// GetCallInsights returns all stored insights for a seller.
func (s *Store) GetCallInsights(sellerID string) ([]models.CallInsight, error) {
	rows, err := s.db.Query(
		`SELECT id, seller_id, date, duration_min, agent, sentiment, summary, issues,
		        quote, disposition, competitor_mentioned, commitment_by_exec, source
		 FROM call_insights WHERE seller_id=? ORDER BY date DESC`, sellerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.CallInsight
	for rows.Next() {
		var c models.CallInsight
		var issuesJSON string
		rows.Scan(&c.ID, &c.SellerID, &c.Date, &c.DurationMin, &c.Agent,
			&c.Sentiment, &c.Summary, &issuesJSON, &c.Quote,
			&c.Disposition, &c.CompetitorMentioned, &c.CommitmentByExec, &c.Source)
		json.Unmarshal([]byte(issuesJSON), &c.Issues)
		out = append(out, c)
	}
	return out, nil
}

func (s *Store) Close() { s.db.Close() }

// SaveComputedState upserts the nightly-computed enrichment for one seller.
func (s *Store) SaveComputedState(state models.ComputedState) error {
	topJSON, _ := json.Marshal(state.MLTopFeatures)
	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO seller_computed
		(seller_id, risk_score, archetype, churn_cause, churn_cause_reason,
		 ml_churn_prob, ml_top_features, guide_json, computed_at)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		state.SellerID, state.RiskScore, state.Archetype, state.ChurnCause,
		state.ChurnCauseReason, state.MLChurnProb, string(topJSON),
		state.GuideJSON, state.ComputedAt,
	)
	return err
}

// GetComputedState returns the most recent nightly state for a seller, or nil if none.
func (s *Store) GetComputedState(sellerID string) (*models.ComputedState, error) {
	row := s.db.QueryRow(`
		SELECT seller_id, risk_score, archetype, churn_cause, churn_cause_reason,
		       ml_churn_prob, ml_top_features, guide_json, computed_at
		FROM seller_computed WHERE seller_id=?`, sellerID)

	var st models.ComputedState
	var topJSON string
	err := row.Scan(&st.SellerID, &st.RiskScore, &st.Archetype, &st.ChurnCause,
		&st.ChurnCauseReason, &st.MLChurnProb, &topJSON, &st.GuideJSON, &st.ComputedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	json.Unmarshal([]byte(topJSON), &st.MLTopFeatures)
	return &st, nil
}

// GetAllComputedStates returns all nightly states keyed by seller_id.
func (s *Store) GetAllComputedStates() (map[string]models.ComputedState, error) {
	rows, err := s.db.Query(`
		SELECT seller_id, risk_score, archetype, churn_cause, churn_cause_reason,
		       ml_churn_prob, ml_top_features, guide_json, computed_at
		FROM seller_computed`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]models.ComputedState)
	for rows.Next() {
		var st models.ComputedState
		var topJSON string
		rows.Scan(&st.SellerID, &st.RiskScore, &st.Archetype, &st.ChurnCause,
			&st.ChurnCauseReason, &st.MLChurnProb, &topJSON, &st.GuideJSON, &st.ComputedAt)
		json.Unmarshal([]byte(topJSON), &st.MLTopFeatures)
		out[st.SellerID] = st
	}
	return out, nil
}
