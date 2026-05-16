# Pipeline Design — Architecture Decision Log

## Decision 1: Three-Tier Architecture vs Alternatives

### Chosen: Tier 1 (rules) → Tier 2 (XGBoost) → Tier 3 (LLM)

**Rejected alternative: LLM-only pipeline**  
A single Gemini call per seller could theoretically replace all three tiers. Rejected for three reasons:
1. **Cost and rate limits:** Gemini free tier allows 5 requests/minute. A 1000-seller nightly batch would take 200 minutes (3.3 hours) if every seller gets one LLM call. With the three-tier approach, Tier 1 inactives (typically 5–10% of cohort) skip the LLM call entirely, saving ~15 minutes per 100 inactive sellers.
2. **Non-determinism:** LLM risk scores fluctuate 5–15 points across identical inputs on different runs. The XGBoost score is deterministic and reproducible — critical for explaining why a seller's risk changed between nightly runs.
3. **Structured output reliability:** XGBoost returns a float directly. Asking an LLM to score risk on a 0–100 scale requires JSON parsing with error handling; structure hallucinations are a real failure mode.

**Rejected alternative: Rules-only (no ML)**  
The weighted rule formula in `scorer.go` handles the majority of cases well. It was rejected as the sole scorer because:
- It cannot capture interaction effects: a seller with a competitor mention AND declining metrics is higher risk than the sum of those signals' individual weights
- It has no "memory" of call insight data — `hasCompetitor` and `disposition` features are only accessible through the ML model
- AUC on the rule score alone: ~0.68. XGBoost with call insight features: ~0.74–0.79

**Rejected alternative: XGBoost without rule-based pre-scoring**  
XGBoost alone could replace the rule formula, but the rule-based score is used as a secondary ranking signal in the dashboard and as a human-interpretable explanation ("login dropped 23 points, BL dropped 18 points"). Removing it would require replacing the explanation mechanism.

---

## Decision 2: LangGraph vs Sequential REST Calls

### Chosen: LangGraph StateGraph

LangGraph compiles the three nodes (score → classify → guide) into a directed graph with typed state. This enables:
- **SSE streaming**: `_graph.stream(initial, stream_mode="updates")` yields one JSON event per completed node, allowing the demo page to show real-time progress without polling
- **State propagation**: XGBoost output (probability, top features) is automatically available to node_classify without manual parameter passing
- **Future extensibility**: Adding a fourth node (e.g., node_whatsapp for automated message drafting) requires only a new node function and one `add_edge` call

**Rejected alternative: Sequential function calls**  
Three Python functions called in sequence would work for the sync path (`run_agent()`). Rejected because SSE streaming would require manual event queuing — LangGraph's `stream_mode="updates"` handles this automatically.

**Rejected alternative: Celery / async task queue**  
For the demo page (real-time, single user), a task queue adds latency (broker round-trip) with no benefit. For nightly batch (already sequential by design due to rate limits), a task queue adds infrastructure complexity. Rejected for both paths.

---

## Decision 3: Gemini 2.5 Flash vs Alternatives

### Chosen: Gemini 2.5 Flash

**Compared alternatives:**

| Model | Cost tier | Avg latency (classify+guide) | JSON reliability | Rejection reason |
|---|---|---|---|---|
| GPT-4o | Paid | ~8s | Excellent | Paid API; adds external cost dependency; not free-tier friendly for 1000+ sellers |
| Claude Sonnet 4.5 | Paid | ~6s | Excellent | Same issue — paid API |
| Gemini 2.5 Flash | Free tier | ~15–20s | Good with `responseMimeType: application/json` | Chosen |
| Gemini 2.5 Flash Lite | Free tier | ~8–12s | Good | Slightly less accurate on cause classification edge cases; not tested with live data |
| Llama 3.3 70B (local) | Infrastructure cost | Varies | Variable | Requires GPU instance; deployment complexity not justified for demo |

**Why Gemini 2.5 Flash:** Available on the free tier (15 requests/minute, 1M tokens/day), supports JSON mode via `responseMimeType: application/json` which eliminates most JSON parsing failures, and is the only capable free-tier model that handles the full context (seller metrics + call history + strategy direction) reliably.

**LLM provider abstraction:** The agent supports `LLM_PROVIDER=openrouter` or `LLM_PROVIDER=litellm` environment variables, allowing teams with paid API access to switch to faster models (GPT-4o, Claude Sonnet) without code changes. The `_llm_call()` function routes to the appropriate client.

---

## Decision 4: Nightly Batch vs Real-Time Scoring

### Chosen: Nightly batch + real-time demo agent as separate paths

**Nightly batch (`POST /api/v1/batch/nightly`):**  
Runs the full three-tier pipeline for all unresolved sellers. Results are persisted to `seller_computed` table in SQLite. The dashboard reads from this pre-computed table — no live LLM calls on page load.

**Real-time demo (`POST /api/v1/agent/analyze/stream`):**  
The LangGraph agent runs on-demand for a single seller. Used by the demo page and for ad-hoc analysis. Does not persist results to the database (demo mode only — persistence could be added without architecture changes).

**Why separate paths rather than real-time for everything:**  
A 1000-seller batch at ~20s per seller (LLM call time) = ~5.5 hours. With the 13s rate-limit delay, actual batch time is ~25 minutes (13s × 1000 sellers ÷ skipping ~5% Tier 1 inactives). Nightly batch is feasible; real-time batch is not.

**The dashboard reads pre-computed results**, meaning no user-facing latency from LLM calls. The real-time path is reserved for on-demand analysis when a KAM wants to re-analyse a seller after a call or update.

---

## Decision 5: SSE Streaming vs WebSocket vs Polling

### Chosen: Server-Sent Events (SSE)

**Why SSE:**  
- Unidirectional — the client never sends data after the initial POST, so WebSocket's bidirectional overhead is unnecessary
- HTTP-native — works through standard proxies and load balancers without configuration
- Simple to implement in Go (`w.Header().Set("Content-Type", "text/event-stream")`) and consume in browser (`EventSource` or `fetch` with streaming body)
- Each LangGraph node completion yields exactly one event — SSE's `data: {...}` per line maps naturally to this

**Rejected: WebSocket**  
Bidirectional protocol overhead is not justified for a send-once, receive-stream pattern. Also requires separate handling in Nginx/Cloudflare proxies.

**Rejected: Polling**  
Would require job queue infrastructure (Redis or SQLite-based) to store intermediate results. SSE keeps results ephemeral, which is appropriate for the demo use case.

---

## Decision 6: Cause Taxonomy (3 causes, not 4 or 5)

### Chosen: External / Seller Disengaged / Mixed

**Original taxonomy (deprecated):** BEHAVIORAL / PLATFORM_FAILURE / EXTERNAL / MIXED

**Why collapsed to 3:**  
BEHAVIORAL and PLATFORM_FAILURE were split causes that both routed to the same Sales Exec owner. The distinction (seller's fault vs platform's fault) is captured at the *archetype* level (ROI Doubter vs Platform Victim) with higher specificity. Maintaining four causes with two routing to the same action created UI confusion ("why is the cause PLATFORM_FAILURE but the owner is the same as BEHAVIORAL?").

**Collapse rationale:**  
- BEHAVIORAL → "Seller Disengaged" (behavioural disengagement subcategory)
- PLATFORM_FAILURE → "Seller Disengaged" (platform frustration subcategory, with archetype=Platform Victim capturing the distinction)
- EXTERNAL → "External" (unchanged)
- MIXED → "Mixed" (unchanged)

**What "Mixed" means precisely:** Mixed is selected ONLY when competitive pressure and disengagement signals carry genuinely equal weight. The LLM prompt explicitly instructs "default to the stronger signal, not Mixed" — Mixed should be rare (estimated <15% of cases). Overuse of Mixed is a failure mode that dilutes routing specificity.

---

## Decision 7: SQLite vs PostgreSQL

### Chosen: SQLite (shared file between Go and Python services)

**Why:**  
- Zero infrastructure setup — no separate database service in Docker Compose
- The seller base (demo: ~20 sellers, production target: ~1000) fits comfortably in SQLite with WAL mode
- Both the Go backend and Python ML service access the same file via Docker volume mount, eliminating the need for an API layer between them for feature snapshot storage

**Known limitation:** SQLite does not support concurrent writes well. The nightly batch writes one seller at a time (already serialised by the rate-limit delay), and the ML service writes feature snapshots sequentially. No concurrent write contention in current design. If batch parallelisation is added in future, migrating to PostgreSQL is the appropriate upgrade path.

**Two DB file paths (important):**
- `/app/data/sellerpulse.db` — backend's active DB (Go writes computed states, outcomes, playbook)
- `/data/sellerpulse.db` — Docker shared volume (ML service seeds training data here on startup)

These are two separate files. The backend HTTP API is the authoritative path for outcome and playbook data. The ML service uses the volume path only for training data seeding. See [deployment.md](deployment.md) for the complete volume mapping.
