---
name: log-seller-outcome
description: >
  Log the outcome of a KAM retention call for a seller. Use this skill after
  a call has happened and the KAM wants to record what was discussed, what
  commitments were made, and whether the seller is likely to renew. This feeds
  the ML training dataset and the playbook synthesis. Use when asked to "log
  the call", "record outcome", "update seller status", or "note what happened".
argument-hint: "[seller-id]"
arguments:
  seller: The seller ID (e.g. S-20001) or seller name the call was with
---

## Why This Matters
Every logged outcome trains the XGBoost churn model and feeds the playbook synthesizer. At 5,000 labeled outcomes, the ML model activates as a primary signal. The quality of what KAMs log directly determines model accuracy.

Log honestly — a renewal that churned 2 months later is more valuable training data than a falsely optimistic log.

## Steps

### 1. Confirm which seller
If the user hasn't specified a seller ID, ask: "Which seller was the call with? (name or S-XXXXX ID)"

### 2. Collect outcome details
Ask for the following (one natural conversation, not a form):

- **Did the seller renew, agree to renew, or is it still uncertain?** → maps to `outcome`: `Renewed`, `Committed`, `Uncertain`, `Lost`
- **What was the seller's mood on the call?** → maps to `disposition`: `Willing`, `Skeptical`, `Hostile`
- **What specific issues did they raise?** → maps to `churnReasons` (multi-select): `low_lead_quality`, `price`, `competitor`, `platform_issue`, `no_roi`, `disengaged`
- **Did they mention a competitor?** → `competitorMentioned` (name or empty)
- **What did the KAM commit to doing?** → `commitmentByExec` (free text)
- **When is the follow-up?** → `followUpDate` (YYYY-MM-DD)
- **Anything else worth noting?** → `customReason` (free text, optional)

### 3. Post the outcome
```
POST http://localhost:8080/api/v1/sellers/{sellerId}/outcome
Content-Type: application/json

{
  "outcome": "Renewed",
  "disposition": "Skeptical",
  "churnReasons": ["low_lead_quality", "competitor"],
  "competitorMentioned": "TradeIndia",
  "commitmentByExec": "BL filter ticket raised. Manual lead forwarding weekly.",
  "followUpDate": "2026-05-23",
  "customReason": ""
}
```

### 4. Confirm and summarize
After a successful 200 response, summarize back to the KAM:

> "Logged for {Seller Name}: outcome = {outcome}, follow-up on {date}. This call has been added to the training dataset. {N} total outcomes logged so far — ML model activates at 5,000."

## Gotchas
- `outcome` values are case-sensitive: `Renewed`, `Committed`, `Uncertain`, `Lost` — not lowercase
- `churnReasons` is an array even if only one reason
- `commitmentByExec` should be specific enough that a different KAM could read it and know exactly what was promised — "will follow up" is not sufficient
- `followUpDate` must be a future date. If the seller already churned, use today's date and set outcome to `Lost`
- If the KAM says "I don't know yet" for outcome, use `Uncertain` — do not default to `Committed`
