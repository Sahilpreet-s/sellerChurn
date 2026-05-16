---
name: analyze-seller
description: >
  Analyze an IndiaMART seller's churn risk and produce a ready-to-use KAM
  retention brief. Use this skill when a Key Account Manager needs to prepare
  for a renewal call, wants to understand why a seller's engagement dropped,
  or asks about a specific seller account — even if they don't say "churn"
  or "risk." Works with seller IDs (S-20001) or seller names.
argument-hint: "[seller-id-or-name]"
arguments:
  seller: The seller ID (e.g. S-20001) or seller name to analyze
---

## Goal
Produce a ready-to-use retention brief with exact numbers, specific talking points, and commitments the KAM can make on the call — not generic advice.

## Steps

### 1. Fetch seller data
```
GET http://localhost:8080/api/v1/sellers/{seller}
```
If not found by ID, call `GET /api/v1/sellers` and match by name (case-insensitive).

### 2. Detect active signals and load specialist knowledge

Check each condition and load the referenced file when true:

| Signal | Condition | Action |
|--------|-----------|--------|
| BL Filter Issue | `blConsumptionPct` latest < 50 OR `retailBlRecommendedPct` latest > 35 | Read `references/metric-thresholds.md` → BL Filter section |
| Competitor Pressure | call insights contain competitor name OR `mlTopFeatures` includes `hasCompetitor` | Read `references/metric-thresholds.md` → Competitor section |
| Login Disengagement | `loginPct` drop (first − last) > 20 points | Read `references/metric-thresholds.md` → Login section |
| PNS Neglect | `pnsPickupRatePct` latest < 40 | Note in brief: seller is missing incoming leads |
| Renewal Urgency | `daysToRenewal` < 60 AND `arr` > 150000 | Read `references/metric-thresholds.md` → Renewal section |
| Prior Churn | `priorChurn: true` | Flag 2.3× re-churn risk — handle with heightened care |

### 3. Classify risk level
- **Critical** (act this week): `riskScore` > 75 OR `daysToRenewal` < 30
- **High** (act this month): `riskScore` 50–75 OR `daysToRenewal` 30–60
- **Monitor**: `riskScore` < 50 AND `daysToRenewal` > 60

If `mlChurnProb` > 0.70 but `riskScore` < 50, surface this discrepancy explicitly — ML is seeing a pattern the rule engine missed.

### 4. Fetch the pre-computed retention guide
```
POST http://localhost:8080/api/v1/sellers/{sellerId}/guide
Content-Type: application/json
{}
```
The response contains nightly-computed guide sections (`title`, `pitch`, `actions`). Present every section in the brief.

If `computedAt` is absent from seller data, the nightly batch hasn't run yet — the guide endpoint will generate one in real-time (takes ~15 seconds).

### 5. Format the brief

```
━━━ SELLER BRIEF: {Name} ({ID}) ━━━
Risk: {Critical/High/Monitor} | Renewal: {N} days | ARR: ₹{X}k
ML Churn Prob: {X}% | Rule Score: {Y}/100 | Archetype: {archetype}

ACTIVE SIGNALS:
• {signal}: {exact metric number and what it means}

RETENTION GUIDE:
[Section Title]
  Pitch: "{exact KAM script from guide}"
  Actions:
    1. {action}
    2. {action}
    3. {action}

WHAT NOT TO DO:
• {playbook don't-do items if available}

ESCALATE IF:
• {conditions that require senior KAM involvement}
```

## Gotchas
- Seller IDs are always uppercase: S-20001, never s-20001
- `riskScore` is rule-based (0–100). `mlChurnProb` is XGBoost probability (0.0–1.0 → display as %). Never collapse them into one number
- Never mention the ML model or churn score to the seller — these are internal signals only
- `daysToRenewal` < 45 AND `arr` > 200000 → flag for senior KAM escalation before the call, not after
- If `priorChurn: true`, the seller has lapsed before. Do NOT lead with "we want to keep you" — it signals desperation. Lead with value delivered since re-join
- Call insights are ordered chronologically. The most recent disposition is the most relevant signal
