---
name: bl-filter-diagnosis
description: >
  Deep-dive into a seller's Business Lead filter misconfiguration on IndiaMART.
  Use this skill when a seller is receiving too many retail leads despite being
  a B2B seller, when BL consumption has dropped while login remains stable, or
  when the seller has explicitly complained about lead quality or relevance. Do
  not use for general engagement drop -- only for lead quality issues.
user-invocable: false
---

## Context
Business Leads (BL) on IndiaMART are buyer inquiries routed to sellers. A misconfigured BL filter causes B2B sellers to receive retail-segment buyers -- wasting seller time and destroying their belief in platform ROI.

This is one of the top-three reasons high-ARR B2B sellers churn. It is fixable, but requires a specific escalation path and commitment protocol.

## Diagnosis Steps

### 1. Confirm the signal
From seller data:
- `retailBlRecommendedPct` latest value -- this is the percentage of leads coming from retail buyers
- `blConsumptionPct` latest vs. 3 months ago -- consumption drop with high login = quality issue, not disengagement

**Severity classification:**
| retailBlPct | Severity | Action |
|------------|----------|--------|
| < 25% | Borderline | Monitor; mention on call but don't escalate yet |
| 25-40% | High | Raise product ticket; commit to fix in 2 weeks |
| > 40% | Critical | Raise ticket immediately + manual lead forwarding commitment |

### 2. Check if systemic
If another seller in the same category (e.g., Industrial Machinery, Construction Materials) has the same complaint, this is a systemic category-level filter issue -- not seller-specific misconfiguration.

To check: call `GET /api/v1/sellers` (no filter params), then filter the returned list locally by matching `category` and `churnCause`. If 2+ sellers in the same category show BL quality as churn cause, it is systemic.

**Why this matters:** A systemic issue gives the seller an explanation that removes blame from them. "Aapke category mein multiple sellers ko yeh problem aa rahi hai -- combined complaint ka weight zyada hoga" de-escalates frustration significantly.

### 3. Compose the on-call script

**Opening (acknowledge first):**
> "Arjun ji, aapka data dekha -- aapke {X}% leads retail segment ke aa rahe hain. Main samajh sakta hoon frustration -- aap B2B supplier hain aur retail buyers aapke kaam ke nahi hain."

**Escalation commitment (give ticket number on the call):**
> "Main abhi ticket raise karta hoon. Ticket number {#} -- is week product team ke paas jata hai. 2 hafte mein filter adjust ho jayega."

**Bridging offer (while fix is pending):**
> "Jab tak fix nahi hota, main personally har hafte 5-10 quality B2B leads filter karke forward karunga directly."

**If systemic:**
> "Aur ek baat -- aapke category mein doosre sellers bhi yahi report kar rahe hain. Main consolidated complaint bhej raha hoon, jisse priority zyada milegi."

### 4. What to log after the call
In the outcome form (`/log-seller-outcome`):
- `churnReasons`: include `lead_quality`
- `competitorMentioned`: fill if seller mentioned one
- `execCommitment`: "BL filter ticket #{N} raised. Manual lead forwarding weekly until fix. ETA 2 weeks."
- `followUpDate`: 5 business days from call

## Hard Constraints
- **Never promise < 2 week fix time.** Product team SLA is 2 weeks minimum. Over-promising and missing it accelerates churn.
- **Never say "quality improve ho jayegi" without the ticket number.** It sounds like a brush-off.
- **Do not offer a discount as the first response** to a BL filter complaint -- it implies you know the product is broken and are paying for it rather than fixing it.
