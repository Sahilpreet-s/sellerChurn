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
		CREATE TABLE IF NOT EXISTS outcomes (
			id               INTEGER PRIMARY KEY AUTOINCREMENT,
			seller_id        TEXT NOT NULL,
			outcome          TEXT NOT NULL,
			notes            TEXT,
			risk_score       INTEGER,
			feature_snapshot TEXT,
			logged_at        DATETIME DEFAULT CURRENT_TIMESTAMP
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

	return &Store{db: db}, nil
}

// LogOutcome saves a KAM-logged retention outcome and the feature snapshot.
func (s *Store) LogOutcome(sellerID, outcome, notes string, riskScore int, features map[string]float64) (models.OutcomeRecord, error) {
	snap, _ := json.Marshal(features)
	now := time.Now().UTC().Format(time.RFC3339)

	res, err := s.db.Exec(
		`INSERT INTO outcomes (seller_id, outcome, notes, risk_score, feature_snapshot, logged_at) VALUES (?,?,?,?,?,?)`,
		sellerID, outcome, notes, riskScore, string(snap), now,
	)
	if err != nil {
		return models.OutcomeRecord{}, err
	}
	id, _ := res.LastInsertId()
	return models.OutcomeRecord{
		ID: id, SellerID: sellerID, Outcome: outcome,
		Notes: notes, RiskScoreAtTime: riskScore,
		FeatureSnapshot: string(snap), LoggedAt: now,
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
