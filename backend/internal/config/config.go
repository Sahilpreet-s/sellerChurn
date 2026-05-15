package config

import (
	"os"
)

type Config struct {
	Port           string
	AnthropicKey   string
	DeepgramKey    string
	MLServiceURL   string
	DBPath         string
	SellersFile    string
	SampleCallsDir string
}

func Load() Config {
	return Config{
		Port:           getEnv("PORT", "8080"),
		AnthropicKey:   getEnv("ANTHROPIC_API_KEY", ""),
		DeepgramKey:    getEnv("DEEPGRAM_API_KEY", ""),
		MLServiceURL:   getEnv("ML_SERVICE_URL", "http://localhost:8001"),
		DBPath:         getEnv("DB_PATH", "./data/sellerpulse.db"),
		SellersFile:    getEnv("SELLERS_FILE", "./data/sellers.json"),
		SampleCallsDir: getEnv("SAMPLE_CALLS_DIR", "./data/sample_calls"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
