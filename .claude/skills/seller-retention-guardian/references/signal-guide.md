# Signal Guide — IndiaMART Metric Glossary and Thresholds

## Platform Terminology

| Term | Full name | What it measures |
|---|---|---|
| BL | Buy-Lead | A buyer inquiry routed to a seller by IndiaMART's matching algorithm |
| PNS | Push Notification System | Automated outbound call connecting buyers directly to sellers |
| LMS | Lead Management System | IndiaMART's CRM-like interface where sellers manage and reply to BL inquiries |
| CQS | Content Quality Score | Proprietary score (0–100) measuring product listing completeness and quality |
| KAM | Key Account Manager | Sales executive responsible for seller retention and renewal |
| ARR | Annual Recurring Revenue | Seller's subscription value, used to prioritise triage (higher ARR = higher priority) |
| GLID | Global Lead ID | Unique seller identifier on IndiaMART platform |

---

## The 18 XGBoost Features

### Engagement Level Features (_last)

**`loginPct_last`** — Login % for the most recent month  
Range: 0–100. A seller who logs in ≥60% of business days is considered actively engaged. Below 20% for two consecutive months is a strong warning sign. Combined with `loginPct_drop`, it separates "never engaged" (low last, low drop) from "rapidly disengaging" (low last, high drop).

**`blPct_last`** — BL Consumption % for the most recent month  
Range: 0–100. Percentage of allocated Buy-Leads that were opened and acted on. Below 40% sustained for >8 weeks consistently precedes renewal cancellation. Note: BL consumption can be low in a good month if the seller received very few BLs (lead allocation issue, not seller disengagement) — always check absolute BL count alongside percentage.

**`pnsPct_last`** — PNS Pickup Rate % for the most recent month  
Range: 0–100. Percentage of automated PNS calls answered. Below 30% may indicate connectivity issues or operational unavailability, not just disengagement — use in conjunction with call insight disposition.

**`lmsPct_last`** — LMS Reply Rate % for the most recent month  
Range: 0–100. Percentage of BL inquiries that received a seller reply within the platform. Below 25% is a strong disengagement signal — the seller is receiving leads but not responding.

**`retailPct_last`** — Retail BL Recommended %  
Range: 0–100. Percentage of BLs recommended to this seller that are classified as "retail" (consumer) rather than "wholesale" (B2B bulk buyer). Above 52% indicates a BL filter configuration mismatch — the seller is a wholesale supplier but is being matched with retail consumers. This is a platform health signal, not a seller disengagement signal. Escalate to Product team, not directly to the seller.

**`catalogScore`** — Catalog Score (most recent value)  
Range: 0–100. Composite score of product listing quality: completeness, images, specifications, category accuracy. Changes slowly (weekly at most). Below 40 appears in 73% of Overwhelmed Starter profiles.

**`cqs`** — Content Quality Score (most recent value)  
Range: 0–100. More granular than Catalog Score — measures product description richness, keyword density, and image quality per listing. Updates more frequently. Below 45 combined with low BL consumption suggests the seller's listings are not attracting quality leads.

### Engagement Trend Features (_drop)

**`loginPct_drop`** — Login % drop over 3 months (first month value minus last month value, floored at 0)  
A drop above 20 points in 3 months is a strong leading indicator. Drop above 35 points with no external explanation (seasonality, competitor) is High risk regardless of the current level.

**`blPct_drop`** — BL Consumption % drop over 3 months  
Drop above 18 points is significant. Correlates strongly with `loginPct_drop` — if both are dropping simultaneously, cause is almost certainly behavioural disengagement.

**`pnsPct_drop`** — PNS Pickup Rate % drop over 3 months  
Drop above 15 points warrants investigation. PNS drops often lag login drops by 2–3 weeks.

**`lmsPct_drop`** — LMS Reply Rate % drop over 3 months  
Drop above 12 points. If LMS drops but PNS is stable, the seller is still picking up calls but not following up in the system — may indicate they are using phone but not the platform interface.

### Seller Metadata Features

**`priorChurn`** — Binary (0/1). Seller has churned and been re-acquired at least once.  
Re-acquired sellers require a higher-touch onboarding strategy. In the first 90 days after re-acquisition, check-in frequency should be 2× the standard.

**`daysToRenewal`** — Days remaining until renewal date.  
Risk is highest in the 0–60 day window. Sellers at 30–60 days who have not been contacted are in the critical intervention window. Note: `daysToRenewal=0` means the renewal date has passed — seller may be on a grace period.

**`arr_norm`** — ARR normalised to the dataset range (ARR / 350,000).  
350,000 represents approximately the 95th percentile ARR in the IndiaMART seller base. This normalisation keeps the feature in a comparable range to the 0–1 binary features. Higher ARR sellers receive proportionally higher attention in the dashboard sort order.

### Call Insight Features

**`hasCompetitor`** — Binary (0/1). Any call insight has `competitorMentioned` populated.  
When true, the churn cause is almost always "External" or "Mixed". The competitor name is logged and passed to the LLM for guide generation — the guide strategy changes significantly when a named competitor is present.

**`disposition`** — Most recent call disposition, encoded as: 0=Willing, 0.5=Skeptical, 1=Hostile.  
Hostile disposition (1.0) is one of the top-5 XGBoost features by importance. A seller who was "Willing" last quarter but is now "Hostile" on the most recent call is in acute churn risk regardless of their engagement metrics.

**`churnReasonCount`** — Distinct issue count across all call insights, normalised by 9 (the max known issue categories).  
More distinct issues = broader dissatisfaction. A seller reporting 4+ distinct issues (churnReasonCount ≥ 0.44) rarely renews without a significant retention intervention.

**`hasExecCommitment`** — Binary (0/1). Any call has `commitmentByExec` populated.  
Protective factor — when an exec has made a specific commitment (e.g., "I will arrange a catalog review by Friday"), the seller is more likely to wait for resolution before churning. Absence of any exec commitment with a Hostile disposition is a strong escalation signal.

---

## Signal Interaction Patterns

### Platform Victim pattern
`retailPct_last > 52%` AND `pnsPct_last < 35%` AND call issues contain "BL filters not working"  
→ Root cause is platform-side, not seller behaviour. Escalate to Product immediately. Do not pitch renewal until the filter is fixed — the seller has a legitimate grievance.

### ROI Doubter pattern
`blPct_last` stable but low (35–50%), `loginPct_last` declining, no competitor mentions, no platform issues  
→ Seller is logging in less because they perceive low value, but still consuming some leads. Best intervention: ROI demonstration using their own enquiry data. Show absolute lead count and conversion rate, not percentages.

### Competitor Target pattern
`hasCompetitor = 1`, `disposition ≥ 0.5` (Skeptical or Hostile), metrics stable or only slightly declining  
→ Metrics are propped up by residual activity while the seller evaluates switching. Do not wait for metric decline — intervene immediately. The competitor conversation is already happening.

### Silent Churner pattern
`loginPct_last < 15%`, `blPct_last < 15%`, `lmsPct_last < 10%`, no call insights, `hasCompetitor = 0`  
→ Seller has disengaged completely without any expressed reason. Often in the Seller Inactive or ROI Doubter archetype. Requires a proactive outreach call before any guide generation is meaningful — the seller may not even remember they have an active subscription.

### Overwhelmed Starter pattern
`priorChurn = true`, `catalogScore < 50`, `loginPct_drop > 20` within first 60 days of re-acquisition  
→ Seller returned but never properly onboarded. Assign catalog support resource immediately. The guide should focus on setup completion, not retention negotiation.
