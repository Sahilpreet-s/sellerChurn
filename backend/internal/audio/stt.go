package audio

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"sellerpulse/internal/llm"
	"sellerpulse/internal/models"
)

// mockTranscripts maps sample filename → pre-written transcript for demo fallback.
var mockTranscripts = map[string]string{
	"call_vikram_singh.wav": `Exec: Hi Vikram, calling about your renewal in 90 days. How has the experience been?
Seller: Not good honestly. I've been getting calls from TradeIndia saying they'll give me same features at 30% less. My BL consumption is down because the leads are all retail buyers, not industrial purchasers. I'm seriously considering switching.
Exec: I understand your frustration. We've had issues with the BL filter for electrical equipment. I'll escalate this today.
Seller: I need to see results, not promises. This has been going on for 2 months.`,

	"call_deepa_krishnan.wav": `Exec: Hi Deepa, this is Anita from IndiaMART. How are things going?
Seller: Not well at all. I joined 3 months ago on the Catalog plan and I haven't got a single serious buyer. I'm spending money every month with zero orders. This is very disappointing.
Exec: I'm sorry to hear that. Let me look at your catalog listing — it may not be indexed properly for packaged water searches.
Seller: Please fix it. Otherwise I'm not renewing. What am I paying for?`,

	"call_rajesh_kumar.wav": `Exec: Hello Rajesh, checking in before your renewal.
Seller: I got a call from IndiaTrade last week. They're offering 3 months free trial. Why would I pay IndiaMART when I can try something else for free?
Exec: Rajesh, IndiaMART has 10 crore buyers — IndiaTrade cannot match that reach. But I hear your concern about ROI.
Seller: Show me the orders then. I've had maybe 5 serious enquiries in 3 months on Catalog.`,
}

type deepgramResponse struct {
	Results struct {
		Channels []struct {
			Alternatives []struct {
				Transcript string `json:"transcript"`
			} `json:"alternatives"`
		} `json:"channels"`
	} `json:"results"`
}

// Transcribe sends a WAV/MP3 to Deepgram and returns the transcript.
// Falls back to mock transcript if the file matches a known sample name.
func Transcribe(audioData []byte, filename string) (string, error) {
	// Check mock fallback first (for demo reliability)
	if transcript, ok := mockTranscripts[filename]; ok {
		return transcript, nil
	}

	apiKey := os.Getenv("DEEPGRAM_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("DEEPGRAM_API_KEY not set and no mock transcript for %s", filename)
	}

	req, _ := http.NewRequest("POST",
		"https://api.deepgram.com/v1/listen?model=nova-2&language=en-IN&punctuate=true&diarize=true",
		bytes.NewReader(audioData))
	req.Header.Set("Authorization", "Token "+apiKey)
	req.Header.Set("Content-Type", "audio/wav")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("deepgram request: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("deepgram %d: %s", resp.StatusCode, raw)
	}

	var dgResp deepgramResponse
	if err := json.Unmarshal(raw, &dgResp); err != nil {
		return "", err
	}
	if len(dgResp.Results.Channels) == 0 || len(dgResp.Results.Channels[0].Alternatives) == 0 {
		return "", fmt.Errorf("empty transcript from deepgram")
	}
	return dgResp.Results.Channels[0].Alternatives[0].Transcript, nil
}

// ProcessAudio runs the full pipeline: audio → STT → LLM extraction → CallInsight.
func ProcessAudio(audioData []byte, filename, sellerID, agent string) (models.CallInsight, error) {
	transcript, err := Transcribe(audioData, filename)
	if err != nil {
		return models.CallInsight{}, fmt.Errorf("transcribe: %w", err)
	}

	// Reuse the MERP extractor — transcript is treated as a rich note
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
