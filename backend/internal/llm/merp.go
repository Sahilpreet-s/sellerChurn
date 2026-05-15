package llm

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"sellerpulse/internal/models"
)

const merpSystem = `You extract structured data from IndiaMART sales exec CRM notes (called MERP notes).
These are brief notes written by sales execs after calls or meetings with sellers.

Return ONLY valid JSON with these fields:
{
  "summary": "1-2 sentence plain-English summary of the interaction",
  "sentiment": "Positive" | "Neutral" | "Negative",
  "issues": ["array of specific pain points raised, e.g. 'BL filters not working'"],
  "quote": "verbatim seller complaint if present, else empty string",
  "disposition": "Willing" | "Skeptical" | "Hostile",
  "competitorMentioned": "competitor name if mentioned else empty string",
  "commitmentByExec": "what the exec promised to do, else empty string",
  "durationMin": estimated call duration in minutes as integer (default 10 if unknown)
}`

type merpExtraction struct {
	Summary             string   `json:"summary"`
	Sentiment           string   `json:"sentiment"`
	Issues              []string `json:"issues"`
	Quote               string   `json:"quote"`
	Disposition         string   `json:"disposition"`
	CompetitorMentioned string   `json:"competitorMentioned"`
	CommitmentByExec    string   `json:"commitmentByExec"`
	DurationMin         int      `json:"durationMin"`
}

// ExtractMerpInsight parses a raw MERP CRM note into a structured CallInsight.
func ExtractMerpInsight(rawNote, sellerID, agent string) (models.CallInsight, error) {
	raw, err := Call(merpSystem, "MERP NOTE:\n"+rawNote, 600)
	if err != nil {
		return models.CallInsight{}, fmt.Errorf("llm call: %w", err)
	}

	raw = strings.TrimPrefix(strings.TrimSpace(raw), "```json")
	raw = strings.TrimSuffix(raw, "```")
	raw = strings.TrimSpace(raw)

	var ex merpExtraction
	if err := json.Unmarshal([]byte(raw), &ex); err != nil {
		return models.CallInsight{}, fmt.Errorf("parse merp JSON: %w", err)
	}

	dur := ex.DurationMin
	if dur <= 0 {
		dur = 10
	}

	return models.CallInsight{
		ID:                  fmt.Sprintf("MERP-%s-%d", sellerID, time.Now().Unix()),
		SellerID:            sellerID,
		Date:                time.Now().Format("2006-01-02"),
		DurationMin:         dur,
		Agent:               agent,
		Sentiment:           ex.Sentiment,
		Summary:             ex.Summary,
		Issues:              ex.Issues,
		Quote:               ex.Quote,
		Disposition:         ex.Disposition,
		CompetitorMentioned: ex.CompetitorMentioned,
		CommitmentByExec:    ex.CommitmentByExec,
		Source:              "MERP",
	}, nil
}
