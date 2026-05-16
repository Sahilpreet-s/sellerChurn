
## Name: ChurnGaurd

## Description:
Self-improving seller churn prevention skill for B2B marketplace KAMs. Combines rule-based inactive detection, XGBoost probability scoring (18 signals, AUC 0.74–0.80), and LLM cause classification to produce tailored retention guides. Model retrains automatically as real KAM outcomes are logged — accuracy improves over time without manual intervention.

Use when: identifying sellers at risk of non-renewal · classifying churn cause (External / Seller Disengaged / Mixed) · generating KAM call scripts and retention playbooks · triaging the nightly risk cohort.

IndiaMART glossary — BL: Buy-Lead · PNS: Push Notification System · LMS: Lead Management System · CQS: Content Quality Score · KAM: Key Account Manager.

# ChurnGaurd

Early-warning system for B2B marketplace seller churn. Runs nightly across all unresolved sellers via a Go batch pipeline and in real time via a LangGraph agent demo endpoint.

## Architecture: Three-Tier Pipeline

```
Seller metrics
      │
      ▼
[Tier 1] Inactive check (scorer.go: IsInactiveSeller)
  login ≤5% AND BL ≤5% AND PNS ≤5%?
      │ yes → riskScore=95, archetype="Seller Inactive", static guide — NO LLM/XGBoost call
      │ no  ↓
[Tier 2] XGBoost (ml/trainer.py + agent.py:node_score)
  18-feature vector → churn probability
  riskScore = round(prob × 92)    ← 92 ceiling reserves 95 for Tier 1 inactives
      │
      ▼
[Tier 3] LangGraph agent (ml/agent.py)
  node_classify → churn cause + LLM risk score 0–100
  node_guide    → 3 immediately actionable KAM sections
      │
      ▼
  Persist to seller_computed (SQLite)
  Rebuild playbook from accumulated outcomes
```

**Why three tiers, not LLM-only:** Tier 1 inactives are unambiguous — no LLM call needed; saves quota and reduces batch time by ~13s per inactive seller. XGBoost (Tier 2) handles the continuous risk spectrum deterministically; LLM (Tier 3) handles cause nuance and natural-language guide generation. Running Gemini on every seller would cost ~13× more in API time with no accuracy gain on the scoring dimension. See [pipeline-design.md](references/pipeline-design.md) for full decision log.

---

## Tier 1: Inactive Seller Detection

```go
// backend/internal/scorer/scorer.go
func IsInactiveSeller(s models.RawSeller) bool {
    return latest(s.Metrics.LoginPct) <= 5 &&
        latest(s.Metrics.BlConsumptionPct) <= 5 &&
        latest(s.Metrics.PnsPickupRatePct) <= 5
}
```

Sellers meeting all three conditions get `riskScore=95`, `archetype="Seller Inactive"`, `churnCause="Seller Disengaged"`, and a static guide without consuming any ML or LLM quota.

---

## Tier 2: Risk Scoring + XGBoost

### Rule-based scoring formula (scorer.go: CalcRisk)

Each signal contributes a **level component** (current absolute value) and a **trend component** (3-month drop, floored at 0). Trend carries 2.3× the weight of level — a declining seller at 60% is higher risk than a stably-low seller at 60%.

| Signal | Level wt | Trend wt | Design rationale |
|---|---|---|---|
| Login % | 0.15 | 0.35 | Primary engagement signal. Trend validated at 1.8× higher churn correlation than level alone |
| BL Consumption % | 0.15 | 0.35 | Direct product usage. Equal weight to Login — both are leading renewal predictors |
| PNS Pickup Rate | 0.12 | 0.30 | Responsiveness to incoming leads. Lower than Login/BL — missed PNS can be an ops config issue, not pure disengagement |
| LMS Reply Rate | 0.12 | 0.30 | Lead follow-through. Same weight as PNS — both measure seller engagement with received leads |
| Retail BL % | 0.12 | — | Platform health indicator only. No trend component: a filter mismatch is binary (present or resolved), not a gradual decline |
| CQS | 0.08 | — | Content quality score. Slightly above Catalog Score — updates more frequently, reflects active seller behaviour |
| Catalog Score | 0.06 | — | Listing quality. Lowest weight — slow-moving, less predictive of imminent churn than engagement signals |

**Score modifiers:**
- **Prior churn multiplier: 1.30×** — sellers with a prior churn event have 1.28× higher year-2 churn rate (cohort analysis). Rounded to 1.30× conservatively. Cap: 92.
- **Seasonality dampener: 0.85×** — scaffold/construction sellers in Mar–May. Without it, ~40% of this cohort were misclassified High risk during peak project season when engagement drops because they are *busy*, not disengaging.
- **Hard ceiling at 92** — score 95 is reserved for Tier 1 inactives. This preserves a meaningful gap between "completely dark" and "actively declining."

**Risk bands:**

| Band | Score | SLA |
|---|---|---|
| High | ≥55 | Save-call within 48h — escalate to Sales Exec |
| Medium | 30–54 | Proactive outreach within 72h |
| Low | <30 | Routine check-in at next scheduled touch |

**Why 55, not 70:** Testing a 70 High threshold reduced recall by 31% with no precision improvement — too many Medium-band sellers were churning silently. Sellers scoring ≥55 churn at 3.2× the base rate. 55 is the empirically validated intervention threshold.

### XGBoost: 18-feature vector

```python
# ml/agent.py — _build_xgb_features() mirrors nightly.go:buildFeatures() exactly
FEATURE_COLS = [
    "loginPct_last", "loginPct_drop",        # engagement level + 3-month drop
    "blPct_last",    "blPct_drop",            # BL usage
    "pnsPct_last",   "pnsPct_drop",           # PNS responsiveness
    "lmsPct_last",   "lmsPct_drop",           # LMS reply rate
    "retailPct_last", "catalogScore", "cqs",  # platform health
    "priorChurn", "daysToRenewal", "arr_norm",# seller metadata
    "hasCompetitor", "disposition",           # call insight signals (0/0.5/1)
    "churnReasonCount", "hasExecCommitment",  # call quality signals
]
# arr_norm = arr / 350_000  (normalises ARR to ~0–1 range for the dataset)
# disposition: 0=Willing, 0.5=Skeptical, 1=Hostile (most recent call)
# churnReasonCount = distinct issue count / 9 (normalised)
```

Model parameters: `n_estimators=60, max_depth=3, learning_rate=0.1, subsample=0.8, colsample_bytree=0.7`.  
Deliberately shallow (`max_depth=3`) to prevent overfitting on the 500-row seed dataset.  
Model saved only when new AUC exceeds previous by >0.01 (anti-regression guard).

**Alternatives considered and rejected:**

| Approach | AUC | Rejection reason |
|---|---|---|
| Logistic regression | ~0.64 | Too linear — misses interaction between BL drop and `hasCompetitor` signal |
| LightGBM | ~0.74 | Similar AUC but heavier memory footprint for a small dataset; XGBoost's depth constraint is a better inductive bias here |
| Equal-weight rules | ~0.68 | Login trend and BL trend are empirically 2× more predictive than catalogScore or CQS — equal weights under-reward the strongest signals |
| Pure rule-based (no ML) | N/A | Catches obvious cases but cannot capture competitor+stable-metrics pattern handled by `hasCompetitor` feature |
| LLM-only scoring | N/A | Non-deterministic, slow (10–20s per seller), and cannot be batch-run across 1000+ sellers within rate limits |

---

## Tier 3: LangGraph Agent (classify → guide)

Two sequential nodes. The graph is compiled once at service startup and reused.

### node_classify

Input: seller profile + metrics + call insights + XGBoost output.  
Output: `cause ∈ {External, Seller Disengaged, Mixed}` + LLM-derived risk score 0–100.

**Cause taxonomy design decision:** "Seller Disengaged" intentionally covers both behavioural disengagement (low login, unused BL) and platform frustration (Retail BL >52%, low CQS). Splitting them would duplicate what the *archetype* field already captures (Platform Victim vs ROI Doubter), adding routing complexity with no downstream value — both causes route to the same Sales Exec owner.

**Seasonal context:** Current month is passed explicitly in the prompt. Mar–May construction dips and Oct–Dec textile seasonality are acknowledged so the LLM does not over-classify a seasonal softening as churn risk.

**Retail BL% threshold (>52%):** Above 52%, the BL filter is systematically misconfigured for a wholesale seller. Analysis of Platform Victim cases: 81% had retailPct >52%. Below 52%, complaints are about individual lead quality, not platform config.

### node_guide

Input: cause + seller profile + strategy direction.  
Output: 3 actionable sections, each with title, pitch (words the exec reads aloud), and 3 concrete steps.

**Strategy direction per cause:**
- **External:** Lead with the seller's own lead history data — make the ROI concrete. Never open with a price discount; it signals the product isn't worth full price.
- **Seller Disengaged:** If Retail BL% >52 or CQS is low, acknowledge the platform issue *before* any retention argument. The seller must feel heard first. If purely behavioural, schedule an account review within 48h and demonstrate ROI.
- **Mixed:** Separate platform complaints and competitive threat into different segments of the call. Do not let one exec carry both angles alone — Sales Manager must coordinate.

---

## Six Seller Archetypes (classifier/cause.go)

Classified in priority order — first matching condition wins:

| Archetype | Detection logic | Owner | Retention approach |
|---|---|---|---|
| Healthy | login >78% AND BL >60% | — | Upsell candidate; route to Upselling view |
| Overwhelmed Starter | priorChurn=true AND catalogScore <50 | Sales Exec | Re-run onboarding; assign dedicated catalog support |
| Competitor Target | competitorMentioned on any call | Sales Manager | Counter pitch with lead history data; involve SM for escalated negotiation |
| Platform Victim | platformIssue in calls OR retailBL >52% | Product + Sales Manager | Escalate to Product first; SM coordinates fix timeline |
| Seasonal Dip | Scaffold or Construction category | Monitor | Dampened score; no immediate intervention unless score still ≥55 after dampening |
| ROI Doubter | Default (none of the above) | Sales Exec | Value demonstration; show ROI dashboard; offer account health review |

---

## Scripts

| Script | Input | Output | Requires API? |
|---|---|---|---|
| `scripts/score.py <seller.json>` | Seller JSON file | Risk score, band, archetype, cause | No — pure Python |
| `scripts/analyze.py <seller_id>` | Seller GLID | Full 3-tier analysis, streamed | Yes — stack running on port 8080 |
| `scripts/extract_insights.py` | Transcript on stdin | Structured CallInsight JSON | Yes — LITELLM_API_KEY in env |

```bash
# Offline scoring — no API needed
python scripts/score.py seller.json

# Full agent pipeline (requires Docker stack)
python scripts/analyze.py S-20001

# Extract insights from transcript
echo "Seller mentioned TradeIndia offer, seems skeptical" | python scripts/extract_insights.py
```

---

## Environment

```bash
LLM_PROVIDER=litellm
LITELLM_BASE_URL=https://imllm.intermesh.net
LITELLM_API_KEY= API_KEY
LLM_MODEL=google/gemini-2.5-flash-lite

PORT=8080
DB_PATH=./data/sellerpulse.db
SELLERS_FILE=./data/sellers.json
TRANSCRIPTS_FILE=./data/transcripts.json
ML_SERVICE_URL=http://localhost:8001

```

**Critical:** The ml container requires `env_file: - ./backend/.env` in `docker-compose.yml`. Without it, `LITELLM_API_KEY` is empty in the Python container and all LLM calls in the agent return HTTP 403.

Full deployment guide: [deployment.md](references/deployment.md)

---

## Monitoring and SLA

| Endpoint | Target P95 | Notes |
|---|---|---|
| `GET /api/v1/sellers` | <200ms | In-memory JSON + computed state join |
| `GET /api/v1/sellers/:id` | <200ms | Single seller with computed state |
| `POST /agent/analyze` (sync) | <30s | XGBoost <1ms + Gemini classify+guide ~15–25s |
| `POST /agent/analyze/stream` (SSE) | First event <3s | XGBoost node fires in <1ms; SSE keeps connection alive |
| `POST /api/v1/batch/nightly` | ~13s × seller count | 13s inter-seller delay for Gemini free-tier (5 req/min) |
| `POST /api/v1/ml/retrain` | <60s | Retrains on all labeled outcomes in DB |
| `GET /api/v1/playbook` | <100ms | SQLite read; rebuilt asynchronously |

**Drift detection:** Weekly — compare rule-based risk score against XGBoost probability for the same cohort. Average divergence >15 points signals feature distribution shift. Trigger retrain via `POST /api/v1/ml/retrain`. If AUC drops >0.05 below baseline on new labeled outcomes, review seed data distribution.

**Non-goals:** This system surfaces signals and guides — it does not replace CRM, call scheduling, or send communications autonomously. Every suggested action requires human KAM execution.

---

## References

- [scoring-weights.md](references/scoring-weights.md) — full weight derivation, cohort evidence, prior churn multiplier and seasonality dampener rationale, XGBoost feature importance detail
- [signal-guide.md](references/signal-guide.md) — all 18 features explained in IndiaMART context, threshold values, signal interaction patterns
- [pipeline-design.md](references/pipeline-design.md) — architecture decision log: LangGraph vs alternatives, Gemini vs GPT-4, SSE streaming design, nightly vs real-time trade-offs
- [deployment.md](references/deployment.md) — Docker Compose wiring, env var guide, rate-limit handling, DB path details, retrain trigger procedure
