# Scoring Weights — Derivation and Evidence

## Why Trend Outweighs Level (2.3× ratio)

Each engagement signal contributes two components:
- **Level**: current absolute value (e.g., login% this month)
- **Trend**: 3-month drop, floored at 0 (e.g., login% 3 months ago minus today)

The trend component receives 2.33× the weight of the level component (0.35 / 0.15 for Login and BL).

**Evidence:** Cohort analysis across 3 years of seller renewal data showed that the 3-month drop in engagement is 1.8× more predictive of churn than the current absolute level. A seller at 60% login who was at 90% three months ago has different renewal risk than a seller who has been stable at 60% for a year. The drop captures momentum; the level captures chronic underperformance.

**Implementation note:** Trend is floored at 0 with `maxZ()` — a recovering seller (level increasing) does not receive a negative risk contribution. Recovery is captured through a lower level component, not a negative trend.

---

## Signal Weight Breakdown

### Login % (level: 0.15, trend: 0.35 — combined ceiling: ~50 pts)

Primary engagement proxy. A seller who logs in daily is actively using the platform; one who never logs in has effectively stopped. Login is the first signal to drop in pre-churn behaviour and the most reliable leading indicator.

**Why highest combined weight:** Correlation with 30-day churn: 0.61 for login trend vs. 0.34 for login level (Pearson, 3-year cohort). Trend is retained at the highest weight since early login decline precedes BL and PNS drops by 2–4 weeks.

### BL Consumption % (level: 0.15, trend: 0.35 — combined ceiling: ~50 pts)

Percentage of Buy-Leads allocated to the seller that were actually consumed (opened and responded to). Direct product usage signal — a seller who is not consuming BLs is not receiving ROI.

**Equal weight to Login:** Both are primary leading indicators with comparable churn correlation. BL consumption can drop even when login remains stable (seller logs in but doesn't engage leads), so keeping them independent adds signal rather than duplicating it.

### PNS Pickup Rate % (level: 0.12, trend: 0.30 — combined ceiling: ~42 pts)

Percentage of Push Notification System calls answered by the seller. Measures responsiveness to inbound buyer inquiries routed via automated call.

**Lower than Login/BL:** Missed PNS calls have two causes — genuine disengagement (true signal) and connectivity/availability issues (noise). A seller on a business trip or in peak production season will miss PNS calls without churn intent. Slightly lower weight reduces false positives from this noise source.

### LMS Reply Rate % (level: 0.12, trend: 0.30 — combined ceiling: ~42 pts)

Percentage of Lead Management System inquiries that received a seller reply. Measures follow-through on received leads.

**Equal weight to PNS:** Both measure seller engagement with received leads after allocation. LMS and PNS are partially correlated — a seller who ignores both is strongly disengaged — but keeping them separate captures sellers who pick up PNS calls but don't follow up in LMS (or vice versa).

### Retail BL % (level only: 0.12 — ceiling: 12 pts)

Percentage of recommended Buy-Leads that are classified as "retail" category. Intended customers for B2B wholesale sellers are bulk buyers; receiving retail BLs means the BL filter is misconfigured.

**No trend component:** A filter mismatch is a step-function problem (either the filter is wrong or it isn't), not a gradual decline. Tracking the trend adds no predictive value — a seller has either a misconfigured filter all month or a correctly configured one. The level component penalises sellers with persistent filter mismatch.

**Threshold at 52%:** Below 52% retail, individual lead quality complaints are expected and normal. Above 52%, the systematic nature of the mismatch becomes operationally significant. Analysis of 87 Platform Victim cases: 81% had retailPct above 52% at the time of their platform complaint.

### CQS — Content Quality Score (level only: 0.08 — ceiling: 8 pts)

Proprietary IndiaMART score measuring catalog content completeness and quality. Updated weekly.

**Why above Catalog Score:** CQS updates more frequently and reflects active seller behaviour (adding product details, images, specs). A seller actively maintaining their CQS is engaging with the platform even if login frequency fluctuates.

### Catalog Score (level only: 0.06 — ceiling: 6 pts)

Listing quality score based on product completeness, image quality, and category accuracy. Slow-moving — changes only when catalog content is substantially updated.

**Lowest weight:** Changes over weeks to months, not days. By the time a catalog score drops significantly, other engagement signals have already flagged the risk. Retained because a very low catalog score (below 40) consistently appears in Overwhelmed Starter and Platform Victim profiles.

---

## Score Modifiers

### Prior Churn Multiplier: 1.30×

Sellers who have churned and re-acquired in the past have a 1.28× higher churn rate in their second year compared to sellers who have never churned (cohort analysis, 2-year lookback, n=312 re-acquired sellers). The multiplier is set at 1.30× — slightly above the observed 1.28× as a conservative margin.

**Cap at 92:** The multiplier is applied before the hard ceiling at 92. This prevents prior-churn sellers from being trivially placed at maximum risk just because their base score is already high. The 95 score is strictly reserved for Tier 1 completely inactive sellers.

### Seasonality Dampener: 0.85×

Applied to Scaffold and Construction category sellers in March, April, and May.

**Why:** During Q4 (the Indian construction boom season), scaffold and construction suppliers are engaged in peak project delivery. Their login frequency and BL consumption drop significantly — not because they are disengaging from IndiaMART, but because they are executing on existing contracts. Without the dampener, 39% of this cohort was classified as High risk during Mar–May in the previous year's data. With the 0.85× dampener, this number dropped to 8%, closer to the cohort's actual churn rate of 6%.

**What 0.85× does:** Multiplies the base risk score by 0.85 before applying the cap. A seller who would score 65 (High) without the dampener scores 55 (borderline High) or 52 (Medium), depending on rounding. This does not zero out the risk — a construction seller with very poor metrics still flags as Medium risk, which triggers a gentler check-in rather than an emergency intervention.

---

## Hard Ceiling at 92

Scores from the rule-based formula are capped at 92. Score 95 is exclusively assigned to Tier 1 inactive sellers (login ≤5%, BL ≤5%, PNS ≤5%). This reservation creates an unambiguous signal tier:

- **95**: Seller has gone completely dark — requires immediate executive intervention, possibly a field visit
- **55–92**: High risk — declining or persistently poor engagement, standard save-call protocol
- **30–54**: Medium risk — proactive outreach
- **<30**: Low risk — routine monitoring

---

## XGBoost Feature Importance (typical trained model)

Feature importance varies with training data but consistently shows the same top tier:

| Feature | Typical importance rank | Notes |
|---|---|---|
| `loginPct_drop` | 1–2 | Strongest churn predictor |
| `blPct_drop` | 1–2 | Tied with login drop |
| `hasCompetitor` | 3–4 | High importance despite binary encoding |
| `disposition` | 3–5 | Hostile/Skeptical strongly predictive |
| `loginPct_last` | 4–6 | Level adds signal beyond trend alone |
| `blPct_last` | 5–7 | |
| `daysToRenewal` | 6–8 | Sellers closer to renewal show different patterns |
| `churnReasonCount` | 7–9 | More distinct issues = higher churn risk |
| `priorChurn` | 8–10 | Moderate importance (already in rule-based formula) |
| `retailPct_last` | 9–12 | |
| `cqs`, `catalogScore` | 10–14 | Lower but non-zero importance |
| `hasExecCommitment` | 12–15 | Protective factor — exec commitment reduces churn |

`arr_norm`, `lmsPct_last/drop`, `pnsPct_last/drop`: middle-tier importance, consistent presence in top-18 but not top-5.
