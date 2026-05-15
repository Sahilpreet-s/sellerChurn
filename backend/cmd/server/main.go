package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"

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

	sellers := make([]models.Seller, len(raw))
	for i, r := range raw {
		cause := classifier.ChurnCause(r)
		sellers[i] = models.Seller{
			RawSeller:        r,
			RenewalDate:      "2026-08-13",
			DaysToRenewal:    90,
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
