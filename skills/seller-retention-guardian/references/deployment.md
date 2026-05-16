# Deployment Guide — Environment, Rate Limits, SLA, Monitoring

## Service Architecture

Three Docker services defined in `docker-compose.yml`:

```
ml (Python/FastAPI) :8001
  ↑ depends on
backend (Go/Gin)    :8080   → reads/writes /app/data/sellerpulse.db
  ↑ depends on              → calls http://ml:8001 for XGBoost predictions
frontend (React)    :5173   → proxies /api/v1/* to backend:8080

Shared volume: db_data → mounted at /data in both ml and backend containers
```

## Docker Compose — Start/Stop

```bash
# Full stack (recommended for demo)
docker compose up --build

# Rebuild only the ml container (after agent.py changes)
docker compose up --build -d ml

# View logs for a specific service
docker compose logs -f ml
docker compose logs -f backend

# Stop everything
docker compose down
```

## Required Environment Variables

Create `backend/.env` before running. Both the `backend` and `ml` containers load this file via `env_file: - ./backend/.env` in docker-compose.yml.

```bash
# backend/.env

# ── Required ──────────────────────────────────────────────────────────────────
GEMINI_API_KEY=<your-gemini-api-key>
# Get from: https://aistudio.google.com/app/apikey
# Free tier: 15 req/min, 1M tokens/day

DEEPGRAM_API_KEY=<your-deepgram-api-key>
# Get from: https://console.deepgram.com
# Required ONLY for audio-to-transcript pipeline (POST /api/v1/audio/upload)
# If not set: audio upload returns 500; all other endpoints work normally

# ── Optional ──────────────────────────────────────────────────────────────────
PORT=8080                           # backend HTTP port (default: 8080)
ML_SERVICE_URL=http://ml:8001       # overridden by Docker Compose; use http://localhost:8001 for local dev
DB_PATH=./data/sellerpulse.db       # relative to backend workdir (/app); resolves to /app/data/sellerpulse.db
SELLERS_FILE=./data/sellers.json    # seed seller data
TRANSCRIPTS_FILE=./data/transcripts.json  # seed call transcripts (optional)
SAMPLE_CALLS_DIR=./data/sample_calls      # audio files for STT demo (optional)
```

**Critical Docker Compose wiring:** The `env_file: - ./backend/.env` must be present in BOTH the `backend` AND `ml` service blocks. If it is missing from `ml`, `GEMINI_API_KEY` will be empty in the Python container, and all Tier 3 LLM calls in `agent.py` will return HTTP 403 Forbidden.

```yaml
# docker-compose.yml — correct wiring
services:
  ml:
    build:
      context: ./ml
    ports:
      - "8001:8001"
    volumes:
      - db_data:/data
    env_file:
      - ./backend/.env        # ← required for GEMINI_API_KEY in agent.py

  backend:
    build:
      context: ./backend
    ports:
      - "8080:8080"
    volumes:
      - db_data:/data
    env_file:
      - ./backend/.env
    environment:
      - ML_SERVICE_URL=http://ml:8001
    depends_on:
      - ml
```

## Database Paths

Two SQLite files exist in the running system — they are NOT the same file:

| Path | Owner | Contents |
|---|---|---|
| `/app/data/sellerpulse.db` | Go backend (authoritative) | outcomes, playbook_entries, seller_computed, call_insights |
| `/data/sellerpulse.db` | Docker volume (shared) | feature_snapshots (seeded by ml/seed_data.py on startup) |

The Go backend resolves `DB_PATH=./data/sellerpulse.db` relative to its WORKDIR (`/app`), giving `/app/data/sellerpulse.db`. The ML service seeds training data to the volume path `/data/sellerpulse.db`. These files are currently separate; to unify them, set `DB_PATH=/data/sellerpulse.db` in `.env` and ensure the backend container also mounts the `db_data` volume at `/data` (it already does via `volumes: - db_data:/data`).

## Local Development (without Docker)

```bash
# Terminal 1 — ML service
cd ml
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
DB_PATH=../backend/data/sellerpulse.db uvicorn service:app --port 8001

# Terminal 2 — Backend
cd backend
# Ensure backend/.env exists with GEMINI_API_KEY
go run ./cmd/server

# Terminal 3 — Frontend
cd frontend
bun install
bun run dev   # Vite dev server at http://localhost:5173, proxies /api/v1 to :8080
```

## Gemini Rate Limits and Batch Timing

| Tier | RPM | TPD |
|---|---|---|
| Free | 15 req/min | 1M tokens/day |
| Paid | 1000+ req/min | Unlimited |

The nightly batch uses a **13-second inter-seller delay** (`batchDelay = 13 * time.Second` in `batch/nightly.go`). This keeps the batch within the free-tier 5 req/min limit (60s / 5 = 12s minimum; 13s adds a 1-second margin).

**Practical batch timing:**
- 100 sellers with 10% Tier 1 inactive: 90 LLM calls × 13s = ~20 minutes
- 1000 sellers with 10% Tier 1 inactive: 900 LLM calls × 13s = ~3.25 hours

For production use with >200 sellers, a paid Gemini API key is strongly recommended. With 1000 RPM, the 13s delay can be reduced to 0.1s, bringing 1000-seller batch time to under 2 minutes.

## SLA Table

| Endpoint | Method | Target P95 | Typical | Notes |
|---|---|---|---|---|
| `/api/v1/sellers` | GET | 200ms | 30ms | In-memory join of seller JSON + computed states |
| `/api/v1/sellers/:id` | GET | 200ms | 40ms | Single seller; includes computed state + call insights |
| `/api/v1/sellers/:id/outcome` | POST | 500ms | 100ms | SQLite write + feature snapshot build |
| `/agent/analyze` | POST | 30s | 18s | XGBoost <1ms + Gemini classify+guide ~15–20s |
| `/agent/analyze/stream` | POST | First event <3s | <1s | SSE; XGBoost node fires in <1ms |
| `/api/v1/batch/nightly` | POST | varies | 13s/seller | Gemini rate-limited |
| `/api/v1/ml/retrain` | POST | 60s | 10s | Reads labeled snapshots, trains, saves if AUC improves |
| `/api/v1/playbook` | GET | 100ms | 20ms | SQLite read; rebuilt asynchronously |
| `/api/v1/playbook/rebuild` | POST | 120s | 40s | Gemini call per archetype (max 6 archetypes) |

## Monitoring

### Drift Detection

Run weekly after the nightly batch completes:

1. Compare the mean rule-based risk score (`riskScore` from `scorer.go`) against the mean XGBoost-derived risk score (`mlChurnProb × 92`) for the same cohort.
2. If the average divergence exceeds 15 points, the XGBoost model may be operating on a shifted feature distribution — trigger retrain via `POST /api/v1/ml/retrain`.
3. If AUC on newly labeled outcomes (from `feature_snapshots` table) drops more than 0.05 below the baseline AUC stored in `ml/model_stats.json`, review the seed data distribution in `ml/seed_data.py` and regenerate.

### Retrain Trigger

```bash
curl -X POST http://localhost:8080/api/v1/ml/retrain
# Response: {"auc": 0.77, "trainingExamples": 523, "swapped": true, "topFeatures": [...]}
```

The model is replaced only if the new AUC exceeds the current model's AUC by >0.01 (anti-regression guard in `trainer.py`).

### Playbook Health

The playbook is rebuilt automatically at the end of every nightly batch run and after every 10 logged outcomes. If the playbook endpoint returns an empty array or shows stale synthesis dates, trigger a manual rebuild:

```bash
curl -X POST http://localhost:8080/api/v1/playbook/rebuild
```

Minimum 3 outcomes per archetype are required for Gemini synthesis. If a new archetype has fewer than 3 outcomes, it will not appear in the playbook until threshold is met.

### Health Check

```bash
# Backend alive
curl http://localhost:8080/api/v1/sellers | python -m json.tool | head -20

# ML service alive
curl http://localhost:8001/health

# Check model stats
curl http://localhost:8001/model/stats
```

## Non-Goals and Known Limitations

- **No authentication:** All API endpoints are unauthenticated. For production, add JWT middleware to the Go backend.
- **SQLite concurrency:** Not suitable for concurrent writes from multiple backend instances. Single-instance deployment only. Upgrade to PostgreSQL if horizontal scaling is needed.
- **MERP endpoint missing:** The frontend has a helper for `/merp/extract` but the backend only exposes JSON transcript processing at `POST /api/v1/audio/upload`. The `/merp/extract` route does not exist and will return 404.
- **Seed DB is synthetic:** The XGBoost model is trained on 500 synthetic examples with intentional overlap distributions (target AUC 0.74–0.80). Production accuracy requires real labeled outcomes logged via `POST /api/v1/sellers/:id/outcome`.
- **Demo mode uses test seller IDs:** The live demo page (at `/demo`) uses synthetic seller IDs (S-20001 through S-20010). Entering a real IndiaMART GLID requires the backend to have that seller's data in `sellers.json`.
