# Seller Retention Guardian

Seller Retention Guardian is a full-stack prototype for IndiaMART-style seller retention teams. It identifies paid sellers who may churn before renewal, explains the likely reason, and gives Key Account Managers a focused workspace for triage, call review, retention actions, and outcome logging.

The repo now contains three cooperating services:

- React/TanStack Start frontend for the dashboard and seller detail workflows.
- Go/Gin backend for seller scoring, enrichment, REST APIs, SQLite persistence, pattern alerts, and Gemini-powered guide generation.
- Python/FastAPI ML service for XGBoost churn probability, model stats, and training examples.

## Current Product Surface

- `/` - animated product landing page.
- `/dashboard` - operational dashboard with three views:
  - `?view=churn` for behavioural, external, and mixed churn risks.
  - `?view=platform` for sellers whose risk is driven by platform or lead-fit issues.
  - `?view=upsell` for lower-risk sellers that may be upgrade candidates.
- `/seller/$sellerId` - seller detail page with:
  - risk, renewal, package, ARR, churn cause, and archetype summary.
  - past behaviour charts for login, BL consumption, PNS pickup, LMS reply, retail BL share, catalog score, CQS, BLNI, and active days.
  - six-month IndiaMART leads chart.
  - "Why flagged" explanation.
  - call insights from seed data, uploaded transcripts, or nightly batch output.
  - rule-based fallback guide plus AI retention guide generation.
  - outcome logging that feeds SQLite and the ML training corpus.

## Architecture

```text
Frontend (TanStack Start, React 19, Vite)
  browser/SSR API client
        |
        v
Go API (Gin, :8080, /api/v1)
  - loads seeded sellers
  - calculates rule risk and churn cause
  - stores outcomes, call insights, computed guides in SQLite
  - calls Gemini for retention guides and transcript insight extraction
  - proxies ML prediction and retraining calls
        |
        +---- SQLite: backend/data/sellerpulse.db
        |
        v
Python ML Service (FastAPI, :8001)
  - seeds synthetic feature snapshots
  - trains XGBoost
  - serves churn probability and model stats
```

## Tech Stack

| Area | Stack |
| --- | --- |
| Frontend | TanStack Start, React 19, TypeScript, Vite, Tailwind CSS v4 |
| UI | shadcn/ui primitives, Radix UI, Recharts, Lucide icons, Framer Motion |
| Backend | Go 1.21, Gin, CORS middleware, modernc SQLite |
| AI | Gemini 2.5 Flash via `GEMINI_API_KEY` |
| ML | Python 3.11, FastAPI, XGBoost, scikit-learn, pandas, numpy, joblib |
| Persistence | SQLite database shared by backend and ML service |
| Dev/Deploy | Bun frontend workflow, Dockerfiles, Docker Compose |

## Repository Layout

```text
.
|-- README.md
|-- BACKEND.md                 # deeper backend architecture notes
|-- docker-compose.yml          # three-service local stack
|-- start.sh                    # starts ML, Go API, and frontend on a Unix shell
|-- backend/
|   |-- cmd/server/main.go      # Go API entry point
|   |-- internal/api/           # Gin router and handlers
|   |-- internal/audio/         # transcript-to-call-insight pipeline
|   |-- internal/batch/         # nightly enrichment pipeline
|   |-- internal/classifier/    # churn cause and archetype rules
|   |-- internal/config/        # env loading
|   |-- internal/llm/           # Gemini client, guide, MERP, combined prompts
|   |-- internal/models/        # shared response/data types
|   |-- internal/outcome/       # SQLite stores for outcomes, computed state, playbook
|   |-- internal/patterns/      # systemic alert detection
|   |-- internal/playbook/      # archetype playbook synthesis from outcomes
|   |-- internal/scorer/        # deterministic risk scoring
|   |-- data/                   # seeded sellers, transcripts, local SQLite DB
|   |-- openapi.yaml            # API contract
|   `-- Dockerfile
|-- frontend/
|   |-- src/routes/             # TanStack file routes
|   |-- src/lib/api.ts          # frontend API client
|   |-- src/lib/mock-sellers.ts # TypeScript types and display metadata
|   |-- src/components/ui/      # shadcn/ui components
|   |-- src/styles.css          # Tailwind v4 tokens and app styling
|   |-- vite.config.ts          # TanStack/Lovable config plus API proxy
|   |-- package.json
|   `-- Dockerfile
`-- ml/
    |-- service.py              # FastAPI app
    |-- routes.py               # health/stats/predict/features/outcomes/train
    |-- trainer.py              # XGBoost training and prediction
    |-- seed_data.py            # 500 synthetic labeled examples
    |-- db.py                   # SQLite helpers
    |-- model.joblib
    |-- model_stats.json
    `-- Dockerfile
```

Generated or local folders such as `frontend/node_modules`, `ml/.venv`, `ml/__pycache__`, and `frontend/.tanstack` are not part of the application source.

## Data Model

The backend serves enriched seller objects built from `backend/data/sellers.json`. The seed file currently contains 20 sellers, with package types such as `MDC`, `TrustSEAL`, `Maximiser`, `IM Star`, and `IM Leader`.

Core seller fields:

```ts
type Seller = {
  id: string;
  name: string;
  company: string;
  city: string;
  category: string;
  packageType: string;
  arr: number;
  status: "Pending" | "Resolved";
  priorChurn: boolean;
  renewalDate: string;
  daysToRenewal: number;
  riskScore: number;
  churnCause: "BEHAVIORAL" | "PLATFORM_FAILURE" | "EXTERNAL" | "MIXED";
  churnCauseReason: string;
  archetype: string;
  mlChurnProb: number;
  mlTopFeatures: string[];
  metrics: SellerMetrics;
  leadsHistory: LeadsMonthData[];
  callInsights: CallInsight[];
};
```

SQLite stores runtime enrichment in:

- `outcomes` - KAM call outcomes and feature snapshots.
- `call_insights` - extracted call/MERP/transcript insights.
- `seller_computed` - nightly or on-demand computed risk, guide JSON, ML probability, and top features.
- `playbook_entries` - synthesized archetype playbooks.
- `feature_snapshots` - ML training rows seeded by the Python service and extended by real outcomes.

## Risk Scoring

Rule-based scoring lives in `backend/internal/scorer/scorer.go` and mirrors the frontend display bands:

| Signal | Current weight | Drop weight |
| --- | ---: | ---: |
| Login percent | 0.15 | 0.35 |
| BL consumption percent | 0.15 | 0.35 |
| PNS pickup percent | 0.12 | 0.30 |
| LMS reply percent | 0.12 | 0.30 |
| Retail BL recommended percent | 0.12 | - |
| Catalog score | 0.06 | - |
| Content Quality Score | 0.08 | - |

Additional logic:

- Prior churn multiplies the score by 1.30.
- Construction/scaffolding sellers in Mar-May get a 0.85 seasonal dampener.
- Risk bands are `High >= 55`, `Medium >= 30`, and `Low < 30`.

Churn cause and archetype rules live in `backend/internal/classifier/cause.go`. Pattern alerts live in `backend/internal/patterns/detector.go`.

## API Summary

All backend endpoints are under `http://localhost:8080/api/v1`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/sellers` | List sellers with optional `risk`, `status`, `package`, and `q` filters |
| `GET` | `/sellers/:id` | Get one seller with DB call insights and computed state merged in |
| `POST` | `/sellers/:id/outcome` | Log retention outcome and feature snapshot |
| `POST` | `/sellers/:id/guide` | Return cached or newly generated AI retention guide |
| `POST` | `/audio/upload` | Process a transcript JSON payload into a saved call insight |
| `GET` | `/patterns` | Return systemic pattern alerts |
| `GET` | `/stats` | Return portfolio risk counts and ARR at risk |
| `GET` | `/playbook` | Return synthesized archetype playbook entries |
| `POST` | `/playbook/rebuild` | Rebuild playbook entries from logged outcomes |
| `GET` | `/ml/prediction/:id` | Proxy a seller prediction from the ML service |
| `GET` | `/ml/stats` | Proxy model stats from the ML service |
| `POST` | `/ml/train` | Trigger ML retraining |
| `POST` | `/batch/nightly` | Run the nightly enrichment pipeline |

The full API contract is in `backend/openapi.yaml`.

ML service endpoints are under `http://localhost:8001`:

- `GET /health`
- `GET /stats`
- `GET /predict/{seller_id}`
- `POST /features`
- `POST /outcomes`
- `POST /train`

## Environment Variables

Backend defaults are loaded in `backend/internal/config/config.go`.

```env
PORT=8080
GEMINI_API_KEY=your-gemini-api-key
ML_SERVICE_URL=http://localhost:8001
DB_PATH=./data/sellerpulse.db
SELLERS_FILE=./data/sellers.json
TRANSCRIPTS_FILE=./data/transcripts.json
SAMPLE_CALLS_DIR=./data/sample_calls
```

Frontend SSR can use:

```env
VITE_API_URL=http://localhost:8080/api/v1
```

ML service defaults:

```env
DB_PATH=../backend/data/sellerpulse.db
MODEL_PATH=./model.joblib
STATS_PATH=./model_stats.json
```

Do not commit real API keys. Keep local secrets in ignored `.env` files or your shell environment.

## Local Development

### Option 1: Docker Compose

```bash
docker compose up --build
```

Expected services:

- Frontend: `http://localhost:5173`
- Go API: `http://localhost:8080/api/v1/sellers`
- ML service: `http://localhost:8001/stats`

### Option 2: Run Services Manually

Start the ML service:

```bash
cd ml
python -m venv .venv
.venv/bin/pip install -r requirements.txt
DB_PATH=../backend/data/sellerpulse.db .venv/bin/python service.py
```

Start the Go API:

```bash
cd backend
go mod download
PORT=8080 ML_SERVICE_URL=http://localhost:8001 go run ./cmd/server
```

Start the frontend:

```bash
cd frontend
bun install
bun run dev
```

The frontend API client uses `VITE_API_URL` during SSR and `/api/v1` in the browser so Vite can proxy API calls.

## Common Commands

```bash
# Frontend
cd frontend
bun run dev
bun run build
bun run lint
bun run format

# Backend
cd backend
go run ./cmd/server
go test ./...

# ML service
cd ml
python service.py
python trainer.py

# Full stack
docker compose up --build
```

## Important Workflows

### Outcome Logging

1. User opens `/seller/$sellerId`.
2. User logs `Resolved`, `Escalated`, or `Churned`.
3. Go API stores the outcome in SQLite with the current feature snapshot.
4. Go API sends the labeled feature snapshot to the ML service.
5. Every 10 logged outcomes, the backend can rebuild the archetype playbook asynchronously.

### AI Retention Guide

1. Frontend calls `POST /api/v1/sellers/:id/guide`.
2. Backend first checks `seller_computed` for a cached guide.
3. If missing, backend builds a seller prompt from metrics, call history, playbook entries, and ML probability.
4. Gemini returns structured guide sections.
5. Backend stores the guide JSON for future calls.

### Nightly Batch

`POST /api/v1/batch/nightly` runs the batch pipeline:

1. Load mock transcripts from `backend/data/transcripts.json`.
2. Merge seed and DB call insights.
3. Recalculate rule risk, churn cause, and archetype.
4. Push features to the ML service and fetch churn probability.
5. Use one Gemini call to extract transcript insight and generate the guide when transcripts exist.
6. Save the computed state and guide into SQLite.

### ML Training

The ML service seeds 500 synthetic examples on startup, trains XGBoost, and writes model stats to `ml/model_stats.json`. Real KAM outcomes are appended to the same SQLite training corpus through `POST /outcomes`. Manual retraining is available through the Go proxy at `POST /api/v1/ml/train`.

## Known Gaps

- The frontend contains helper functions for MERP extraction and multipart audio upload, but the current Go backend exposes only JSON transcript processing at `POST /api/v1/audio/upload` and does not expose `/merp/extract`.
- `start.sh` is written for Unix-like shells. On Windows, use Docker Compose, Git Bash/WSL, or run each service manually.
- The checked-in seed database and ML artifacts are demo assets. Regenerate them when changing scoring features or training schema.
- `BACKEND.md` is an architecture design note and contains aspirational modules that do not exactly match the current folder names. Use this README plus `backend/openapi.yaml` for current runtime behaviour.

## Roadmap

- Align frontend package filters and TypeScript package union with the backend package names.
- Add a backend `/merp/extract` route or remove the unused frontend API helper.
- Make transcript upload support both JSON payloads and multipart files.
- Add backend tests for scoring, classifier, pattern detection, and API handlers.
- Replace synthetic training seed data with real labeled retention outcomes.
- Add production integrations for IndiaMART warehouse data, call recordings, CRM follow-ups, and auth.
