# IndiaMART Seller Archetype Profiles

These archetypes are computed nightly by the SellerPulse classifier. Each represents a distinct churn pattern with a different retention approach.

---

## Disengaged-Low-ROI
**Profile:** Seller has stopped logging in and believes the platform isn't delivering value. No specific complaint — general apathy.
**Key signal:** loginPct drop > 25, low BL consumption, neutral/negative sentiment across calls, no competitor mentioned
**Churn timeline:** Slow — typically decides at renewal, not before
**Retention approach:**
- Open with a concrete ROI statement before asking any questions: "Aapko pichhle 90 din mein X verified buyer inquiries mili hain"
- Do not ask "kya problem hai" immediately — it confirms their belief that the platform isn't working
- Offer one tangible quick win: PNS notification setup, catalog improvement session
- Do not promise lead count — promise engagement support

**Common mistake:** Giving a feature tour. This archetype already knows the features. They need evidence of results, not a product demo.

---

## BL-Quality-Complaint
**Profile:** Seller is actively engaged but frustrated by lead quality — specifically receiving retail or irrelevant leads.
**Key signal:** High login%, low BL consumption, retailBlRecommendedPct > 30, negative sentiment, specific complaint about lead types
**Churn timeline:** Faster — they are engaged enough to feel the problem acutely
**Retention approach:**
- Validate the complaint with the exact number immediately: "Haan, aapke 41% leads retail segment ke aa rahe hain — yeh genuine problem hai"
- Escalate the ticket on the call (not after) — give them a ticket number before hanging up
- Commit to manual lead forwarding while fix is pending (5 quality leads per week is a realistic commitment)
- Follow up within 5 business days regardless of fix status

**Common mistake:** Promising the filter will be fixed in a week. Product team timeline is 2 weeks minimum. Over-promising accelerates churn when the deadline passes.

---

## Competitor-Evaluating
**Profile:** Seller is actively evaluating a competing platform. May have already had a demo with the competitor.
**Key signal:** Competitor mentioned in transcript or call insight, Skeptical/Hostile disposition, daysToRenewal < 90
**Churn timeline:** Urgent — decision is imminent
**Retention approach:**
- Do not lead with features or discounts — competitors can match both
- Lead with switching cost: "Jo aapne 3 saal mein IndiaMART pe build kiya hai — buyer relationships, listing history, reviews — woh naye platform pe zero se shuru hoga"
- Acknowledge the competitor's stated advantage honestly before countering
- If senior KAM authority is available: offer exec-level commitment for one specific pain point
- A concrete commitment + switching cost argument is stronger than a loyalty discount

**Common mistake:** Immediately offering a discount. It signals desperation and invites the seller to negotiate on price with the competitor too.

---

## Operationally-Overwhelmed
**Profile:** Seller has good metrics historically but PNS pickup rate has crashed. Usually because of offline order surge, staffing issues, or seasonal factors — not platform dissatisfaction.
**Key signal:** PNS pickup rate drop > 30 points in one month, login% still reasonable, positive/neutral sentiment, no strong complaints
**Churn timeline:** Low — not a churn risk if handled correctly
**Retention approach:**
- Ask before diagnosing: "PNS pickup rate kam hui hai — offline se orders badh gaye kya?"
- If confirmed external factor: offer PNS notification configuration, not a retention pitch
- Do not use churn-prevention language — it misframes the relationship
- This is an upsell opportunity: if offline orders are up, the seller is growing. Introduce upgrade conversation

**Common mistake:** Treating PNS drop as a churn signal and launching into retention mode. This archetype finds that condescending and it can actually create friction where none existed.

---

## Healthy-Upsell-Candidate
**Profile:** Seller has strong engagement metrics, has been getting value, and may be ready for a package upgrade.
**Key signal:** loginPct > 70, BL consumption > 60, positive sentiment, seller may have asked about features or upgrade
**Churn timeline:** None — not a churn risk
**Retention approach:**
- Do not run a standard retention call — it wastes everyone's time and signals poor data hygiene to the seller
- Frame the call as a growth conversation: "Aapka account kaafi healthy dikh raha hai. Humne notice kiya ki aap consistently leads le rahe hain — Star package ke saath kuch additional benefits milenge"
- Introduce one specific upgrade benefit relevant to their category
- Offer a proposal (not a decision) — send comparison document the same day

**Common mistake:** Running a churn-prevention script on a healthy seller. It damages trust and sometimes creates doubt where there was none.
