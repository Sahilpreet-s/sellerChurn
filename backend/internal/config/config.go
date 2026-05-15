package config

import (
	"bufio"
	"os"
	"strings"
)

type Config struct {
	Port           string
	GeminiKey      string
	DeepgramKey    string
	MLServiceURL   string
	DBPath         string
	SellersFile    string
	SampleCallsDir string
}

func Load() Config {
	loadDotEnv(".env")
	return Config{
		Port:           getEnv("PORT", "8080"),
		GeminiKey:      getEnv("GEMINI_API_KEY", ""),
		DeepgramKey:    getEnv("DEEPGRAM_API_KEY", ""),
		MLServiceURL:   getEnv("ML_SERVICE_URL", "http://localhost:8001"),
		DBPath:         getEnv("DB_PATH", "./data/sellerpulse.db"),
		SellersFile:    getEnv("SELLERS_FILE", "./data/sellers.json"),
		SampleCallsDir: getEnv("SAMPLE_CALLS_DIR", "./data/sample_calls"),
	}
}

// loadDotEnv reads key=value pairs from a .env file and sets them as env vars.
// Skips lines that are comments or already set in the environment.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
