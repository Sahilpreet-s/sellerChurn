---
name: run-nightly-batch
description: >
  Trigger the SellerPulse nightly enrichment pipeline, which re-scores all
  active sellers using latest call insights, pushes features to the XGBoost
  ML model, and regenerates retention guides. Use this skill when asked to
  "run the batch", "refresh seller data", "update churn scores", or
  "process tonight's transcripts."
disable-model-invocation: true
---

## What the Batch Does
For each unresolved seller, the nightly pipeline:
1. Merges today's call transcripts with accumulated call history
2. Re-derives rule-based risk score, churn cause, and archetype
3. Pushes the 18-feature vector to the XGBoost ML service and fetches churn probability
4. Makes a single Gemini call that simultaneously extracts call insight from transcripts AND generates a personalized retention guide
5. Persists everything to `seller_computed` — the API serves pure DB reads after this

Rate-limited to one seller every ~13 seconds to stay within Gemini free-tier quota.

## Steps

### 1. Confirm intent
This triggers real LLM calls (one per active seller). Confirm before proceeding if there are more than 3 sellers.

### 2. Trigger the pipeline
```
POST http://localhost:8080/api/v1/batch/nightly
Content-Type: application/json
{}
```

The request will block until the pipeline completes. For 6 sellers it takes approximately 80–90 seconds.

### 3. Report results
Parse the response:
```json
{ "processed": 5, "message": "Nightly batch complete. 5 sellers enriched." }
```

Report:
- How many sellers were processed
- If any sellers were skipped (Status = "Resolved")
- Remind the user that guides are now pre-computed and the API serves them from DB — zero LLM latency on the next dashboard load

### 4. Verify a specific seller (optional)
If the user wants to confirm enrichment worked:
```
GET http://localhost:8080/api/v1/sellers/{sellerId}
```
Check that `computedAt` is a recent timestamp and `mlChurnProb` is present.

## Gotchas
- The batch skips sellers with `status: "Resolved"` — this is intentional
- If the ML service is not running, `mlChurnProb` will be 0 for all sellers — guide still generates using rule-based signals only
- Transcripts are loaded from `./data/transcripts.json` — confirm this file is up-to-date before running
- If the batch fails mid-way, sellers processed before the failure retain their updated `seller_computed` state. Re-running is safe — it upserts, not appends
