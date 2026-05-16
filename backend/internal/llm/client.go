package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// ── Gemini native ─────────────────────────────────────────────────────────────

const geminiModel = "gemini-2.5-flash"
const geminiBase = "https://generativelanguage.googleapis.com/v1beta/models/"

type geminiPart struct {
	Text string `json:"text"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiRequest struct {
	SystemInstruction *geminiContent `json:"system_instruction,omitempty"`
	Contents          []geminiContent `json:"contents"`
	GenerationConfig  map[string]any  `json:"generationConfig,omitempty"`
}

type geminiResponse struct {
	Candidates []struct {
		Content struct {
			Parts []geminiPart `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
}

// ── OpenAI-compatible (OpenRouter / LiteLLM) ──────────────────────────────────

const openrouterBase  = "https://openrouter.ai/api/v1"
const openrouterModel = "google/gemini-2.5-flash"

type oaiMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type oaiRequest struct {
	Model          string      `json:"model"`
	Messages       []oaiMessage `json:"messages"`
	MaxTokens      int         `json:"max_tokens"`
	ResponseFormat map[string]string `json:"response_format,omitempty"`
}

type oaiResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// ── Provider router ───────────────────────────────────────────────────────────

// Call sends a single-turn LLM request and returns the text response.
// Provider is selected by LLM_PROVIDER env var: "gemini" (default), "openrouter", "litellm".
func Call(system, user string, maxTokens int) (string, error) {
	switch strings.ToLower(os.Getenv("LLM_PROVIDER")) {
	case "openrouter":
		model := os.Getenv("LLM_MODEL")
		if model == "" {
			model = openrouterModel
		}
		key := os.Getenv("OPENROUTER_API_KEY")
		if key == "" {
			return "", fmt.Errorf("OPENROUTER_API_KEY not set")
		}
		return callOpenAICompat(system, user, maxTokens, openrouterBase, model, key)

	case "litellm":
		base := strings.TrimRight(os.Getenv("LITELLM_BASE_URL"), "/")
		if base == "" {
			base = "https://imllm.intermesh.net"
		}
		model := os.Getenv("LLM_MODEL")
		if model == "" {
			model = "google/gemini-2.5-flash-lite"
		}
		key := os.Getenv("LITELLM_API_KEY") // may be empty if proxy handles auth
		return callOpenAICompat(system, user, maxTokens, base+"/v1", model, key)

	default:
		return callGemini(system, user, maxTokens)
	}
}

// ── Provider implementations ──────────────────────────────────────────────────

func callGemini(system, user string, maxTokens int) (string, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("GEMINI_API_KEY not set")
	}

	reqBody := geminiRequest{
		Contents: []geminiContent{
			{Role: "user", Parts: []geminiPart{{Text: user}}},
		},
		GenerationConfig: map[string]any{
			"maxOutputTokens":  maxTokens,
			"responseMimeType": "application/json",
		},
	}
	if system != "" {
		reqBody.SystemInstruction = &geminiContent{
			Parts: []geminiPart{{Text: system}},
		}
	}

	body, _ := json.Marshal(reqBody)
	url := geminiBase + geminiModel + ":generateContent?key=" + apiKey
	req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("gemini request: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("gemini %d: %s", resp.StatusCode, raw)
	}

	var out geminiResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("parse gemini response: %w", err)
	}
	if len(out.Candidates) == 0 || len(out.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("empty response from gemini")
	}
	return out.Candidates[0].Content.Parts[0].Text, nil
}

func callOpenAICompat(system, user string, maxTokens int, baseURL, model, apiKey string) (string, error) {
	messages := []oaiMessage{}
	if system != "" {
		messages = append(messages, oaiMessage{Role: "system", Content: system})
	}
	messages = append(messages, oaiMessage{Role: "user", Content: user})

	reqBody := oaiRequest{
		Model:     model,
		Messages:  messages,
		MaxTokens: maxTokens,
		ResponseFormat: map[string]string{"type": "json_object"},
	}

	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", baseURL+"/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("llm request: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("llm %d: %s", resp.StatusCode, raw)
	}

	var out oaiResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("parse llm response: %w", err)
	}
	if out.Error != nil {
		return "", fmt.Errorf("llm error: %s", out.Error.Message)
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("empty response from llm")
	}
	return out.Choices[0].Message.Content, nil
}
