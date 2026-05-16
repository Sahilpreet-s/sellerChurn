package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"sellerpulse/internal/api"
	"sellerpulse/internal/classifier"
	"sellerpulse/internal/config"
	"sellerpulse/internal/models"
	"sellerpulse/internal/outcome"
	"sellerpulse/internal/playbook"
	"sellerpulse/internal/scorer"
)

func main() {
	cfg := config.Load()

	// ── Load & enrich sellers ─────────────────────────────────────────────────
	sellers, err := loadSellers(cfg.SellersFile)
	if err != nil {
		log.Fatalf("load sellers: %v", err)
	}
	log.Printf("Loaded %d sellers", len(sellers))

	// ── Outcome store (SQLite) ────────────────────────────────────────────────
	db, err := outcome.NewStore(cfg.DBPath)
	if err != nil {
		log.Fatalf("outcome store: %v", err)
	}
	defer db.Close()
	log.Printf("Outcome store ready. Training examples: %d", db.CountOutcomes())

	// ── Playbook: build at startup only if no entries exist yet ──────────────
	// (skips rebuild when entries are already populated from a prior run)
	go func() {
		existing, _ := db.GetAllPlaybookEntries()
		if len(existing) > 0 {
			log.Printf("Playbook: %d entries already present, skipping startup build", len(existing))
			return
		}
		rows, _ := db.GetOutcomesForSynthesis()
		if len(rows) < 3 {
			log.Printf("Playbook: not enough outcomes yet (%d), skipping build", len(rows))
			return
		}
		log.Printf("Playbook: building from %d outcomes (this takes ~1 min due to rate limiting)...", len(rows))
		entries, err := playbook.Synthesize(db)
		if err != nil {
			log.Printf("Playbook build error: %v", err)
			return
		}
		log.Printf("Playbook: %d archetype entries ready", len(entries))
	}()

	// ── API ───────────────────────────────────────────────────────────────────
	store := api.NewStore(sellers, db, cfg.MLServiceURL, cfg.TranscriptsFile)
	log.Printf("Pattern alerts detected: %d", len(store.Patterns))

	r := api.SetupRouter(store)
	log.Printf("SellerPulse API listening on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func loadSellers(path string) ([]models.Seller, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	var raw []models.RawSeller
	if err := json.NewDecoder(f).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}

	// Spread renewal dates realistically — high-risk sellers tend to renew sooner
	// Two sellers intentionally share a date (45, 90) to mimic real cohort overlap
	renewalDaysTable := []int{82, 85, 88, 84, 87, 80, 90, 92, 95, 110, 105, 88, 120, 130, 85, 145, 155, 90, 180, 92}

	now := time.Now().UTC()
	sellers := make([]models.Seller, len(raw))
	for i, r := range raw {
		cause := classifier.ChurnCause(r)
		days := renewalDaysTable[i%len(renewalDaysTable)]
		sellers[i] = models.Seller{
			RawSeller:        r,
			RenewalDate:      now.AddDate(0, 0, days).Format("2006-01-02"),
			DaysToRenewal:    days,
			RiskScore:        scorer.CalcRisk(r),
			ChurnCause:       cause,
			ChurnCauseReason: classifier.ChurnCauseReason(r, cause),
			Archetype:        classifier.Archetype(r),
		}
	}

	// Sort by risk desc, then ID asc
	for i := 0; i < len(sellers)-1; i++ {
		for j := i + 1; j < len(sellers); j++ {
			if sellers[j].RiskScore > sellers[i].RiskScore {
				sellers[i], sellers[j] = sellers[j], sellers[i]
			}
		}
	}

	return sellers, nil
}
