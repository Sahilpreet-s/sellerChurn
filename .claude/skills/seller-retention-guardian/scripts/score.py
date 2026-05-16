"""
Standalone seller risk scorer — mirrors backend/internal/scorer/scorer.go and
backend/internal/classifier/cause.go exactly. No API call needed.

Usage:
    python score.py seller.json
    echo '{"id":"S-001","metrics":{...}}' | python score.py

Input JSON shape (fields not present default to 0/empty):
{
  "id": "S-20001",
  "name": "Rajesh Kumar",
  "category": "Steel Pipes",
  "packageType": "Gold",
  "arr": 120000,
  "daysToRenewal": 45,
  "priorChurn": false,
  "metrics": {
    "loginPct":               [{"month":"Nov","value":82},{"month":"Dec","value":71},{"month":"Jan","value":58}],
    "blConsumptionPct":       [...],
    "pnsPickupRatePct":       [...],
    "lmsReplyRatePct":        [...],
    "retailBlRecommendedPct": [...],
    "catalogScore":           [...],
    "cqs":                    [...]
  },
  "callInsights": [
    {
      "competitorMentioned": "TradeIndia",
      "disposition": "Skeptical",
      "issues": ["Low BL", "Pricing"],
      "commitmentByExec": ""
    }
  ]
}
"""
import json
import sys
import math


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _latest(history: list) -> float:
    if not history:
        return 0.0
    return history[-1]["value"]


def _drop(history: list) -> float:
    if len(history) < 2:
        return 0.0
    return max(0.0, history[0]["value"] - history[-1]["value"])


# ─── Tier 1: Inactive detection (mirrors IsInactiveSeller) ────────────────────

def is_inactive(seller: dict) -> bool:
    m = seller.get("metrics", {})
    return (
        _latest(m.get("loginPct", [])) <= 5 and
        _latest(m.get("blConsumptionPct", [])) <= 5 and
        _latest(m.get("pnsPickupRatePct", [])) <= 5
    )


# ─── Tier 2: Rule-based risk score (mirrors CalcRisk) ─────────────────────────

def calc_risk(seller: dict) -> int:
    m = seller.get("metrics", {})

    login_risk   = (100 - _latest(m.get("loginPct", [])))               * 0.15 + _drop(m.get("loginPct", []))               * 0.35
    bl_risk      = (100 - _latest(m.get("blConsumptionPct", [])))       * 0.15 + _drop(m.get("blConsumptionPct", []))       * 0.35
    pns_risk     = (100 - _latest(m.get("pnsPickupRatePct", [])))       * 0.12 + _drop(m.get("pnsPickupRatePct", []))       * 0.30
    lms_risk     = (100 - _latest(m.get("lmsReplyRatePct", [])))        * 0.12 + _drop(m.get("lmsReplyRatePct", []))        * 0.30
    retail_risk  = _latest(m.get("retailBlRecommendedPct", []))         * 0.12
    catalog_risk = (100 - _latest(m.get("catalogScore", [])))           * 0.06
    cqs_risk     = (100 - _latest(m.get("cqs", [])))                   * 0.08

    score = min(92.0, round(login_risk + bl_risk + pns_risk + lms_risk + retail_risk + catalog_risk + cqs_risk))

    if seller.get("priorChurn"):
        score = min(92.0, round(score * 1.30))

    # Seasonality dampener for scaffold/construction (Mar=3, Apr=4, May=5)
    login_hist = m.get("loginPct", [])
    if login_hist:
        last_month = login_hist[-1].get("month", "")
        is_construction = any(kw in seller.get("category", "") for kw in ("Scaffold", "Construction"))
        is_season = last_month in ("Mar", "Apr", "May")
        if is_construction and is_season:
            score = min(92.0, round(score * 0.85))

    return int(score)


def risk_band(score: int) -> str:
    if score >= 55:
        return "High"
    if score >= 30:
        return "Medium"
    return "Low"


# ─── Archetype classification (mirrors Archetype in classifier/cause.go) ──────

def classify_archetype(seller: dict) -> str:
    m = seller.get("metrics", {})
    insights = seller.get("callInsights", []) or []

    with_competitor = any(c.get("competitorMentioned") for c in insights)
    platform_issues = {"BL filters not working", "Catalog edits rejected", "PNS routing", "Drop in enquiries", "Lead quality dropped"}
    with_platform = any(
        issue in platform_issues
        for c in insights
        for issue in (c.get("issues") or [])
    )
    high_retail = _latest(m.get("retailBlRecommendedPct", [])) > 52
    is_construction = any(kw in seller.get("category", "") for kw in ("Scaffold", "Construction"))

    if _latest(m.get("loginPct", [])) > 78 and _latest(m.get("blConsumptionPct", [])) > 60:
        return "Healthy"
    if seller.get("priorChurn") and _latest(m.get("catalogScore", [])) < 50:
        return "Overwhelmed Starter"
    if with_competitor:
        return "Competitor Target"
    if with_platform or high_retail:
        return "Platform Victim"
    if is_construction:
        return "Seasonal Dip"
    return "ROI Doubter"


# ─── Churn cause (mirrors ChurnCause in classifier/cause.go) ──────────────────

def classify_cause(seller: dict) -> tuple[str, str]:
    m = seller.get("metrics", {})
    insights = seller.get("callInsights", []) or []

    with_competitor = any(c.get("competitorMentioned") for c in insights)
    comp_name = next((c["competitorMentioned"] for c in insights if c.get("competitorMentioned")), "")

    platform_issues = {"BL filters not working", "Catalog edits rejected", "PNS routing", "Drop in enquiries", "Lead quality dropped"}
    with_platform = any(issue in platform_issues for c in insights for issue in (c.get("issues") or []))
    high_retail = _latest(m.get("retailBlRecommendedPct", [])) > 52

    login_drop = _drop(m.get("loginPct", []))
    bl_drop    = _drop(m.get("blConsumptionPct", []))
    pns_drop   = _drop(m.get("pnsPickupRatePct", []))
    all_decline = login_drop > 10 and bl_drop > 10 and pns_drop > 8

    if with_competitor and not with_platform and not high_retail:
        cause = "External"
        reason = f'Competitor "{comp_name}" mentioned — pricing or feature comparison driving exit risk' if comp_name else "Competitor pricing offer mentioned — external pressure driving exit risk"
    elif all_decline and not with_competitor and not with_platform and not high_retail:
        cause = "Seller Disengaged"
        reason = (
            f"Login −{login_drop:.0f}%, BL −{bl_drop:.0f}%, PNS −{pns_drop:.0f}% "
            "over 3 months — disengagement pattern, no platform trigger"
        )
    elif (with_platform or high_retail) and not with_competitor and not all_decline:
        cause = "Mixed"
        if high_retail:
            retail = _latest(m.get("retailBlRecommendedPct", []))
            reason = f"{retail:.0f}% of recommended BLs are retail — lead-fit mismatch, likely platform config issue; requires Sales Manager coordination"
        else:
            reason = "Seller reported platform issues on calls — escalate to Product; Sales Manager to coordinate"
    else:
        cause = "Mixed"
        reason = "Combination of behavioural and external signals — requires Sales Manager and Exec coordination"

    return cause, reason


# ─── Main ─────────────────────────────────────────────────────────────────────

def score_seller(seller: dict) -> dict:
    if is_inactive(seller):
        return {
            "sellerId":    seller.get("id", "unknown"),
            "riskScore":   95,
            "riskBand":    "High",
            "tier":        1,
            "archetype":   "Seller Inactive",
            "churnCause":  "Seller Disengaged",
            "causeReason": "Seller completely inactive — login, BL consumption, and PNS pickup all at or near zero.",
        }

    score    = calc_risk(seller)
    band     = risk_band(score)
    archetype = classify_archetype(seller)
    cause, reason = classify_cause(seller)

    return {
        "sellerId":    seller.get("id", "unknown"),
        "riskScore":   score,
        "riskBand":    band,
        "tier":        2,
        "archetype":   archetype,
        "churnCause":  cause,
        "causeReason": reason,
    }


if __name__ == "__main__":
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            seller = json.load(f)
    else:
        seller = json.load(sys.stdin)

    result = score_seller(seller)
    print(json.dumps(result, indent=2))
