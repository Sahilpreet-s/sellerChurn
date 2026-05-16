# IndiaMART Metric Reference for KAM Retention Calls

## BL Filter Section

**What BL Consumption measures:** percentage of Business Leads the seller has viewed and responded to.

**Why it drops:**
1. Seller is receiving leads from wrong buyer segment (retail buyers for B2B sellers, or vice versa)
2. Seller disengaged — not logging in to check leads
3. Genuine dissatisfaction with lead quality

**How to distinguish the causes:**
- If `retailBlRecommendedPct` > 35 → lead quality issue (BL filter misconfigured), not seller behaviour
- If `loginPct` is also low → disengagement, not filter issue
- If `loginPct` is fine but BL consumption is low → seller is logging in but rejecting leads → quality complaint

**BL Filter escalation procedure:**
1. Confirm the exact retail BL% from the dashboard before the call
2. On call: acknowledge the specific number ("aapke 38% leads retail segment ke aa rahe hain, jo B2B seller ke liye galat hai")
3. Raise a product ticket during or immediately after the call — give seller the ticket number
4. Realistic fix timeline: **2 weeks** for filter adjustment, 4 weeks for category-level systemic fixes
5. KAM can commit to: weekly status updates, manually forwarding 5–10 quality leads while fix is pending
6. KAM cannot commit to: specific lead count guarantees, refunds, accelerated timelines beyond 2 weeks

**Red flag:** If another seller in the same category has raised the same issue, it is likely systemic. Mention this to the seller — "aapke category mein doosre sellers bhi yeh issue report kar rahe hain, weight zyada hoga complaint mein" — it reframes the issue as platform accountability, not seller-specific neglect.

---

## Competitor Section

**Known competitors and counter-positioning:**

**TradeIndia**
- Switching cost argument: established listing history, buyer familiarity, SEO domain authority built over time on IndiaMART
- TradeIndia's buyer base is smaller for most B2B verticals
- Counter: "TradeIndia pe zero se shuru karna padega — aapki IndiaMART profile pe 3 saal ki buyer engagement hai"

**Bizongo**
- Bizongo offers a "dedicated buyer manager" pitch — this is their primary sales hook
- Counter: IndiaMART's scale (100M+ buyers) vs. Bizongo's curated but smaller network. For high-volume categories, breadth wins
- KAM can offer: quarterly account review, catalog expert session — positions IndiaMART as equally attentive
- Do NOT dismiss Bizongo's pitch — acknowledge it, then redirect to IndiaMART's buyer volume advantage

**JK Traders (competitor seller on IndiaMART)**
- This is a same-platform competitor, not a rival platform
- When a seller cites JK Traders getting better results: do not confirm or deny their metrics
- Redirect: "Upgrade aur lead count ka direct correlation hota hai. Aapka current package mein kya limitations hain, woh dekhte hain"

**General competitor mention handling:**
- Never badmouth a competitor — it reads as defensive
- Always acknowledge the competitor's stated advantage before countering
- The strongest counter is switching cost + established presence, not feature comparison

---

## Login Section

**What Login% measures:** percentage of days in the period the seller logged into the platform.

**Normal range:** 60–85% for active sellers. Below 40% = disengagement signal.

**Drop causes and responses:**

| Drop pattern | Likely cause | Response |
|---|---|---|
| Gradual decline over 3 months | Slow disengagement, low perceived ROI | Value demonstration call — show actual leads received and their source |
| Sudden drop in one month | External event (offline orders spike, personal event, system issue) | Ask first — do not assume churn intent |
| Low but stable | Seller uses platform passively (checks occasionally) | Not urgent unless renewal < 60 days |

**What to say when login is low:**
- Ask before explaining: "Kya koi specific reason hai login kam hua? Kabhi kabhi offline orders zyada aa jaate hain"
- If seller confirms distraction (not dissatisfaction): offer PNS notification setup to reduce effort of checking manually
- If seller confirms dissatisfaction: pivot to BL Filter or value demonstration script

---

## Renewal Section

**Negotiation leverage by ARR tier:**

| ARR | Days to Renewal | KAM authority |
|-----|-----------------|---------------|
| < ₹100k | < 30 days | Standard renewal pitch, 5% loyalty discount |
| ₹100k–₹200k | < 45 days | 10% loyalty discount + 1 free catalog session |
| > ₹200k | < 60 days | Escalate to senior KAM; up to 15% + exec commitment |
| > ₹200k | < 30 days | Immediate senior KAM handoff — do not negotiate alone |

**Framing the renewal conversation:**
- Lead with ROI delivered, not renewal pressure: "Aapko pichhle saal X leads mile, jisme se Y se business hua — yeh return calculate karein"
- Introduce renewal only after value is established
- Never open with price or package — it makes the call transactional

**Prior churn sellers at renewal:**
- They have already left once — they know the exit process is painless
- Do NOT use urgency ("agle mahine expire ho raha hai") as the opening
- Lead with what changed since they re-joined: new features, lead quality improvements, exec commitments kept
