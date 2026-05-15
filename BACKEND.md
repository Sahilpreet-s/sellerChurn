# SellerPulse 360° — Backend Architecture

Go backend service that powers the Seller Churn Early Warning dashboard. Provides scored, enriched seller data via REST API, replacing the frontend mock in `src/lib/mock-sellers.ts`.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Processing Pipeline](#processing-pipeline)
3. [Layer Breakdown](#layer-breakdown)
   - [Layer 1 — Data Fetch](#layer-1--data-fetch)
   - [Layer 2 — Signal Normalization](#layer-2--signal-normalization)
   - [Layer 3 — Rule-Based Scoring](#layer-3--rule-based-scoring)
   - [Layer 4 — Composite Churn Score](#layer-4--composite-churn-score)
   - [Layer 5 — Cause Classifier & Router](#layer-5--cause-classifier--router)
   - [Layer 6 — Call Recording Pipeline](#layer-6--call-recording-pipeline)
   - [Layer 7 — LLM Layer](#layer-7--llm-layer)
   - [Layer 8 — Pattern Detector](#layer-8--pattern-detector)
   - [Layer 9 — XGBoost Evolution Pipeline](#layer-9--xgboost-evolution-pipeline)
4. [API Reference](#api-reference)
5. [Data Models](#data-models)
6. [Project Structure](#project-structure)
7. [Environment Variables](#environment-variables)
8. [Local Development](#local-development)
9. [Frontend Integration](#frontend-integration)

---

## System Overview

```
IndiaMart Data Sources (mock for hackathon)
    ├── Seller behavioural signals  (login, BL, PNS, LMS, catalog)
    ├── Platform signals            (lead quality, buyer response, search rank)
    ├── Market signals              (category competition, seasonality)
    ├── Support ticket system       (volume, SLA, sentiment)
    └── Call recordings             (audio → transcript → insights via LLM)
              │
              ▼
      SellerPulse Backend (Go)
              │
    ┌─────────┴────────────────────────────┐
    │  /api/sellers        — dashboard list │
    │  /api/sellers/:id    — seller detail  │
    │  /api/patterns       — cluster alerts │
    │  /api/brief          — daily brief    │
    │  /api/outcomes       — log call result│
    │  /api/roi            — ROI dashboard  │
    └─────────┬────────────────────────────┘
              │
      React Frontend (TanStack Start)
```

---

## Processing Pipeline

```
Raw Data Sources
      │
      ▼
[Layer 1]  Data Fetch & Aggregation
           Pull behavioural + platform + market signals per seller
      │
      ▼
[Layer 2]  Signal Normalization
           Raw values → 0–100 risk scores + trend direction per signal
      │
      ▼
[Layer 3]  Rule-Based Engine
           Hard thresholds → CRITICAL / HIGH / WATCH / HEALTHY tier
           Optimal intervention call window computed
      │
      ▼
[Layer 4]  Composite Churn Scorer
           Weighted formula across 17 signals → single 0–100 score
      │
      ▼
[Layer 5]  Cause Classifier + Action Router
           BEHAVIORAL  → route to Sales Exec
           PLATFORM    → route to Product Team
           EXTERNAL    → route to Leadership
      │
      ├──► [Layer 6]  Call Recording Pipeline  (async, triggered on new recording)
      │              Audio → STT → LLM analysis → structured CallInsight saved
      │
      ├──► [Layer 7]  LLM Layer  (on-demand, cached)
      │              Retention guide, archetype label, pattern narrative
      │
      ├──► [Layer 8]  Pattern Detector  (background job, every 4h)
      │              Cross-seller clustering → systemic platform alerts
      │
      └──► [Layer 9]  XGBoost Evolution Pipeline  (async, triggered at data threshold)
                     Outcome logging → feature snapshots → auto-train when 5k rows reached
```

---

## Layer Breakdown

### Layer 1 — Data Fetch

Fetches all raw signals per seller. For the hackathon: mock implementations backed by seeded JSON. Interface is identical to a production API client — swap the implementation to go live.

**Behavioural signals fetched:**
- Login timestamps (last 90 days)
- LMS: leads received, replied, avg reply time (hours)
- PNS: calls received, picked up
- BL: allocated, consumed, % retail buyer type
- Catalog: last update timestamp, product count, score
- Support tickets: count, resolution times, ticket text
- Payment: last 3 renewal payment dates, any extension requests

**Platform (IM-level) signals fetched:**
- Lead quality ratio: % of BLs matching seller's declared buyer profile
- Buyer response rate: % of seller replies that got buyer follow-up
- Search ranking delta: rank position change last 30 days
- BL filter violations: times platform overrode seller's filter in 30 days
- Support SLA breaches: tickets where IndiaMart exceeded 48h SLA

**Market signals fetched:**
- Category competition delta: new seller registrations in same category, last 90 days
- Category lead volume delta: % change in total BLs in this category vs prior quarter
- Seasonality index: expected low/high season for this category (0.0–1.0)

---

### Layer 2 — Signal Normalization

Converts every raw value to a **0–100 risk score** (0 = healthy, 100 = most risky) plus trend direction.

```go
type Signal struct {
    Score float64  // 0–100
    Trend string   // "declining" | "stable" | "improving"
    Delta float64  // % change vs 30 days prior
    Label string   // e.g. "49% login rate in last 30 days"
}
```

| Signal | Normalization logic |
|---|---|
| Login % | 0 logins = 100 risk; 20+ logins = 0 risk. Trend weight: 3-month slope |
| LMS Reply Rate | 100% reply = 0 risk; 0% = 100 risk. Trend amplifies score |
| LMS Reply Time | <2h = 0 risk; >24h = 100 risk |
| PNS Pickup % | 100% = 0 risk; 0% = 100 risk |
| BL Consumption % | 100% consumed = 0 risk; 0% = 100 risk |
| BL Retail % | 0% retail = 0 risk; 100% retail = 100 risk (inverted signal) |
| Catalog Score | Native 0–100; inverted (low score = high risk) |
| Support Stress | 0 tickets = 0 risk; 5+ open tickets = 100 risk |
| Payment Stress | On-time = 0; extension requested = 40; missed = 100 |
| Lead Quality Ratio | >80% match = 0 risk; <20% match = 100 risk |
| Buyer Response Rate | >60% = 0 risk; <15% = 100 risk |
| Search Ranking Delta | Rank improved = 0; dropped >20 positions = 100 |
| BL Filter Violations | 0 violations = 0; 5+ = 100 |
| Support SLA Breaches | 0 = 0; 3+ = 100 |
| Category Competition | Stable/declining = 0; >30% new entrants = 100 |
| Category Lead Volume | Growing = 0; declining >25% = 100 |
| Seasonality Index | Peak season = 0; off-season = up to 30 risk dampening |

---

### Layer 3 — Rule-Based Scoring

Fast, deterministic classification. Runs before the weighted scorer. Hard rules override score when renewal window is critical.

```
CRITICAL  →  score ≥ 70  OR  (score ≥ 60 AND renewal ≤ 30 days)
HIGH      →  score ≥ 50  OR  (score ≥ 40 AND renewal ≤ 60 days)
WATCH     →  score ≥ 35  OR  (score ≥ 25 AND renewal ≤ 90 days)
HEALTHY   →  score < 35
```

**Intervention timing** (optimal call window):
- Research baseline: 60–75 days before renewal = highest retention conversion rate
- If seller is already inside that window → call immediately
- Output: `callWindowStart` and `callWindowEnd` dates shown on the UI

---

### Layer 4 — Composite Churn Score

Weighted sum across three signal groups. Returns 0–100 score and per-group breakdown for the "Why flagged" section.

```
Behavioural signals    60% total weight
  Login               8%
  LMS Reply Rate     12%
  LMS Reply Time      8%
  PNS Pickup         10%
  BL Consumption     12%
  BL Retail Ratio     8%
  Catalog Score       6%
  Support Stress      8%
  Payment Stress      8% (inferred from renewal behaviour)

Platform signals       25% total weight
  Lead Quality Ratio 10%
  Buyer Response Rate 7%
  Search Ranking      4%
  BL Filter Respect   2%
  Support SLA Breach  2%

Market signals         15% total weight
  Category Health     6%
  Competition         5%
  Seasonality         4%   ← can dampen score for expected slow seasons
```

Seasonality can reduce the composite by up to 15% — prevents flagging sellers who are simply in a slow season as CRITICAL.

---

### Layer 5 — Cause Classifier & Router

Determines **why** the seller is at risk and **which team** should act. No LLM — pure rule logic on the normalized signals.

```
If platform signals dominant (LeadQuality > 60 OR SLA breaches > 2):
    ChurnCause = PLATFORM_FAILURE
    Route      = Product Team
    Note       = "Do not open with renewal pitch. Acknowledge lead quality issue first."

If behavioural signals dominant AND platform is healthy:
    ChurnCause = BEHAVIORAL
    Route      = Sales Exec
    Note       = "Standard retention call. Use retention guide."

If category competition or seasonality dominant:
    ChurnCause = EXTERNAL
    Route      = Leadership / Account Manager
    Note       = "Market-level issue. Incentive or grace period may be appropriate."

If both platform AND behavioural failing:
    ChurnCause = MIXED
    Route      = Sales Manager (for CRITICAL tier) or Sales Exec (others)
```

**Upgrade scorer** runs in parallel for HEALTHY sellers:
- High engagement + good platform delivery + growing category → upgrade candidate
- Score > 75 → flagged in the Grow section of daily brief

---

### Layer 6 — Call Recording Pipeline

This is a critical enrichment layer. Currently the frontend shows manually written call summaries. The backend replaces these with **LLM-extracted insights from real call recordings**.

**Pipeline:**

```
1. Call Recording Available
   (audio file uploaded or fetched from call centre system)
         │
         ▼
2. Speech-to-Text
   Deepgram / OpenAI Whisper API
   Input:  audio file (mp3/wav)
   Output: raw transcript with speaker labels
           "Agent: Hi Rakesh..."
           "Seller: I'm getting too many retail buyers..."
         │
         ▼
3. Transcript Preprocessing
   - Split by speaker (Agent vs Seller)
   - Chunk into segments if call > 15 min
   - Strip filler words / clean for LLM
         │
         ▼
4. LLM Analysis (single prompt, structured output)
   Input:  cleaned transcript + seller context (category, tier, ARR)
   Output (JSON):
   {
     "sentiment":    "Negative",
     "summary":      "Seller frustrated with lead quality...",
     "issues":       ["Lead quality dropped", "Competitor offer"],
     "quote":        "I'm paying Platinum but getting retail buyers",
     "disposition":  "Skeptical",          // Willing | Skeptical | Hostile
     "competitor_mentioned": "TradeIndia", // null if none
     "commitment_by_exec":   "Will fix BL filter within 3 days",
     "churn_risk_delta":     +15           // did this call increase or reduce risk?
   }
         │
         ▼
5. CallInsight saved to DB
   Linked to seller ID + call date + agent
         │
         ├──► Update seller's churn score (call sentiment adjusts score)
         ├──► If competitor_mentioned → flag for leadership dashboard
         ├──► If commitment_by_exec → create follow-up task with deadline
         └──► Feed into training dataset (features at call time + eventual outcome)
```

**Mock implementation for hackathon:**
- Include 2–3 pre-written transcript files in `data/transcripts/`
- Run the full pipeline on them to show structured insight extraction
- Demo: paste a transcript into the pipeline → show structured CallInsight appear on dashboard

**CallInsight type (extended from frontend):**

```go
type CallInsight struct {
    ID                 string
    SellerID           string
    Date               string
    DurationMin        int
    Agent              string
    Sentiment          string   // Negative | Neutral | Positive
    Summary            string
    Issues             []string
    Quote              string
    Disposition        string   // Willing | Skeptical | Hostile
    CompetitorMentioned string  // empty if none
    CommitmentByExec   string
    ChurnRiskDelta     int      // +N = more risk, -N = less risk after call
    TranscriptRef      string   // path or ID of raw transcript
}
```

---

### Layer 7 — LLM Layer

LLM is called **only** for natural language generation. All scoring and classification is rule-based. LLM outputs are cached and invalidated only when signals shift significantly.

| Call Type | When Triggered | Cache TTL | Model |
|---|---|---|---|
| Retention Guide | User opens "Retention Guide" tab | 4 hours | claude-sonnet-4-6 |
| Churn Archetype | First time seller is scored; re-run if score shifts >10 pts | 24 hours | claude-sonnet-4-6 |
| Pattern Narrative | Pattern detector fires a new cluster alert | 12 hours | claude-sonnet-4-6 |
| Call Insight Extraction | New call recording processed (Layer 6) | Permanent | claude-sonnet-4-6 |
| SOP Update | Outcome logged → async playbook update | — | claude-sonnet-4-6 |

**LLM is NOT called for:** score computation, tier classification, cause routing, pattern detection, daily brief assembly, upgrade scoring.

**Archetype labels (output of churn archetype classifier):**
- `LeadQualityDissatisfied` — getting poor quality BLs
- `PlatformDisengaged` — stopped using platform, needs re-onboarding
- `CompetitivePressure` — competitor offer received, price-sensitive
- `SeasonalSlowdown` — temporarily low activity, not true churn signal
- `ValueNotRealized` — active but not converting leads to orders

---

### Layer 8 — Pattern Detector

Background job (runs every 4 hours). Finds clusters of sellers showing identical platform failure signals — these indicate a systemic IndiaMart issue, not individual seller problems.

**Algorithm:**
1. Group all HIGH + CRITICAL sellers by `category + geography`
2. For each group with 5+ sellers: check if 3+ share the same dominant failing signals
3. If cluster found: compute total ARR at risk, generate severity rating
4. Trigger LLM to write the escalation narrative (async, non-blocking)
5. Save to `patterns` table, expose via `GET /api/patterns`

**Output example:**
```json
{
  "id": "PAT-001",
  "category": "Industrial Supplies",
  "geography": "Delhi NCR",
  "affectedSellers": ["S-10293", "S-10301", "S-10412", ...],
  "affectedCount": 18,
  "sharedSignals": ["LeadQuality", "BLFilterViolations"],
  "cause": "PLATFORM_FAILURE",
  "totalARR": 4200000,
  "severity": "HIGH",
  "hypothesis": "BL buyer intent scoring miscalibrated for Industrial Equipment in Delhi NCR. 18 sellers receiving 48% retail buyer leads against declared wholesale-only filters.",
  "recommendedAction": "Product team investigation of BL matching algorithm for this category-geography combination.",
  "detectedAt": "2026-05-15T08:00:00Z"
}
```

---

### Layer 9 — XGBoost Evolution Pipeline

Starts with rule-based scoring on Day 1. Automatically upgrades to XGBoost when enough real labeled data exists. No synthetic training data — every label is a real seller outcome.

**Data collection (runs continuously from Day 1):**

Every time a seller is scored, a **feature snapshot** is saved:
```go
type FeatureSnapshot struct {
    SellerID        string
    SnapshotAt      time.Time
    RenewalDaysLeft int
    // All 17 normalized signal scores at snapshot time
    LoginScore      float64
    LMSReplyScore   float64
    // ... all signals
    CompositeScore  float64
    Tier            string
    Cause           string
    // Label set later when outcome is known:
    Label           *int    // nil until outcome logged; 1 = churned, 0 = retained
    LabeledAt       *time.Time
}
```

**Outcome logging** (`POST /api/outcomes`) links a result back to the latest feature snapshot for that seller:
```go
type Outcome struct {
    SellerID       string
    Result         string   // "retained" | "churned" | "followup" | "escalated"
    Objections     []string
    RenewalDate    string   // if retained
    ExecID         string
}
```

**Auto-training trigger:**

```
Background job checks every 24 hours:
  IF labeled_snapshots.count >= 5000:
    trigger XGBoost training job
    evaluate on holdout set (20% split)
    IF xgboost_auc > rule_based_auc + 0.05:
      swap prediction layer to XGBoost
      keep rule-based as fallback + for explainability
      alert via dashboard notification
```

**What changes when XGBoost is active:**
- `compositeScore` is produced by XGBoost model instead of weighted formula
- Feature importances replace manual weights in the "Why flagged" breakdown
- Rule-based cause classification remains unchanged (XGBoost gives score, rules give cause)
- Daily brief, retention guide, pattern detection: unchanged

**Training dataset grows with every retention call logged.** 6 months of real data → significantly better predictions than any synthetic dataset.

---

## API Reference

### Sellers

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sellers` | Paginated seller list with scores. Query: `tier`, `cause`, `category`, `status`, `limit`, `offset` |
| `GET` | `/api/sellers/:id` | Full seller detail: signals, score, tier, cause, route, call window, archetype |
| `GET` | `/api/sellers/:id/retention-guide` | LLM-generated retention guide (triggers LLM call if not cached) |
| `GET` | `/api/sellers/:id/call-insights` | All call insights for seller |
| `GET` | `/api/sellers/:id/upgrade` | Upgrade eligibility score and pitch |

### Dashboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/cohort` | Cohort summary stats (total sellers, high/medium/low counts, ARR at risk) |
| `GET` | `/api/brief` | Daily brief for the exec: priority calls, skip list, upgrade opportunities |
| `GET` | `/api/roi` | ROI dashboard: system cost vs revenue protected this period |

### Patterns

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/patterns` | All active cluster alerts for product team / leadership |
| `GET` | `/api/patterns/:id` | Single pattern detail with affected seller list |

### Outcomes & Playbook

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/outcomes` | Log retention call result (links to feature snapshot) |
| `GET` | `/api/playbook/:archetype` | Current SOP for this seller archetype |

### Call Recordings

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/calls/process` | Submit audio file → STT → LLM → CallInsight saved |
| `GET` | `/api/calls/:id/transcript` | Raw transcript for a processed call |

---

## Data Models

```go
// Core seller (extends frontend Seller type)
type Seller struct {
    ID              string
    Name            string
    Company         string
    City            string
    Category        string
    PackageType     string      // Silver | Gold | Platinum | Star
    RenewalDate     string
    DaysToRenewal   int
    ARR             float64
    Status          string      // Pending | Resolved

    // Scoring
    RiskScore       float64     // 0–100 composite
    RiskTier        string      // CRITICAL | HIGH | WATCH | HEALTHY
    ScoreBreakdown  ScoreBreakdown

    // Cause & routing
    ChurnCause      string      // BEHAVIORAL | PLATFORM | EXTERNAL | MIXED
    ActionRoute     string      // SALES_EXEC | PRODUCT_TEAM | LEADERSHIP | SALES_MANAGER
    Archetype       string      // LeadQualityDissatisfied | PlatformDisengaged | ...
    CallNote        string      // What exec should/should not do before calling

    // Timing
    CallWindowStart string
    CallWindowEnd   string

    // Signals
    BehaviouralSignals map[string]Signal
    PlatformSignals    map[string]Signal
    MarketSignals      map[string]Signal

    // Relations
    CallInsights    []CallInsight
}

type ScoreBreakdown struct {
    Behavioural float64
    Platform    float64
    Market      float64
    SeasonalMod float64
}

type Signal struct {
    Score  float64
    Trend  string   // declining | stable | improving
    Delta  float64
    Label  string
}

// Extended CallInsight (superset of frontend type)
type CallInsight struct {
    ID                  string
    SellerID            string
    Date                string
    DurationMin         int
    Agent               string
    Sentiment           string
    Summary             string
    Issues              []string
    Quote               string
    Disposition         string
    CompetitorMentioned string
    CommitmentByExec    string
    ChurnRiskDelta      int
    TranscriptRef       string
}

// Pattern alert
type Pattern struct {
    ID               string
    Category         string
    Geography        string
    AffectedSellers  []string
    AffectedCount    int
    SharedSignals    []string
    Cause            string
    TotalARR         float64
    Severity         string
    Hypothesis       string
    RecommendedAction string
    DetectedAt       time.Time
}

// Outcome (for XGBoost training pipeline)
type Outcome struct {
    SellerID    string
    Result      string
    Objections  []string
    RenewalDate string
    ExecID      string
    LoggedAt    time.Time
}
```

---

## Project Structure

```
sellerpulse-backend/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── data/
│   │   ├── mock_loader.go          # loads seed sellers from JSON
│   │   ├── seller_repo.go
│   │   ├── call_repo.go
│   │   ├── outcome_repo.go
│   │   ├── pattern_store.go
│   │   └── signal_fetcher.go       # interface + mock + prod implementations
│   ├── signals/
│   │   ├── behavioural.go          # login, LMS, PNS, BL, catalog, support, payment
│   │   ├── platform.go             # lead quality, buyer response, search rank, filter, SLA
│   │   ├── market.go               # category health, competition, seasonality
│   │   └── normalizer.go           # raw → Signal{Score, Trend, Delta, Label}
│   ├── scoring/
│   │   ├── churn_scorer.go         # weighted composite (or XGBoost if model loaded)
│   │   ├── upgrade_scorer.go
│   │   ├── weights.go
│   │   └── xgboost/
│   │       ├── trainer.go          # triggers training when threshold reached
│   │       ├── predictor.go        # loads trained model, replaces weighted scorer
│   │       └── snapshot_store.go   # feature snapshots for training data
│   ├── rules/
│   │   ├── tier.go                 # CRITICAL/HIGH/WATCH/HEALTHY
│   │   ├── cause.go                # BEHAVIORAL/PLATFORM/EXTERNAL/MIXED
│   │   ├── router.go               # SALES_EXEC/PRODUCT_TEAM/LEADERSHIP
│   │   └── intervention.go         # optimal call window
│   ├── calls/
│   │   ├── stt_client.go           # speech-to-text integration (Deepgram/Whisper)
│   │   ├── processor.go            # orchestrates STT → LLM → CallInsight
│   │   └── transcript_store.go
│   ├── llm/
│   │   ├── client.go               # Claude API wrapper + cache
│   │   ├── retention_guide.go
│   │   ├── archetype.go
│   │   ├── call_analyzer.go        # call transcript → structured CallInsight
│   │   ├── pattern_narrator.go
│   │   └── sop_updater.go
│   ├── patterns/
│   │   ├── detector.go             # background clustering job
│   │   └── scheduler.go            # runs detector every 4h
│   ├── brief/
│   │   └── generator.go            # daily brief (no LLM — templated)
│   ├── outcomes/
│   │   ├── handler.go
│   │   └── playbook.go
│   └── api/
│       ├── handlers/
│       │   ├── sellers.go
│       │   ├── cohort.go
│       │   ├── patterns.go
│       │   ├── brief.go
│       │   ├── outcomes.go
│       │   ├── calls.go
│       │   └── roi.go
│       ├── middleware/
│       │   └── cors.go
│       └── router.go
├── pkg/
│   └── models/
│       ├── seller.go
│       ├── signal.go
│       ├── risk.go
│       ├── call.go
│       ├── pattern.go
│       └── outcome.go
├── data/
│   ├── seed/
│   │   └── sellers.json            # 50-seller mock dataset
│   └── transcripts/
│       ├── S-10293-2026-04-28.txt  # sample call transcript (Rakesh Sharma)
│       ├── S-12889-2026-05-02.txt  # Vikram Singh — competitor threat call
│       └── S-15203-2026-04-25.txt  # LMS complaint call
└── go.mod
```

---

## Environment Variables

```env
# Server
PORT=8080
ENV=development

# Claude API
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6

# Speech-to-Text (choose one)
DEEPGRAM_API_KEY=...
# OR
OPENAI_API_KEY=...   # for Whisper

# Cache (in-memory for hackathon, Redis in prod)
CACHE_TTL_RETENTION_GUIDE=14400   # 4 hours
CACHE_TTL_ARCHETYPE=86400         # 24 hours

# XGBoost pipeline
XGBOOST_TRAINING_THRESHOLD=5000   # labeled rows needed before first training
XGBOOST_MIN_AUC_IMPROVEMENT=0.05  # must beat rule-based by this much to switch
```

---

## Local Development

```bash
# Install Go 1.22+
go mod download

# Run with mock data (no real IndiaMart APIs needed)
go run ./cmd/server

# Server starts at http://localhost:8080

# Seed data is loaded automatically from data/seed/sellers.json
# Pattern detector runs immediately on startup (mock mode)
```

**Demo: process a sample call transcript**
```bash
curl -X POST http://localhost:8080/api/calls/process \
  -F "audio=@data/transcripts/S-10293-2026-04-28.txt" \
  -F "seller_id=S-10293" \
  -F "agent=Anita R." \
  -F "duration_min=14"
```

---

## Frontend Integration

The frontend currently reads from `src/lib/mock-sellers.ts`. To wire the backend:

1. Replace `sellers` import in `src/routes/index.tsx` with `GET /api/sellers`
2. Replace `getSeller(id)` in `src/routes/seller.$sellerId.tsx` with `GET /api/sellers/:id`
3. Wire "Retention Guide" tab to `GET /api/sellers/:id/retention-guide` (lazy load)
4. Add new tabs: **Platform Health** (IM-level signals), **Patterns** (cluster alerts)
5. Add outcome logging form to the Retention Guide tab → `POST /api/outcomes`

**API response shape matches frontend `Seller` type** — all existing fields are present, backend adds:
- `churnCause`, `actionRoute`, `archetype`, `callNote`
- `callWindowStart`, `callWindowEnd`
- `platformSignals` and `marketSignals` (new signal groups)
- `upgradeScore`, `upgradeReady`

---

## Roadmap

- Wire to real IndiaMart data warehouse (signal fetcher prod implementation)
- Real-time call processing via WebSocket (streaming STT + live insight extraction)
- XGBoost auto-training with real labeled outcomes
- Push retention actions back into IndiaMart CRM
- Exec mobile app with daily brief push notification
- A/B test rule-based vs XGBoost predictions once both are live
