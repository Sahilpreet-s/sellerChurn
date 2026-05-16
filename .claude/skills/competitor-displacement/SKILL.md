---
name: competitor-displacement
description: >
  Build a competitor counter-positioning strategy for a KAM when a seller has
  mentioned evaluating or switching to a competing platform. Use this skill when
  call insights or transcripts mention TradeIndia, Bizongo, JK Traders, or any
  other competitor by name, or when the seller's disposition is Skeptical or
  Hostile and a competitor is suspected. Do not use for general retention calls
  where no competitor has been mentioned.
user-invocable: false
---

## Core Principle
The strongest retention argument is **switching cost + established presence**, not feature comparison or price matching. Competitors can always match a feature or a discount. They cannot instantly replicate 3 years of buyer relationships, listing history, and search ranking built on IndiaMART.

Never badmouth a competitor. Acknowledge their stated advantage before countering -- this reads as confident, not defensive.

## Competitor-Specific Playbooks

### TradeIndia
**Their pitch to sellers:** Lower price, simpler interface, sometimes a relationship-driven local sales team.
**Their weakness:** Buyer base is significantly smaller than IndiaMART in most B2B verticals. Category coverage is thinner.

**Counter script:**
> "TradeIndia ka pricing sunke lagta hai reasonable hai. Lekin ek cheez compare karte hain -- IndiaMART pe aapki listing {N} years se hai, buyers ne aapko search mein dekha hai, reviews hain. TradeIndia pe zero se shuru hoga. Woh trust build karne mein 12-18 months lagte hain. Is time ka cost kya hoga?"

**Supporting data to pull:** Seller's total leads received in last 12 months from `GET /api/v1/sellers/{id}`. If >50 leads, cite the number: "Aapko pichhle saal {X} verified buyer inquiries mili hain -- yeh network TradeIndia pe nahi milega day 1 mein."

---

### Bizongo
**Their pitch to sellers:** Dedicated buyer manager, curated buyer matching, premium-feel experience.
**Their weakness:** Much smaller buyer network. Works well for very specific high-value categories, weaker for general B2B.

**Counter script:**
> "Bizongo ka dedicated buyer manager concept attractive hai -- main samajh sakta hoon. Lekin unka buyer network IndiaMART se kaafi chhota hai. {Seller's category} mein buyers IndiaMART pe zyada hain. Volume ka advantage usse outweigh karta hai."

**KAM offer to match their pitch:**
> "Main aapke liye quarterly account review set karta hoon -- dedicated attention milegi aapko bhi. Aur catalog expert session is hafte arrange karta hoon."

This is the one competitor where offering a service-level upgrade (not a price discount) is the right move -- it matches what Bizongo is selling.

---

### JK Traders (same-platform competitor)
**Situation:** Seller is comparing themselves to another IndiaMART seller who appears to be getting better results.
**Critical nuance:** This is NOT a platform-switching scenario. The seller wants proof that IndiaMART can work better for them -- they are not leaving.

**Counter script:**
> "JK Traders ke results ke baare mein main specific data share nahi kar sakta. Lekin generally, lead volume aur package level ka direct correlation hai. Aapke current package mein kya limitations hain, woh dekh sakte hain -- aur upgrade se kya benefit milega, woh compare karte hain."

Do NOT confirm or deny JK Traders' metrics. Redirect to the seller's own growth path.

---

### Unknown Competitor
If the seller mentions a competitor not listed above:
1. Ask what specifically attracted them: "Unki kaunsi cheez ne interest kiya?" -- this surfaces the real objection
2. Listen carefully -- competitor mention is often a proxy for an underlying platform problem (BL filter, support response time, etc.)
3. Address the underlying problem first, then use the general switching cost script below
4. If they describe a specific feature gap, note it in `execCommitment` when logging the outcome

## General Switching Cost Script
Use when the specific competitor is unknown or when the seller is still in early evaluation:

> "Koi bhi naya platform try karna samajh mein aata hai. Lekin ek calculation karte hain -- aapke IndiaMART pe {N} years ka data hai: buyer queries, listing ranking, reviews, response history. Naye platform pe yeh sab zero se build karna padega. Typically 12-18 months lagte hain similar traction aane mein. Is period mein business cost kya hogi?"

## Disposition-Based Adjustment

**Skeptical seller:** Use data first, then the switching cost argument. Skeptical sellers respond to evidence.

**Hostile seller:** Do NOT immediately counter. First, fully acknowledge: "Aapka frustration bilkul valid hai." Understand the root cause. The competitor mention is often a symptom -- a BL filter issue or broken commitment is usually the real cause. Fix the root cause first; the competitor concern often dissolves.

## What NOT to Do
- Do not offer a price discount as the first response to a competitor mention -- it signals the product isn't worth full price
- Do not say anything negative about the competitor directly -- it reads as defensive
- Do not promise feature parity with the competitor unless you know it exists
- Do not ask "when are you planning to switch?" -- it makes the decision feel more concrete than it may be
