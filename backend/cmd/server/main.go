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

	// ── API ───────────────────────────────────────────────────────────────────
	store := api.NewStore(sellers, db, cfg.MLServiceURL)
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
	renewalDaysTable := []int{38, 45, 52, 62, 45, 68, 75, 84, 90, 110, 90, 72, 120, 135, 60, 148, 155, 42, 180, 88}

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
