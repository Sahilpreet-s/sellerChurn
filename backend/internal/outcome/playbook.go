package outcome

import (
	"database/sql"
	"encoding/json"
	"time"

	"sellerpulse/internal/models"
)

// RawOutcomeRow is the minimal outcome data the playbook synthesizer needs.
type RawOutcomeRow struct {
	Archetype      string
	Disposition    string
	ChurnReasons   []string
	ExecCommitment string
	Outcome        string
}

// GetOutcomesForSynthesis returns all labeled outcomes that have an archetype set.
func (s *Store) GetOutcomesForSynthesis() ([]RawOutcomeRow, error) {
	rows, err := s.db.Query(`
		SELECT archetype, disposition, churn_reasons, exec_commitment, outcome
		FROM outcomes
		WHERE archetype IS NOT NULL AND archetype != ''
		  AND outcome IN ('Resolved', 'Churned', 'Escalated')
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RawOutcomeRow
	for rows.Next() {
		var r RawOutcomeRow
		var arch, disp, comm, reasonsJSON sql.NullString
		rows.Scan(&arch, &disp, &reasonsJSON, &comm, &r.Outcome)
		r.Archetype = arch.String
		r.Disposition = disp.String
		r.ExecCommitment = comm.String
		if reasonsJSON.Valid && reasonsJSON.String != "" {
			json.Unmarshal([]byte(reasonsJSON.String), &r.ChurnReasons)
		}
		out = append(out, r)
	}
	return out, nil
}

// SavePlaybookEntry upserts a synthesized playbook entry keyed by archetype.
func (s *Store) SavePlaybookEntry(e models.PlaybookEntry) error {
	synthesis, _ := json.Marshal(e)
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(
		`INSERT OR REPLACE INTO playbook_entries (archetype, sample_size, retention_rate, synthesis, updated_at)
		 VALUES (?, ?, ?, ?, ?)`,
		e.Archetype, e.SampleSize, e.RetentionRate, string(synthesis), now,
	)
	return err
}

// GetPlaybookEntry retrieves a single playbook entry by archetype. Returns nil if not found.
func (s *Store) GetPlaybookEntry(archetype string) (*models.PlaybookEntry, error) {
	var synthesisJSON string
	err := s.db.QueryRow(`SELECT synthesis FROM playbook_entries WHERE archetype=?`, archetype).Scan(&synthesisJSON)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var e models.PlaybookEntry
	json.Unmarshal([]byte(synthesisJSON), &e)
	return &e, nil
}

// GetAllPlaybookEntries returns all synthesized entries ordered by archetype.
func (s *Store) GetAllPlaybookEntries() ([]models.PlaybookEntry, error) {
	rows, err := s.db.Query(`SELECT synthesis FROM playbook_entries ORDER BY archetype`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.PlaybookEntry
	for rows.Next() {
		var synthesisJSON string
		rows.Scan(&synthesisJSON)
		var e models.PlaybookEntry
		json.Unmarshal([]byte(synthesisJSON), &e)
		out = append(out, e)
	}
	return out, nil
}
