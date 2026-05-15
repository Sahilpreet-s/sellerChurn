package audio

import (
	"fmt"
	"time"

	"sellerpulse/internal/llm"
	"sellerpulse/internal/models"
)

// ProcessTranscript runs the pipeline: raw transcript → Gemini extraction → CallInsight.
func ProcessTranscript(transcript, sellerID, agent string) (models.CallInsight, error) {
	insight, err := llm.ExtractMerpInsight(
		"CALL TRANSCRIPT:\n"+transcript,
		sellerID, agent,
	)
	if err != nil {
		return models.CallInsight{}, fmt.Errorf("extract: %w", err)
	}
	insight.Source = "AUDIO"
	insight.ID = fmt.Sprintf("AUDIO-%s-%d", sellerID, time.Now().Unix())
	return insight, nil
}
