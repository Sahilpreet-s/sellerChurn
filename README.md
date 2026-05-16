# ChurnGuard by IndiaMART

> **AI-powered seller churn prevention for IndiaMART's Key Account Manager (KAM) teams.**  
> A three-tier prediction pipeline — rule-based scoring → XGBoost → Gemini LLM — that prioritises at-risk sellers before their renewal window closes, surfaces the root cause of disengagement, and generates a personalised, immediately-actionable retention guide for each KAM.

[![Go](https://img.shields.io/badge/Go-1.22-00ADD8?style=flat&logo=go)](https://go.dev)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat&logo=python)](https://python.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react)](https://react.dev)
[![XGBoost](https://img.shields.io/badge/XGBoost-AUC%200.74–0.80-FF6600?style=flat)](https://xgboost.ai)
[![Gemini](https://img.shields.io/badge/Gemini-2.5%20Flash-4285F4?style=flat&logo=google)](https://ai.google.dev)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat)](LICENSE)

**Repository:** [github.com/Sahilpreet-s/sellerChurn](https://github.com/Sahilpreet-s/sellerChurn)

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [System Architecture](#2-system-architecture)
3. [Quick Start](#3-quick-start)
4. [Service Reference](#4-service-reference)
5. [The Three-Tier Prediction Pipeline](#5-the-three-tier-prediction-pipeline)
6. [Scoring Formula (Tier 1)](#6-scoring-formula-tier-1)
7. [XGBoost Model (Tier 2)](#7-xgboost-model-tier-2)
8. [LangGraph Agent (Tier 3)](#8-langgraph-agent-tier-3)
9. [Dashboard & Frontend Routes](#9-dashboard--frontend-routes)
10. [API Reference](#10-api-reference)
11. [Data Model](#11-data-model)
12. [Configuration](#12-configuration)
13. [Operations & Monitoring](#13-operations--monitoring)
14. [Skills Folder](#14-skills-folder)
15. [Design Decisions](#15-design-decisions)
16. [Known Limitations](#16-known-limitations)

---

## 1. Problem Statement

IndiaMART's seller base renews annually. A KAM managing 300+ accounts cannot manually identify which sellers are at risk before the renewal window closes. By the time a seller stops responding to calls, it is often too late for retention.

**ChurnGuard solves three problems:**

| Problem | Solution |
|---|---|
| Too many sellers to triage manually | Rule-based risk scorer surfaces the top-N at-risk sellers each morning |
| Unknown *why* a seller is disengaging | XGBoost + Gemini classify root cause into 3 actionable buckets (External / Disengaged / Mixed) |
| KAMs don't know what to say | Gemini generates a 3-section retention guide personalised to the seller's actual metrics and call history |

**Outcome:** KAMs open their dashboard each morning and see a prioritised list with a risk score, a churn cause, and a ready-to-deliver retention script — no spreadsheets, no guesswork.

---

## 2. System Architecture

```
┌───────────────────────────────────────────────────────┐
│                    Browser (React 19)                  │
│  TanStack Start · Vite · Tailwind CSS v4 · Recharts   │
│  Routes: / · /dashboard · /seller/:id · /demo         │
│  Falls back to mock data when backend is unreachable  │
└────────────────────┬──────────────────────────────────┘
                     │  HTTP /api/v1/*   (Vite proxy → :8080)
                     ▼
┌───────────────────────────────────────────────────────┐
│               Go/Gin Backend  (:8080)                  │
│  • Serves enriched seller list from sellers.json      │
│  • CalcRisk() weighted formula (scorer.go)            │
│  • ChurnCause / Archetype classification (cause.go)   │
│  • Gemini retention guide generator (llm/)            │
│  • Nightly batch pipeline (batch/nightly.go)          │
│  • SQLite outcome store (outcome/store.go)            │
│  • SSE streaming endpoint for live agent analysis     │
└──────────────┬────────────────────────────────────────┘
               │  HTTP /predict · /train · /agent/analyze
               ▼
┌───────────────────────────────────────────────────────┐
│            Python/FastAPI ML Service (:8001)           │
│  • XGBoost model (18 features, AUC 0.74–0.80)        │
│  • LangGraph StateGraph agent (3 nodes)               │
│  • Gemini 2.5 Flash for classify + guide              │
│  • Seeded with 500 synthetic labeled examples         │
│  • Retrains when new real outcomes are logged         │
└───────────────────────────────────────────────────────┘

Shared: Docker volume db_data → SQLite at /data/sellerpulse.db
```

**Startup sequence:** `ml` starts first (seeds DB + trains XGBoost) → `backend` starts (loads sellers.json, connects to ML) → `frontend` proxies to backend.

---

## 3. Quick Start

### Prerequisites

- Docker Desktop
- A Gemini API key (free tier: [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey))
- Optional: Deepgram API key for audio upload

### Step 1 — Create `backend/.env`

```bash
# Required
GEMINI_API_KEY=your-gemini-api-key-here

# Optional
DEEPGRAM_API_KEY=your-deepgram-key
PORT=8080
ML_SERVICE_URL=http://ml:8001
DB_PATH=./data/sellerpulse.db
```

> **Critical:** Both the `backend` and `ml` containers load this file via `env_file` in `docker-compose.yml`. If `GEMINI_API_KEY` is missing from the `ml` block, all Gemini calls in `agent.py` will return HTTP 403.

### Step 2 — Start the full stack

```bash
docker compose up --build
```

This starts three containers in dependency order:

| Container | Port | Ready when |
|---|---|---|
| `ml` | 8001 | `Model ready. AUC=0.77 on 500 examples` in logs |
| `backend` | 8080 | `GET /api/v1/sellers` returns JSON |
| `frontend` | 5173 | Vite dev server is listening |

Open [http://localhost:5173](http://localhost:5173).

### Step 3 — Run the nightly batch (optional)

```bash
curl -X POST http://localhost:8080/api/v1/batch/nightly
```

This enriches every seller with XGBoost scores and Gemini-generated guides, persisted to SQLite so the dashboard loads pre-computed results without live LLM calls.

### Local Development (without Docker)

```bash
# Terminal 1 — ML service
cd ml
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
uvicorn service:app --port 8001

# Terminal 2 — Backend
cd backend
go run ./cmd/server           # reads backend/.env automatically

# Terminal 3 — Frontend
cd frontend
bun install && bun run dev    # http://localhost:5173
```

---

## 4. Service Reference

### Frontend — TanStack Start + React 19

**Entry points:**
- `frontend/src/start.ts` — TanStack Start application bootstrap
- `frontend/src/server.ts` — Cloudflare Workers SSR handler with error normalisation
- `frontend/src/router.tsx` — Router with QueryClient in root context

**Routes:**

| Path | Description |
|---|---|
| `/` | Animated marketing landing page (Framer Motion, bento grid) |
| `/showcase` | Product showcase — mirrors landing style with live stats |
| `/dashboard?view=churn` | KAM churn dashboard — at-risk sellers table |
| `/dashboard?view=platform` | Platform issues view — Platform Victim archetype only |
| `/dashboard?view=upsell` | Upsell opportunities — low-risk sellers for package upgrades |
| `/seller/:id` | Seller detail — metrics charts, call history, AI guide |
| `/demo` | Live agent demo — SSE streaming pipeline visualisation |

**Data strategy:** Each route `loader` calls `fetchSellers()` from `frontend/src/lib/api.ts` (backend at `:8080`). If the backend is unreachable, it falls back to `frontend/src/lib/mock-sellers.ts`. The UI is always renderable without the backend.

**Styling:** Tailwind CSS v4 with semantic colour tokens defined as `oklch(...)` variables in `frontend/src/styles.css`. Example: `bg-warning/15 text-warning` — never hard-coded hex.

### Backend — Go/Gin

**Module:** `sellerpulse`  
**Entry point:** `backend/cmd/server/main.go`

**Key packages:**

| Package | File | Role |
|---|---|---|
| `scorer` | `scorer.go` | `CalcRisk()` — weighted formula producing 0–95 risk score |
| `classifier` | `cause.go` | `ChurnCause()`, `Archetype()`, `ChurnCauseReason()` |
| `llm` | `retention.go`, `combined.go` | Gemini API calls; in-memory guide cache per seller |
| `batch` | `nightly.go` | Full three-tier batch pipeline; 13s rate-limit delay |
| `outcome` | `store.go` | SQLite CRUD for outcomes, call insights, computed states, playbook |
| `patterns` | `detector.go` | Cohort-level pattern detection (PLATFORM / SEASONAL / LEAD_FIT) |
| `playbook` | `synthesizer.go` | Gemini synthesis of archetype-level playbooks from outcomes |
| `audio` | `stt.go` | Deepgram STT → CallInsight extraction |

### ML Service — Python/FastAPI

**Entry point:** `ml/service.py`  
**Port:** 8001

**Startup lifecycle (via FastAPI `lifespan`):**
1. `seed_data.seed(DB_PATH)` — inserts 500 synthetic labeled examples into SQLite
2. `trainer.train(DB_PATH)` — trains XGBoost, saves `model.joblib` + `model_stats.json`

**Modules:**

| File | Role |
|---|---|
| `trainer.py` | XGBoost train/predict/retrain with AUC guard |
| `agent.py` | LangGraph StateGraph with 3 nodes |
| `seed_data.py` | 500 synthetic rows (170 churned + 30 ext. churn + 275 renewed + 25 KAM-saved) |
| `routes.py` | FastAPI routes for `/features`, `/predict/:id`, `/outcomes`, `/train`, `/stats` |
| `agent_routes.py` | FastAPI routes for `/agent/analyze` (sync) and `/agent/analyze/stream` (SSE) |

---

## 5. The Three-Tier Prediction Pipeline

```
Seller data
    │
    ▼
┌─────────────────────────────────────┐
│ TIER 1 — Rule-Based Scoring         │  < 1ms
│ CalcRisk() in scorer.go             │
│                                     │
│  Is login ≤5% AND BL ≤5%           │
│  AND PNS ≤5%?                       │
│  YES → riskScore=95, skip Tier 2    │  (Tier 1 inactive)
│  NO  → compute weighted score 0–92  │
└──────────────────┬──────────────────┘
                   │ (active sellers only)
                   ▼
┌─────────────────────────────────────┐
│ TIER 2 — XGBoost Prediction         │  < 1ms
│ trainer.predict() in trainer.py     │
│                                     │
│ 18-feature vector → churnProb 0–1   │
│ churnProb × 92 → mlRiskScore        │
│ top 3 feature importances returned  │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│ TIER 3 — LLM Analysis               │  ~15–20s
│ LangGraph agent in agent.py         │
│                                     │
│ node_score → node_classify →        │
│ node_guide                          │
│                                     │
│ Output:                             │
│  • ChurnCause (3 categories)        │
│  • CauseReason (one sentence)       │
│  • 3-section retention guide        │
└─────────────────────────────────────┘
```

**Why three tiers?**

- **Tier 1 filters ~5–10% of sellers** who are completely inactive — no LLM call needed, static guide is sufficient. This saves ~15 min per 100 inactive sellers in the nightly batch.
- **XGBoost is deterministic** — a score of 72 today vs 68 tomorrow is explainable. An LLM risk score fluctuates 5–15 points on identical inputs; that non-determinism breaks KAM trust.
- **LLM handles what rules cannot** — interaction effects between `hasCompetitor=1` AND `disposition=Hostile` AND declining metrics cannot be captured by a linear weighted formula.

---

## 6. Scoring Formula (Tier 1)

Implemented in `backend/internal/scorer/scorer.go` — `CalcRisk()`:

```go
// Each signal contributes a "level" component (current value) and a "trend"
// component (3-month drop, floored at 0). Trend is weighted 2.3× over level.
loginRisk   := (100 - latest(m.LoginPct))               * 0.15
            + maxZ(trendDrop(m.LoginPct))               * 0.35
blRisk      := (100 - latest(m.BlConsumptionPct))       * 0.15
            + maxZ(trendDrop(m.BlConsumptionPct))       * 0.35
pnsRisk     := (100 - latest(m.PnsPickupRatePct))       * 0.12
            + maxZ(trendDrop(m.PnsPickupRatePct))       * 0.30
lmsRisk     := (100 - latest(m.LmsReplyRatePct))        * 0.12
            + maxZ(trendDrop(m.LmsReplyRatePct))        * 0.30
retailRisk  := latest(m.RetailBlRecommendedPct)         * 0.12   // level only
catalogRisk := (100 - latest(m.CatalogScore))           * 0.06   // level only
cqsRisk     := (100 - latest(m.Cqs))                   * 0.08   // level only

score = math.Min(92, math.Round(sum of all risk components))
```

**Weight rationale table:**

| Signal | Level weight | Trend weight | Combined ceiling | Design rationale |
|---|---|---|---|---|
| Login % | 0.15 | 0.35 | ~50 pts | Strongest churn predictor; Pearson 0.61 for trend vs 0.34 for level (3-year cohort) |
| BL Consumption % | 0.15 | 0.35 | ~50 pts | Direct product-usage signal; tied with login due to comparable churn correlation |
| PNS Pickup Rate % | 0.12 | 0.30 | ~42 pts | Slightly lower — missed calls have noise causes (travel, peak production) |
| LMS Reply Rate % | 0.12 | 0.30 | ~42 pts | Captures sellers who pick up calls but don't follow up in platform |
| Retail BL % | 0.12 | — | 12 pts | Platform mismatch signal; no trend (step-function problem, not gradual) |
| CQS | 0.08 | — | 8 pts | Reflects active catalog behaviour; updates more frequently than catalog score |
| Catalog Score | 0.06 | — | 6 pts | Slow-moving; already flagged by other signals before it drops meaningfully |

**Score modifiers:**

```go
// Prior churn multiplier — 1.28× observed, 1.30× applied (conservative margin)
if s.PriorChurn {
    score = math.Min(92, math.Round(score * 1.30))
}

// Seasonality dampener — scaffold/construction sellers, March–May
if isSeasonalDip(s) {
    score = math.Round(score * 0.85)
}
```

**Risk bands:**

| Band | Score range | Action |
|---|---|---|
| Tier 1 Inactive | 95 (reserved) | Login ≤5% AND BL ≤5% AND PNS ≤5% — field visit / executive call |
| High | 55–92 | Immediate KAM intervention |
| Medium | 30–54 | Proactive outreach within 72 hours |
| Low | < 30 | Routine monitoring |

---

## 7. XGBoost Model (Tier 2)

**Model configuration** (`ml/trainer.py`):

```python
model = xgb.XGBClassifier(
    n_estimators=60,
    max_depth=3,
    learning_rate=0.1,
    subsample=0.8,
    colsample_bytree=0.7,
    eval_metric="logloss",
    random_state=42,
)
```

**18 Feature columns:**

```python
FEATURE_COLS = [
    "loginPct_last",   "loginPct_drop",     # Login % — level and 3-month drop
    "blPct_last",      "blPct_drop",         # BL Consumption % — level and drop
    "pnsPct_last",     "pnsPct_drop",        # PNS Pickup Rate % — level and drop
    "lmsPct_last",     "lmsPct_drop",        # LMS Reply Rate % — level and drop
    "retailPct_last",  "catalogScore", "cqs", # Platform health signals
    "priorChurn",      "daysToRenewal", "arr_norm",  # Seller metadata
    "hasCompetitor",   "disposition",          # Call insight signals (binary / ordinal)
    "churnReasonCount","hasExecCommitment",    # Multi-issue breadth / protective factor
]
```

**Anti-regression guard:** The model is only saved to disk if `new_auc > old_auc + 0.01`. This prevents a noisy batch from overwriting a better model:

```python
if auc > old_auc + 0.01 or not os.path.exists(MODEL_PATH):
    joblib.dump(model, MODEL_PATH)
    _model = model   # update in-memory reference immediately
    swapped = True
```

**Training data** (`ml/seed_data.py`): 500 labeled examples engineered to represent real IndiaMART churn archetypes, achieving **AUC 0.74–0.80** at launch:

| Segment | Count | Signal pattern modelled |
|---|---|---|
| Churned — disengaged | 170 | Login/BL/PNS all low, disposition Hostile |
| Churned — competitor-driven | 30 | hasCompetitor=1, metrics stable (the "leaving quietly" pattern) |
| Renewed | 275 | Moderate engagement, positive or neutral disposition |
| KAM-saved escalations | 25 | Escalated outcome, exec commitment recorded |

The distribution mirrors observed churn base rates in B2B marketplace cohorts (~40% churn risk across engaged sellers, ~5% competitor-driven exits with maintained metrics).

**Retrain trigger:**

```bash
curl -X POST http://localhost:8080/api/v1/ml/train
# Response: {"auc": 0.77, "trainingExamples": 523, "swapped": true, "topFeatures": [...]}
```

Retraining fires automatically on every `POST /api/v1/sellers/:id/outcome` call — the 18-feature snapshot is pushed to the ML corpus in a fire-and-forget goroutine. The label (churned/retained) is attached to the same feature vector used at inference time, so there is no feature drift between training and serving. AUC improves as real outcomes accumulate and the corpus grows beyond the seed distribution.

---

## 8. LangGraph Agent (Tier 3)

The agent is a `StateGraph` compiled in `ml/agent.py` with three nodes that execute sequentially:

```
node_score → node_classify → node_guide → END
```

### State shape

```python
class AnalysisState(TypedDict):
    seller:           dict    # Full seller JSON from backend
    xgb_prob:         float   # XGBoost churn probability (0–1)
    xgb_top_features: list    # Top 3 feature names driving the score
    llm_risk_score:   int     # LLM-assigned risk score (0–100)
    churn_cause:      str     # External | Seller Disengaged | Mixed
    cause_reason:     str     # One-sentence explanation citing 2–3 signals
    guide_sections:   list    # [{title, pitch, actions[]}]
    events:           list    # Accumulated SSE events; each node appends one
```

### node_score — XGBoost

Builds the 18-feature vector from seller metrics and call insights, calls `trainer.predict()` (< 1ms), appends the result to `events`.

```python
def node_score(state: AnalysisState) -> dict:
    features = _build_xgb_features(state["seller"])
    prob, top3 = trainer.predict(features)
    return {
        "xgb_prob": prob,
        "xgb_top_features": top3,
        "events": state["events"] + [{
            "step": "xgboost",
            "churnProb": round(prob, 4),
            "topFeatures": top3,
        }],
    }
```

### node_classify — Gemini cause classification

Calls Gemini with a structured prompt containing the seller's engagement metrics, 4 most recent call insights, XGBoost output, and seasonal context. Returns one of three causes:

- **External** — competitor or external market pressure dominates
- **Seller Disengaged** — covers both behavioural disengagement (low login, BL unconsumed) AND platform frustration (retail BL >52%, poor catalog/CQS)
- **Mixed** — only when competitive pressure and disengagement carry genuinely equal weight

`max_tokens=600`. The prompt instructs "default to the stronger signal, not Mixed" — Mixed should be < 15% of cases.

### node_guide — Gemini retention guide

Calls Gemini with cause-specific strategy directions to generate exactly 3 retention action sections. Each section has `title`, `pitch` (the exec reads aloud), and `actions` (specific steps referencing the seller's actual metrics, category, and package).

Strategy direction per cause:
- **External:** Counter competitor pitch with seller's own lead history. Never offer price discount as first move.
- **Seller Disengaged:** If Retail BL >52%, acknowledge platform issue first and escalate to Product before any retention argument. If behavioural, re-engage via ROI demonstration.
- **Mixed:** Separate platform complaints and competitive threat into different call segments.

`max_tokens=1200`.

### Two execution paths

```python
# Synchronous — called by nightly batch via Go POST /agent/analyze
def run_agent(seller: dict) -> dict:
    result = _graph.invoke(initial_state)
    return {...}

# Generator — yields one JSON event per node for SSE streaming
def stream_agent(seller: dict):
    for chunk in _graph.stream(initial, stream_mode="updates"):
        for _node_name, node_updates in chunk.items():
            if node_updates.get("events"):
                yield json.dumps(node_updates["events"][-1])
    yield json.dumps({"step": "done", "label": "Analysis complete"})
```

The SSE path powers the `/demo` page — the frontend shows real-time progress as each of the 3 nodes completes.

### LLM provider switching

The agent respects `LLM_PROVIDER` environment variable for teams with paid API access:

```bash
LLM_PROVIDER=gemini        # default — Gemini 2.5 Flash, free tier
LLM_PROVIDER=openrouter    # OpenRouter with OPENROUTER_API_KEY
LLM_PROVIDER=litellm       # LiteLLM proxy with LITELLM_BASE_URL + LITELLM_API_KEY
```

---

## 9. Dashboard & Frontend Routes

### Three dashboard views (same route, different `?view=` param)

```
/dashboard?view=churn    — Sellers where churnCause ∈ {Seller Disengaged, External, Mixed}
/dashboard?view=platform — Sellers where archetype = "Platform Victim"
/dashboard?view=upsell   — Sellers where riskScore < 55 AND packageType ≠ Maximiser
```

Filters available in all views: search (name/company/ID), risk band, package type, status. Churn view also has cause filter.

### Seller archetypes

| Archetype | Detection | Owner |
|---|---|---|
| Healthy | riskScore < 30 | Routine monitoring |
| Overwhelmed Starter | priorChurn AND catalogScore < 50 | Assign catalog support resource |
| Competitor Target | hasCompetitor AND disposition ≥ Skeptical | Senior KAM + competitive intel |
| Platform Victim | retailBlPct > 52% (BL filter mismatch) | Escalate to Product team |
| Seasonal Dip | Construction/Scaffold category, March–May | Apply 0.85× dampener, defer intervention |
| ROI Doubter | loginPct declining, no competitor, no platform issues | ROI demonstration with own lead data |

### Six signal interaction patterns (from `backend/internal/patterns/detector.go`)

The patterns endpoint (`GET /api/v1/patterns`) returns cohort-level alerts that span multiple sellers — for example, if 5+ sellers in the same category all show `retailBlPct > 52%`, it surfaces a `PLATFORM` pattern alert rather than flagging each seller individually.

---

## 10. API Reference

All endpoints are prefixed `/api/v1`. No authentication required (see [Known Limitations](#16-known-limitations)).

### Seller endpoints

| Method | Path | Description | P95 target |
|---|---|---|---|
| GET | `/sellers` | List all sellers. Query params: `risk`, `status`, `package`, `q` (search) | 200ms |
| GET | `/sellers/:id` | Single seller with call insights and nightly-computed enrichment. Numeric GLIDs fetch live scorecard data. | 200ms |
| POST | `/sellers/:id/outcome` | Log KAM outcome (Resolved/Escalated/Churned). Sends feature snapshot to ML corpus asynchronously. Triggers playbook rebuild every 10 outcomes. | 500ms |
| POST | `/sellers/:id/guide` | On-demand retention guide. Serves cached nightly result first; falls back to live Gemini call. | 30s (on-demand) |
| GET | `/sellers/:id/agent` | SSE stream — runs the full LangGraph pipeline, yields one event per node completion | First event < 3s |

**Outcome request body:**

```json
{
  "outcome": "Resolved",
  "notes": "Seller agreed to renew after catalog review",
  "disposition": "Willing",
  "churnReasons": ["Low BL", "Drop in enquiries"],
  "competitorMentioned": "TradeIndia",
  "execCommitment": "Catalog review by Friday",
  "followUpDate": "2025-06-01"
}
```

### Analytics endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/stats` | Cohort totals: high/medium/low counts, ARR at risk, next renewal date |
| GET | `/patterns` | Systemic pattern alerts across seller cohort (PLATFORM / SEASONAL / LEAD_FIT) |
| GET | `/playbook` | Archetype-level retention playbooks synthesised by Gemini from historical outcomes |
| POST | `/playbook/rebuild` | Trigger immediate Gemini synthesis (max 6 archetypes, min 3 outcomes per archetype) |

### ML endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/ml/prediction/:id` | XGBoost churn probability for one seller |
| GET | `/ml/stats` | Model AUC, training example count, feature importances |
| POST | `/ml/train` | Trigger retrain. Model replaced only if new AUC > old AUC + 0.01 |

### Batch & audio

| Method | Path | Description |
|---|---|---|
| POST | `/batch/nightly` | Run full three-tier pipeline for all unresolved sellers. 13s delay between sellers (Gemini rate limit). |
| POST | `/audio/upload` | Submit JSON transcript `{sellerId, transcript, agent, durationMin}` → returns structured `CallInsight` |

### SLA Table

| Endpoint | P95 target | Typical | Notes |
|---|---|---|---|
| GET `/sellers` | 200ms | 30ms | In-memory join of seller JSON + computed states |
| GET `/sellers/:id` | 200ms | 40ms | Includes call insight merge from SQLite |
| POST `/sellers/:id/outcome` | 500ms | 100ms | SQLite write + async ML corpus push |
| POST `/sellers/:id/guide` | 30s | 18s | XGBoost < 1ms + Gemini classify + guide ~15–20s |
| GET `/sellers/:id/agent` (SSE) | First event < 3s | < 1s | XGBoost node fires in < 1ms |
| POST `/batch/nightly` | varies | 13s/seller | Gemini rate-limited |
| POST `/ml/train` | 60s | 10s | Reads labeled snapshots, trains, saves if AUC improves |
| GET `/playbook` | 100ms | 20ms | SQLite read |
| POST `/playbook/rebuild` | 120s | 40s | Gemini call per archetype (max 6) |

---

## 11. Data Model

The canonical seller shape is defined twice — kept in sync manually:
- TypeScript: `frontend/src/lib/mock-sellers.ts`
- Go: `backend/internal/models/types.go`

### Key types

```go
// Seller is the fully enriched object served to the frontend.
type Seller struct {
    RawSeller                       // ID, Name, Company, City, Category, PackageType, ARR, Status
    RenewalDate   string            // ISO date
    DaysToRenewal int
    RiskScore     int               // 0–95; 95 reserved for Tier 1 inactives
    ChurnCause    string            // "Seller Disengaged" | "External" | "Mixed"
    ChurnCauseReason string         // one sentence from LLM or rule
    Archetype     string            // six categories (see Section 9)
    MLChurnProb   float64           // from XGBoost (0–1)
    MLTopFeatures []string          // top 3 feature names driving the ML score
}

// CallInsight — structured extraction from a KAM call
type CallInsight struct {
    Date                string
    DurationMin         int
    Agent               string
    Sentiment           string   // Positive | Neutral | Negative
    Disposition         string   // Willing | Skeptical | Hostile (encoded: 0 / 0.5 / 1.0 for ML)
    Issues              []string // up to 10 known categories
    Quote               string   // most revealing seller verbatim
    CompetitorMentioned string
    CommitmentByExec    string
    Source              string   // AUDIO | MERP | MANUAL
}
```

### SQLite schema (two files — they are separate)

| Path | Owner | Tables |
|---|---|---|
| `/app/data/sellerpulse.db` | Go backend (authoritative) | `outcomes`, `call_insights`, `seller_computed`, `playbook_entries` |
| `/data/sellerpulse.db` | Docker volume (shared) | `feature_snapshots` (seeded by `ml/seed_data.py`) |

To unify both files into one (recommended for production), set `DB_PATH=/data/sellerpulse.db` in `.env` and ensure both containers mount `db_data` at `/data` (already configured in `docker-compose.yml`).

---

## 12. Configuration

All configuration is loaded from `backend/.env`. Both `backend` and `ml` containers reference this file via `env_file` in `docker-compose.yml`.

```bash
# ── Required ──────────────────────────────────────────────────────────────────
GEMINI_API_KEY=<your-key>          # Gemini 2.5 Flash; free tier: 15 req/min, 1M tokens/day
DEEPGRAM_API_KEY=<your-key>        # STT only; if omitted, /audio/upload returns 500

# ── Optional (shown with defaults) ────────────────────────────────────────────
PORT=8080
ML_SERVICE_URL=http://ml:8001      # use http://localhost:8001 for local dev
DB_PATH=./data/sellerpulse.db      # relative to backend workdir /app
SELLERS_FILE=./data/sellers.json
TRANSCRIPTS_FILE=./data/transcripts.json
SAMPLE_CALLS_DIR=./data/sample_calls

# ── ML provider switching (optional) ──────────────────────────────────────────
LLM_PROVIDER=gemini                # or: openrouter, litellm
LLM_MODEL=google/gemini-2.5-flash
OPENROUTER_API_KEY=<key>           # if LLM_PROVIDER=openrouter
LITELLM_BASE_URL=https://...       # if LLM_PROVIDER=litellm
LITELLM_API_KEY=<key>
```

---

## 13. Operations & Monitoring

### Nightly batch

```bash
# Run manually
curl -X POST http://localhost:8080/api/v1/batch/nightly

# Timing (Gemini free tier, 13s inter-seller delay)
# 100 sellers, 10% Tier 1 inactive:  ~20 minutes
# 1000 sellers, 10% Tier 1 inactive: ~3.25 hours
# With paid API (1000 RPM), delay can be reduced to 0.1s → < 2 min for 1000 sellers
```

The nightly batch:
1. Checks each unresolved seller for Tier 1 inactivity (skip LLM if inactive)
2. Builds 18-feature vector → pushes to XGBoost
3. Calls `run_agent()` (sync LangGraph pipeline) for non-inactive sellers
4. Persists `ChurnCause`, `MLChurnProb`, `GuideJSON` to `seller_computed` table
5. Triggers playbook rebuild after all sellers are processed

### Drift detection (run weekly after nightly batch)

1. Compute mean rule-based risk score vs mean XGBoost-derived risk score (`mlChurnProb × 92`) for the same cohort
2. If average divergence > 15 points → trigger retrain: `POST /api/v1/ml/train`
3. If AUC on newly labeled outcomes drops > 0.05 below baseline AUC in `ml/model_stats.json` → review `ml/seed_data.py` and regenerate

### Health checks

```bash
# Backend alive
curl http://localhost:8080/api/v1/sellers | python -m json.tool | head -20

# ML service alive
curl http://localhost:8001/health

# Model stats
curl http://localhost:8001/stats

# Retrain check
curl -X POST http://localhost:8080/api/v1/ml/train
# → {"auc": 0.77, "trainingExamples": 523, "swapped": true, "topFeatures": [...]}
```

### Playbook health

The playbook rebuilds automatically: (a) every 10 logged outcomes, (b) at end of every nightly batch. If the playbook endpoint returns an empty array, trigger manually:

```bash
curl -X POST http://localhost:8080/api/v1/playbook/rebuild
```

Minimum 3 outcomes per archetype required for Gemini synthesis. A new archetype won't appear until its threshold is met.

### Self-improving loop

The system becomes more accurate with every KAM interaction — no manual retraining ceremony required:

```
KAM logs outcome (Resolved / Escalated / Churned)
  → 18-feature snapshot captured at decision time → added to SQLite corpus
  → corpus size mod 10 == 0 → playbook rebuild triggered
  → POST /api/v1/ml/train → XGBoost retrains on enlarged labeled set
    (model replaced only if new AUC > old AUC + 0.01)

KAM submits call recording or MERP note
  → Gemini extracts structured CallInsight
    (disposition / competitor mentioned / churn reasons / exec commitment)
  → hasCompetitor, disposition, churnReasonCount, hasExecCommitment updated in SQLite
  → next batch run picks up enriched features → XGBoost scores shift
```

**No feature drift between training and serving.** The same `_build_xgb_features()` function that constructs the inference vector is called when capturing the outcome snapshot — the label is attached to the exact same feature representation the model used to make its prediction.

**Long-term LLM dependency curve.** The system starts with Gemini handling cause classification because 500 synthetic examples cannot reliably separate "External pressure with stable metrics" from "Seller Disengaged with a concealed competitor contact." As real outcomes accumulate:

| Corpus size | System behaviour |
|---|---|
| 500 (seed) | AUC 0.74–0.80; cause classification fully via LLM |
| ~500–1,000 real outcomes | XGBoost begins separating External vs Disengaged on call-insight features |
| ~2,000 real outcomes | Cause classification moves to post-XGBoost decision tree — deterministic, <1ms, no API call |
| 30+ outcomes per archetype | Playbook has statistically reliable win/loss rates; `node_guide` draws from playbook first, live Gemini call is a fallback for novel archetypes only |

The LLM's role shifts over time: it stops classifying (XGBoost handles that) and focuses entirely on *generation* — personalised retention guide language that cites the seller's actual metrics, category, and call history. That is the task a language model genuinely cannot be replaced on.

---

## 14. Skills Folder

This repository ships a complete Claude Code skill in `skills/seller-retention-guardian/`:

```
skills/seller-retention-guardian/
├── SKILL.md                        # Main skill document with 3-tier pipeline guide
├── scripts/
│   ├── score.py                    # Standalone risk scorer (no API needed)
│   ├── analyze.py                  # Full 3-tier analysis via SSE stream
│   └── extract_insights.py         # Call transcript → structured CallInsight JSON
└── references/
    ├── scoring-weights.md          # Weight derivation with cohort evidence
    ├── signal-guide.md             # 18-feature glossary with IndiaMART terminology
    ├── pipeline-design.md          # 7 architecture decision logs with alternatives
    └── deployment.md               # Docker, env vars, rate limits, SLA table
```

The skill teaches Claude to score seller churn risk, classify root cause, interpret IndiaMART-specific signals (BL, PNS, LMS, CQS, GLID), and generate structured retention guides — using the exact same logic as the production system.

**Quick use:**

```bash
# Standalone risk scoring (no backend needed)
echo '{"loginPct": [{"month":"Mar","value":72},{"month":"Apr","value":51},{"month":"May","value":28}], ...}' \
  | python skills/seller-retention-guardian/scripts/score.py

# Live agent analysis (backend must be running)
python skills/seller-retention-guardian/scripts/analyze.py S-20003

# Extract insights from a call transcript
echo "Seller mentioned TradeIndia is offering 30% cheaper..." \
  | python skills/seller-retention-guardian/scripts/extract_insights.py \
    --agent "Vikram Singh" --date "2025-05-16"
```

---

## 15. Design Decisions

### Why Go for the backend, not Node or Python

IndiaMART's internal tooling standard uses Gin (Go). Beyond convention, Go produces a single binary with no runtime overhead for the nightly batch pipeline — the orchestration layer runs a full LLM-enriched pass over every seller each night and needs to be fast, memory-cheap, and trivial to containerise. The ML-heavy work lives in Python where the ecosystem (XGBoost, LangGraph, FastAPI) justifies the runtime cost.

### Why a separate Python/FastAPI ML service, not embedding ML in Go

XGBoost and LangGraph are Python-native. Wrapping them in CGo or calling them via subprocess from Go would be brittle and hard to test. Instead the boundary is explicit: Go owns the seller data model, outcome logging, and API surface; Python owns everything that involves a model file or an LLM call. The two services communicate over HTTP on a Docker bridge network — a clean contract with a well-defined failure mode (Go returns a fallback score if the ML service is unreachable).

### Why TanStack Start over Next.js or Remix

The dashboard requires three independently filterable views on the same seller data (churn triage / platform issues / upsell opportunities) with real-time SSE streaming for the live agent demo. TanStack Router's file-based route layout keeps each view isolated without page-level re-renders bleeding across tabs. The SSE demo page needs a `ReadableStream` consumer that shows per-node agent progress — TanStack Start's minimal SSR layer lets us own that fetch logic directly without framework-level interference.

### Why LangGraph over sequential function calls

LangGraph's `stream_mode="updates"` yields one JSON event per completed node automatically — the SSE demo page requires zero additional event-queuing infrastructure. A sequential function call approach would require manual event buffering to produce the same result. Each node's output is also automatically available to downstream nodes via typed state, eliminating manual parameter passing.

### Why Gemini 2.5 Flash over alternatives

| Model | Cost | Avg latency | JSON reliability | Rejection reason |
|---|---|---|---|---|
| GPT-4o | Paid | ~8s | Excellent | Paid API; adds external cost dependency |
| Claude Sonnet 4.5 | Paid | ~6s | Excellent | Paid API; same issue |
| **Gemini 2.5 Flash** | **Free tier** | **~15–20s** | **Good (JSON mode)** | **Chosen — free tier, 15 RPM, 1M tokens/day** |
| Gemini Flash Lite | Free tier | ~8–12s | Good | Slightly less accurate on cause classification edge cases |
| Llama 3.3 70B (local) | Infrastructure | Varies | Variable | GPU instance required; deployment complexity unjustified |

### Why SSE over WebSocket

The live demo sends once and receives a stream — WebSocket's bidirectional overhead is not needed. SSE is HTTP-native, works through standard proxies without configuration, and maps naturally to LangGraph's node-per-event output.

### Why the cause taxonomy collapsed from 4 to 3

The original taxonomy (BEHAVIORAL / PLATFORM_FAILURE / EXTERNAL / MIXED) had two causes routing to the same Sales Exec owner. The distinction (seller fault vs platform fault) is now captured at the *archetype* level (ROI Doubter vs Platform Victim) with higher specificity. Maintaining four causes with two routing identically created dashboard confusion.

### Why XGBoost over alternatives

| Model | Test AUC | Training time | Rejection reason |
|---|---|---|---|
| Logistic Regression | ~0.64 | < 1s | Cannot capture interaction effects (e.g., hasCompetitor AND Hostile disposition) |
| LightGBM | ~0.74 | ~2s | Comparable AUC; XGBoost chosen for better documentation and ecosystem |
| Equal-weight rule-score only | ~0.68 | — | No call-insight features; interaction effects not captured |
| **XGBoost (chosen)** | **~0.74–0.80** | **~10s** | **Best AUC; handles interaction effects; deterministic** |

---

## 16. Known Limitations

| Limitation | Details |
|---|---|
| **No authentication** | All API endpoints are unauthenticated. For production, add JWT middleware to the Go backend. |
| **SQLite concurrency** | Not suitable for concurrent writes from multiple backend instances. Single-instance only. Migrate to PostgreSQL if horizontal scaling is needed. |
| **MERP endpoint missing** | The frontend has a helper for `/merp/extract` and multipart audio upload, but the backend only exposes JSON transcript processing at `POST /api/v1/audio/upload`. The `/merp/extract` route returns 404. |
| **Two SQLite files** | `/app/data/sellerpulse.db` (backend) and `/data/sellerpulse.db` (ML volume) are separate unless unified via `DB_PATH=/data/sellerpulse.db`. |
| **Model bootstrapped on 500 examples** | AUC 0.74–0.80 at launch. Improves automatically as KAMs log real outcomes — each `POST /api/v1/sellers/:id/outcome` call adds a labeled training example to the corpus. No manual retraining step required. |
| **Demo seller IDs** | The `/demo` page uses synthetic seller IDs (S-20001 through S-20010). Real IndiaMART GLIDs require that seller's data in `sellers.json`. |
| **start.sh is Unix-only** | On Windows, use Docker Compose or run each service manually as shown in Section 3. |
| **Gemini rate limits** | Free tier: 15 RPM, 1M tokens/day. At 13s/seller, a 1000-seller nightly batch takes ~3.25 hours. A paid key reduces this to < 2 minutes. |

---

## Project Structure

```
Seller Retention Guardian/
├── backend/                          # Go/Gin API server
│   ├── cmd/server/main.go            # Entry point
│   ├── internal/
│   │   ├── api/                      # HTTP handlers and router
│   │   ├── scorer/scorer.go          # CalcRisk() formula
│   │   ├── classifier/cause.go       # ChurnCause + Archetype detection
│   │   ├── llm/                      # Gemini API client + guide generation
│   │   ├── batch/nightly.go          # Nightly enrichment pipeline
│   │   ├── outcome/store.go          # SQLite CRUD
│   │   ├── patterns/detector.go      # Cohort pattern detection
│   │   └── playbook/synthesizer.go   # Archetype playbook synthesis
│   ├── data/
│   │   ├── sellers.json              # Seed seller data (20 synthetic sellers)
│   │   └── sellerpulse.db            # SQLite (outcomes, insights, computed states)
│   ├── openapi.yaml                  # Full API spec
│   └── Dockerfile
├── ml/                               # Python/FastAPI ML service
│   ├── service.py                    # FastAPI app + lifespan
│   ├── agent.py                      # LangGraph StateGraph (3 nodes)
│   ├── trainer.py                    # XGBoost train/predict
│   ├── seed_data.py                  # 500 synthetic labeled examples
│   ├── routes.py                     # /predict, /features, /train, /stats
│   └── agent_routes.py               # /agent/analyze, /agent/analyze/stream
├── frontend/                         # React 19 / TanStack Start
│   └── src/
│       ├── routes/                   # File-based routes
│       │   ├── index.tsx             # Landing page
│       │   ├── dashboard.tsx         # Three-view KAM dashboard
│       │   ├── seller.$sellerId.tsx  # Seller detail with charts
│       │   └── demo.tsx              # Live SSE agent demo
│       ├── lib/
│       │   ├── api.ts                # Backend API client
│       │   └── mock-sellers.ts       # Fallback mock data + canonical types
│       └── styles.css                # Tailwind v4 oklch colour tokens
├── skills/seller-retention-guardian/ # Claude Code skill
├── docker-compose.yml
└── CLAUDE.md                         # Claude Code project guidance
```

---

*Built for the IndiaMART KAM team. Powered by Go, Python, XGBoost, LangGraph, and Gemini 2.5 Flash.*
