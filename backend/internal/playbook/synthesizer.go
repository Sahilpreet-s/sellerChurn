// Package playbook synthesizes retention playbook entries from historical outcomes using Gemini.
// Runs as a batch job — not in the hot path of any request.
package playbook

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"sellerpulse/internal/llm"
	"sellerpulse/internal/models"
	"sellerpulse/internal/outcome"
)

// synthesisDelay is the pause between Gemini calls to stay under the free-tier 5 req/min limit.
const synthesisDelay = 13 * time.Second

const minSampleSize = 3

const synthesisSystem = `You are a sales analytics AI for IndiaMART, India's largest B2B marketplace.
Analyze KAM retention call outcomes and extract actionable patterns.
Output ONLY valid JSON matching the exact structure requested — no explanation, no markdown.`

// Synthesize reads all labeled outcomes from the store, groups by archetype,
// calls Gemini for each group, and saves the resulting playbook entries.
// Returns the entries that were successfully built.
func Synthesize(store *outcome.Store) ([]models.PlaybookEntry, error) {
	rows, err := store.GetOutcomesForSynthesis()
	if err != nil {
		return nil, fmt.Errorf("load outcomes: %w", err)
	}

	// Group by archetype
	grouped := make(map[string][]outcome.RawOutcomeRow)
	for _, r := range rows {
		if r.Archetype != "" {
			grouped[r.Archetype] = append(grouped[r.Archetype], r)
		}
	}

	// Collect archetype keys for deterministic ordering (map iteration is random)
	archetypes := make([]string, 0, len(grouped))
	for a := range grouped {
		archetypes = append(archetypes, a)
	}

	var results []models.PlaybookEntry
	for i, archetype := range archetypes {
		cases := grouped[archetype]
		if len(cases) < minSampleSize {
			fmt.Printf("[playbook] %s: only %d cases, skipping (need %d)\n", archetype, len(cases), minSampleSize)
			continue
		}

		// Rate-limit: stay under 5 requests/min on Gemini free tier
		if i > 0 {
			fmt.Printf("[playbook] waiting %v before next synthesis...\n", synthesisDelay)
			time.Sleep(synthesisDelay)
		}

		// Retry once on 429 — the per-minute window resets after the suggested delay
		var entry *models.PlaybookEntry
		var err error
		for attempt := 0; attempt < 2; attempt++ {
			entry, err = synthesizeArchetype(archetype, cases)
			if err == nil {
				break
			}
			if attempt == 0 && isRateLimitError(err) {
				fmt.Printf("[playbook] %s: rate limited, waiting 65s then retrying...\n", archetype)
				time.Sleep(65 * time.Second)
				continue
			}
			break
		}
		if err != nil {
			fmt.Printf("[playbook] warn: synthesize %s: %v\n", archetype, err)
			continue
		}

		if err := store.SavePlaybookEntry(*entry); err != nil {
			fmt.Printf("[playbook] warn: save %s: %v\n", archetype, err)
			continue
		}
		fmt.Printf("[playbook] %s: %d cases → %.0f%% retention rate\n", archetype, len(cases), entry.RetentionRate*100)
		results = append(results, *entry)
	}
	return results, nil
}

func isRateLimitError(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "429") || strings.Contains(err.Error(), "RESOURCE_EXHAUSTED"))
}

func synthesizeArchetype(archetype string, cases []outcome.RawOutcomeRow) (*models.PlaybookEntry, error) {
	resolved := 0
	for _, c := range cases {
		if c.Outcome == "Resolved" {
			resolved++
		}
	}
	retentionRate := float64(resolved) / float64(len(cases))

	var sb strings.Builder
	for i, c := range cases {
		reasons := strings.Join(c.ChurnReasons, ", ")
		if reasons == "" {
			reasons = "unspecified"
		}
		commitment := c.ExecCommitment
		if commitment == "" {
			commitment = "none recorded"
		}
		disp := c.Disposition
		if disp == "" {
			disp = "unknown"
		}
		sb.WriteString(fmt.Sprintf("%d. [%s | Reasons: %s | Commitment: \"%s\" | Result: %s]\n",
			i+1, disp, reasons, commitment, c.Outcome))
	}

	userPrompt := fmt.Sprintf(`Analyze these %d retention call outcomes for sellers classified as "%s" (overall retention rate: %.0f%%).

OUTCOMES:
%s
Based on patterns in this outcome data, return a JSON object with exactly these keys:
{
  "winningApproaches": ["2-4 specific approaches or exec commitments that correlated with Resolved outcomes"],
  "failedApproaches": ["2-3 approaches that appeared in Churned outcomes or showed no effect"],
  "keyInsight": "single most important lesson for a KAM before calling a %s seller",
  "doNotDo": ["2-3 specific mistakes to avoid with this archetype"]
}`,
		len(cases), archetype, retentionRate*100, sb.String(), archetype)

	raw, err := llm.Call(synthesisSystem, userPrompt, 2048)
	if err != nil {
		return nil, err
	}

	var synthesis struct {
		WinningApproaches []string `json:"winningApproaches"`
		FailedApproaches  []string `json:"failedApproaches"`
		KeyInsight        string   `json:"keyInsight"`
		DoNotDo           []string `json:"doNotDo"`
	}
	if err := json.Unmarshal([]byte(raw), &synthesis); err != nil {
		return nil, fmt.Errorf("parse synthesis JSON: %w — raw: %s", err, raw)
	}

	return &models.PlaybookEntry{
		Archetype:         archetype,
		SampleSize:        len(cases),
		RetentionRate:     retentionRate,
		WinningApproaches: synthesis.WinningApproaches,
		FailedApproaches:  synthesis.FailedApproaches,
		KeyInsight:        synthesis.KeyInsight,
		DoNotDo:           synthesis.DoNotDo,
		UpdatedAt:         time.Now().UTC().Format(time.RFC3339),
	}, nil
}
