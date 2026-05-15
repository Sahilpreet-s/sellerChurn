"""
Seeds ~31 realistic KAM outcome records into the outcomes table.
These give the playbook synthesizer real material to work with on day one.

Each record has: archetype, disposition, churn reasons, exec commitment, and outcome.
Distributions are intentionally mixed — some archetypes are easier to retain than others.

Run AFTER the Go server has started at least once (so the outcomes table exists with archetype column).
"""
import sqlite3
import json
import os
import random
from datetime import datetime, timedelta

DB_PATH = os.environ.get("DB_PATH", "../backend/data/sellerpulse.db")
SEED = 99
random.seed(SEED)

SEED_OUTCOMES = [
    # ── Overwhelmed Starter (6 cases, ~67% retention) ────────────────────────
    {
        "seller_id": "PLAYBOOK_OS_001", "archetype": "Overwhelmed Starter",
        "outcome": "Resolved", "disposition": "Skeptical",
        "churn_reasons": ["LOW_ENGAGEMENT", "ROI_NOT_VISIBLE"],
        "exec_commitment": "Scheduled dedicated 1-hour onboarding session with product specialist; reviewed catalog setup together on call",
        "competitor_mentioned": "",
        "notes": "Seller had no idea how to use BL filters — hands-on session was the turning point",
    },
    {
        "seller_id": "PLAYBOOK_OS_002", "archetype": "Overwhelmed Starter",
        "outcome": "Resolved", "disposition": "Willing",
        "churn_reasons": ["LOW_ENGAGEMENT"],
        "exec_commitment": "Set up catalog with 15+ products together on call; sent 2-page quick-start guide via WhatsApp",
        "competitor_mentioned": "",
        "notes": "Seller was overwhelmed but receptive once shown platform basics",
    },
    {
        "seller_id": "PLAYBOOK_OS_003", "archetype": "Overwhelmed Starter",
        "outcome": "Churned", "disposition": "Skeptical",
        "churn_reasons": ["LOW_ENGAGEMENT", "ROI_NOT_VISIBLE"],
        "exec_commitment": "Sent documentation links via email",
        "competitor_mentioned": "",
        "notes": "No follow-through after sending docs — seller never engaged again",
    },
    {
        "seller_id": "PLAYBOOK_OS_004", "archetype": "Overwhelmed Starter",
        "outcome": "Resolved", "disposition": "Willing",
        "churn_reasons": ["LOW_ENGAGEMENT", "CATALOG_ISSUE"],
        "exec_commitment": "Fixed catalog images and added 3 missing product categories together; committed to weekly check-in for first month",
        "competitor_mentioned": "",
        "notes": "Catalog was nearly empty — immediate hands-on help built trust",
    },
    {
        "seller_id": "PLAYBOOK_OS_005", "archetype": "Overwhelmed Starter",
        "outcome": "Churned", "disposition": "Hostile",
        "churn_reasons": ["LOW_ENGAGEMENT", "SUPPORT_QUALITY"],
        "exec_commitment": "Promised support ticket would be resolved in 48 hours",
        "competitor_mentioned": "",
        "notes": "Third support ticket for same issue — seller had completely lost patience",
    },
    {
        "seller_id": "PLAYBOOK_OS_006", "archetype": "Overwhelmed Starter",
        "outcome": "Resolved", "disposition": "Skeptical",
        "churn_reasons": ["ROI_NOT_VISIBLE", "LOW_ENGAGEMENT"],
        "exec_commitment": "Assigned personal KAM for 90-day onboarding; set concrete milestone of 10 BL responses in first 30 days",
        "competitor_mentioned": "",
        "notes": "Setting a concrete measurable goal gave seller something to work toward",
    },

    # ── ROI Doubter (7 cases, ~57% retention) ────────────────────────────────
    {
        "seller_id": "PLAYBOOK_ROI_001", "archetype": "ROI Doubter",
        "outcome": "Resolved", "disposition": "Skeptical",
        "churn_reasons": ["LEAD_QUALITY", "ROI_NOT_VISIBLE"],
        "exec_commitment": "Upgraded BL filter to exclude retail buyers; showed last 90-day lead quality data on call; scheduled 30-day quality review",
        "competitor_mentioned": "",
        "notes": "Showing actual lead data on the call changed the conversation entirely",
    },
    {
        "seller_id": "PLAYBOOK_ROI_002", "archetype": "ROI Doubter",
        "outcome": "Churned", "disposition": "Hostile",
        "churn_reasons": ["LEAD_QUALITY", "PRICING"],
        "exec_commitment": "Offered 10% renewal discount",
        "competitor_mentioned": "TradeIndia",
        "notes": "Generic discount without addressing lead quality — seller felt the real problem was ignored",
    },
    {
        "seller_id": "PLAYBOOK_ROI_003", "archetype": "ROI Doubter",
        "outcome": "Resolved", "disposition": "Skeptical",
        "churn_reasons": ["ROI_NOT_VISIBLE", "LEAD_QUALITY"],
        "exec_commitment": "Calculated ROI on call: 3 BL orders × avg order value = 4.2× ARR return; shared calculation report via WhatsApp",
        "competitor_mentioned": "",
        "notes": "Concrete ROI math was far more persuasive than abstract promises",
    },
    {
        "seller_id": "PLAYBOOK_ROI_004", "archetype": "ROI Doubter",
        "outcome": "Churned", "disposition": "Hostile",
        "churn_reasons": ["LEAD_QUALITY", "ROI_NOT_VISIBLE", "PRICING"],
        "exec_commitment": "Promised leads would improve next quarter",
        "competitor_mentioned": "IndiaTrade",
        "notes": "Vague future promise with no mechanism — seller didn't believe it and had heard it before",
    },
    {
        "seller_id": "PLAYBOOK_ROI_005", "archetype": "ROI Doubter",
        "outcome": "Resolved", "disposition": "Willing",
        "churn_reasons": ["ROI_NOT_VISIBLE"],
        "exec_commitment": "Set up monthly performance report delivery; committed to 15% lead quality improvement target in 60 days with accountability",
        "competitor_mentioned": "",
        "notes": "Accountability mechanism with a measurable target built seller's confidence",
    },
    {
        "seller_id": "PLAYBOOK_ROI_006", "archetype": "ROI Doubter",
        "outcome": "Churned", "disposition": "Skeptical",
        "churn_reasons": ["LEAD_QUALITY", "PRICING"],
        "exec_commitment": "Extended contract by 1 month free",
        "competitor_mentioned": "",
        "notes": "Free month extension without fixing root cause just delayed the inevitable",
    },
    {
        "seller_id": "PLAYBOOK_ROI_007", "archetype": "ROI Doubter",
        "outcome": "Resolved", "disposition": "Skeptical",
        "churn_reasons": ["LEAD_QUALITY"],
        "exec_commitment": "Identified 3 highest-value buyer profiles in seller's category; updated BL criteria to match; committed to 3-week quality review",
        "competitor_mentioned": "",
        "notes": "Specificity of buyer profile matching was the key differentiator vs generic promises",
    },

    # ── Platform Victim (6 cases, ~50% retention) ─────────────────────────────
    {
        "seller_id": "PLAYBOOK_PV_001", "archetype": "Platform Victim",
        "outcome": "Resolved", "disposition": "Hostile",
        "churn_reasons": ["PLATFORM_ISSUE", "SUPPORT_QUALITY"],
        "exec_commitment": "Escalated BL notification bug to product team as P1 ticket; applied 2-month ARR credit for downtime; personal follow-up call in 5 days",
        "competitor_mentioned": "",
        "notes": "P1 escalation + credit + personal follow-up together restored trust",
    },
    {
        "seller_id": "PLAYBOOK_PV_002", "archetype": "Platform Victim",
        "outcome": "Churned", "disposition": "Hostile",
        "churn_reasons": ["PLATFORM_ISSUE"],
        "exec_commitment": "Assured the bug is being looked at by tech team",
        "competitor_mentioned": "TradeIndia",
        "notes": "Vague reassurance without a ticket number or resolution timeline — seller switched",
    },
    {
        "seller_id": "PLAYBOOK_PV_003", "archetype": "Platform Victim",
        "outcome": "Resolved", "disposition": "Skeptical",
        "churn_reasons": ["PLATFORM_ISSUE", "SUPPORT_QUALITY"],
        "exec_commitment": "Showed live bug ticket status on screen; committed to weekly status update until resolved; applied 30-day credit",
        "competitor_mentioned": "",
        "notes": "Transparency by showing the actual ticket in real-time was more effective than any promise",
    },
    {
        "seller_id": "PLAYBOOK_PV_004", "archetype": "Platform Victim",
        "outcome": "Churned", "disposition": "Hostile",
        "churn_reasons": ["PLATFORM_ISSUE", "SUPPORT_QUALITY", "ROI_NOT_VISIBLE"],
        "exec_commitment": "Offered new package at discounted rate",
        "competitor_mentioned": "IndiaTrade",
        "notes": "A discount doesn't fix a broken platform experience — seller felt dismissed",
    },
    {
        "seller_id": "PLAYBOOK_PV_005", "archetype": "Platform Victim",
        "outcome": "Resolved", "disposition": "Skeptical",
        "churn_reasons": ["PLATFORM_ISSUE"],
        "exec_commitment": "Set up dedicated WhatsApp channel with tech lead for direct issue reporting; guaranteed 48-hour resolution SLA",
        "competitor_mentioned": "",
        "notes": "Direct access to tech team was an unusual commitment that strongly signaled ownership",
    },
    {
        "seller_id": "PLAYBOOK_PV_006", "archetype": "Platform Victim",
        "outcome": "Churned", "disposition": "Hostile",
        "churn_reasons": ["PLATFORM_ISSUE", "SUPPORT_QUALITY"],
        "exec_commitment": "Logged a new support ticket on seller's behalf",
        "competitor_mentioned": "",
        "notes": "This was the third ticket for the exact same issue — seller had run out of patience entirely",
    },

    # ── Competitor Target (7 cases, ~43% retention) ───────────────────────────
    {
        "seller_id": "PLAYBOOK_CT_001", "archetype": "Competitor Target",
        "outcome": "Resolved", "disposition": "Skeptical",
        "churn_reasons": ["COMPETITOR_SWITCH", "LEAD_QUALITY"],
        "exec_commitment": "Upgraded to Gold package with enhanced BL filters; showed verified buyer base comparison vs TradeIndia on call; 60-day satisfaction guarantee",
        "competitor_mentioned": "TradeIndia",
        "notes": "Concrete data-backed comparison addressing the competitor's specific claimed advantage",
    },
    {
        "seller_id": "PLAYBOOK_CT_002", "archetype": "Competitor Target",
        "outcome": "Churned", "disposition": "Hostile",
        "churn_reasons": ["COMPETITOR_SWITCH", "PRICING"],
        "exec_commitment": "Matched competitor's quoted price",
        "competitor_mentioned": "IndiaTrade",
        "notes": "Pure price match without addressing quality perception — seller saw no differentiation beyond cost",
    },
    {
        "seller_id": "PLAYBOOK_CT_003", "archetype": "Competitor Target",
        "outcome": "Churned", "disposition": "Hostile",
        "churn_reasons": ["COMPETITOR_SWITCH"],
        "exec_commitment": "Sent comparison brochure via email after the call",
        "competitor_mentioned": "Alibaba B2B",
        "notes": "Email sent after a hostile call was too passive — seller had already made the decision",
    },
    {
        "seller_id": "PLAYBOOK_CT_004", "archetype": "Competitor Target",
        "outcome": "Resolved", "disposition": "Skeptical",
        "churn_reasons": ["COMPETITOR_SWITCH", "PRICING"],
        "exec_commitment": "Offered loyalty pricing (15% discount) + showed IndiaMART verified buyer base size vs competitor with actual numbers; committed to monthly performance report",
        "competitor_mentioned": "TradeIndia",
        "notes": "Loyalty framing combined with quantified data comparison was decisive",
    },
    {
        "seller_id": "PLAYBOOK_CT_005", "archetype": "Competitor Target",
        "outcome": "Churned", "disposition": "Hostile",
        "churn_reasons": ["COMPETITOR_SWITCH", "LEAD_QUALITY", "PRICING"],
        "exec_commitment": "Promised quality improvement by next quarter",
        "competitor_mentioned": "IndiaTrade",
        "notes": "Seller had already paid IndiaTrade's onboarding fee — commitment came too late",
    },
    {
        "seller_id": "PLAYBOOK_CT_006", "archetype": "Competitor Target",
        "outcome": "Resolved", "disposition": "Willing",
        "churn_reasons": ["COMPETITOR_SWITCH"],
        "exec_commitment": "Pulled up 5 recent verified B2B buyer leads in seller's exact category on the live call; upgraded BL filters immediately; set 45-day review",
        "competitor_mentioned": "TradeIndia",
        "notes": "Showing live relevant leads in real-time on the call was the single biggest turning point",
    },
    {
        "seller_id": "PLAYBOOK_CT_007", "archetype": "Competitor Target",
        "outcome": "Churned", "disposition": "Hostile",
        "churn_reasons": ["COMPETITOR_SWITCH", "PRICING"],
        "exec_commitment": "Escalated to senior KAM for a callback within 24 hours",
        "competitor_mentioned": "IndiaTrade",
        "notes": "Escalation delay meant seller signed with competitor before the senior callback happened",
    },

    # ── Seasonal Dip (5 cases, ~80% retention) ────────────────────────────────
    {
        "seller_id": "PLAYBOOK_SD_001", "archetype": "Seasonal Dip",
        "outcome": "Resolved", "disposition": "Willing",
        "churn_reasons": ["ROI_NOT_VISIBLE", "LEAD_QUALITY"],
        "exec_commitment": "Showed historical seasonality chart: same category dips 40% Apr-May, recovers Jul-Aug; deferred renewal 45 days to align with peak season start",
        "competitor_mentioned": "",
        "notes": "Historical data proving this is normal seasonal behavior completely reframed the seller's concern",
    },
    {
        "seller_id": "PLAYBOOK_SD_002", "archetype": "Seasonal Dip",
        "outcome": "Resolved", "disposition": "Skeptical",
        "churn_reasons": ["ROI_NOT_VISIBLE"],
        "exec_commitment": "Explained seasonal pattern with category-level trend data; removed renewal pressure; set a reminder for August when leads historically peak",
        "competitor_mentioned": "",
        "notes": "Removing renewal pressure during off-season was the key — seller relaxed and recommitted",
    },
    {
        "seller_id": "PLAYBOOK_SD_003", "archetype": "Seasonal Dip",
        "outcome": "Churned", "disposition": "Skeptical",
        "churn_reasons": ["ROI_NOT_VISIBLE", "LEAD_QUALITY"],
        "exec_commitment": "Pushed for immediate renewal at standard rate",
        "competitor_mentioned": "",
        "notes": "Forcing renewal at full price during off-peak season created resentment — seller churned",
    },
    {
        "seller_id": "PLAYBOOK_SD_004", "archetype": "Seasonal Dip",
        "outcome": "Resolved", "disposition": "Willing",
        "churn_reasons": ["LEAD_QUALITY"],
        "exec_commitment": "Shared 6-month lead volume chart showing seasonal dip and recovery curve; offered 2-month contract pause with automatic re-activation in July",
        "competitor_mentioned": "",
        "notes": "Contract pause option made seller feel IndiaMART was being fair and flexible",
    },
    {
        "seller_id": "PLAYBOOK_SD_005", "archetype": "Seasonal Dip",
        "outcome": "Resolved", "disposition": "Willing",
        "churn_reasons": ["ROI_NOT_VISIBLE"],
        "exec_commitment": "Benchmarked seller's off-season performance against category peers; confirmed they're above average; shifted focus to catalog optimization during the slow period",
        "competitor_mentioned": "",
        "notes": "Benchmarking against peers gave reassuring context — seller felt good about their relative position",
    },
]


def seed(db_path: str = DB_PATH):
    conn = sqlite3.connect(db_path)

    # Ensure archetype column exists (Go server adds it, but be defensive)
    try:
        conn.execute("ALTER TABLE outcomes ADD COLUMN archetype TEXT")
    except Exception:
        pass  # column already exists

    count = conn.execute(
        "SELECT COUNT(*) FROM outcomes WHERE seller_id LIKE 'PLAYBOOK_%'"
    ).fetchone()[0]
    if count >= 10:
        print(f"Already have {count} playbook seed rows — skipping.")
        conn.close()
        return

    # Spread dates over the last 6 months to look like real history
    base_date = datetime(2025, 11, 1)
    rows = list(SEED_OUTCOMES)
    random.shuffle(rows)

    for i, rec in enumerate(rows):
        logged = base_date + timedelta(days=int(i * 5.5))  # ~170 days spread
        reasons_json = json.dumps(rec["churn_reasons"])
        conn.execute(
            """INSERT INTO outcomes
               (seller_id, outcome, notes, disposition, churn_reasons,
                competitor_mentioned, exec_commitment, risk_score, archetype,
                feature_snapshot, logged_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                rec["seller_id"],
                rec["outcome"],
                rec["notes"],
                rec["disposition"],
                reasons_json,
                rec["competitor_mentioned"],
                rec["exec_commitment"],
                0,                      # risk_score (synthetic)
                rec["archetype"],
                "{}",                   # feature_snapshot (not needed for playbook)
                logged.isoformat(),
            ),
        )

    conn.commit()
    conn.close()
    print(f"Seeded {len(rows)} playbook outcome records into {db_path}")
    print("Archetypes covered:")
    archetypes = {}
    for r in SEED_OUTCOMES:
        archetypes[r["archetype"]] = archetypes.get(r["archetype"], 0) + 1
    for arch, n in sorted(archetypes.items()):
        resolved = sum(1 for r in SEED_OUTCOMES if r["archetype"] == arch and r["outcome"] == "Resolved")
        print(f"  {arch}: {n} cases, {resolved}/{n} retained ({100*resolved//n}%)")


if __name__ == "__main__":
    seed(DB_PATH)
