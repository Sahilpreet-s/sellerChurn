"""
Seeds pre-written playbook entries for all 5 archetypes directly into the DB.
For a hackathon demo — the synthesis pipeline is proven; this seeds realistic data
so the demo works end-to-end without waiting on Gemini quota.
"""
import sqlite3
import json
import os
from datetime import datetime

DB_PATH = os.environ.get("DB_PATH", "../backend/data/sellerpulse.db")

PLAYBOOK_ENTRIES = [
    {
        "archetype": "Competitor Target",
        "sample_size": 7,
        "retention_rate": 0.43,
        "winning_approaches": [
            "Pull up 5 recent verified B2B buyer leads in the seller's exact category on the live call — seeing real leads in real-time is the single biggest turning point.",
            "Show a data-backed comparison of IndiaMART's verified buyer base vs the competitor's (size, B2B ratio, category depth) — numbers beat claims.",
            "Offer loyalty pricing (15% discount) framed as recognising their tenure, combined with an immediate BL filter upgrade — both action and recognition together.",
        ],
        "failed_approaches": [
            "Pure price-matching without addressing the lead quality perception — seller sees no differentiation beyond cost.",
            "Sending a comparison brochure via email after a hostile call — too passive, seller has usually already decided by then.",
            "Escalating to a senior KAM for a callback — if the delay is more than a few hours, the seller signs with the competitor first.",
        ],
        "key_insight": "Competitor Targets need to SEE IndiaMART's value advantage in real-time on the call, not hear promises about it — live lead demonstration beats every verbal argument.",
        "do_not_do": [
            "Do not open with pricing; lead quality is almost always the real concern even when price is mentioned.",
            "Do not let the call end without scheduling a concrete follow-up within 48 hours — momentum loss is fatal with this archetype.",
            "Do not be defensive about the competitor — acknowledge their strengths and pivot to IndiaMART's differentiation calmly.",
        ],
    },
    {
        "archetype": "Overwhelmed Starter",
        "sample_size": 6,
        "retention_rate": 0.67,
        "winning_approaches": [
            "Do hands-on catalog setup together on the call — fix actual problems in real-time rather than explaining how to fix them later.",
            "Set a single concrete, measurable milestone (e.g. '10 BL responses in 30 days') so the seller has a goal to work toward, not an abstract platform to figure out.",
            "Assign a personal KAM touchpoint for the first 90 days — the commitment of a named contact dramatically reduces abandonment.",
        ],
        "failed_approaches": [
            "Sending documentation links or how-to guides via email — overwhelmed sellers don't read docs, they need guided action.",
            "Generic support ticket promises without a specific resolution person or timeline — seller loses trust after the second unanswered ticket.",
        ],
        "key_insight": "Overwhelmed Starters are not disengaged — they are stuck. The KAM's job is to unblock them by doing things WITH them on the call, not explaining what they should do later.",
        "do_not_do": [
            "Do not assume the seller understands basic platform features — verify live and fix gaps immediately.",
            "Do not end the call without a scheduled follow-up within 7 days; momentum fades fast with this archetype.",
            "Do not offer a discount — they don't need cheaper, they need simpler.",
        ],
    },
    {
        "archetype": "Platform Victim",
        "sample_size": 6,
        "retention_rate": 0.50,
        "winning_approaches": [
            "Immediate P1 escalation with a ticket number shared on the call — vague 'we're looking into it' assurances have zero value with this archetype.",
            "Apply a credit or compensation for documented downtime without waiting to be asked — it signals ownership, not just apology.",
            "Set up a direct communication channel (WhatsApp group with tech lead) and a specific resolution SLA — direct access signals the company takes it seriously.",
        ],
        "failed_approaches": [
            "Logging a standard support ticket on the seller's behalf — for a seller who has already filed 2-3 tickets for the same issue, this is insulting.",
            "Offering a new package or discount — sellers experiencing platform failures interpret this as deflection.",
            "Verbal reassurance without any proof of action (no ticket number, no name, no date).",
        ],
        "key_insight": "Platform Victims have lost trust in the system, not just in the feature. Restoration requires concrete proof of action — ticket numbers, named owners, compensation, and a communication channel they control.",
        "do_not_do": [
            "Do not be defensive or explain why the bug occurred — the seller does not care about the cause, only the fix.",
            "Do not rely on standard support queues; treat this as a named escalation from the first call.",
            "Do not close the loop until the seller confirms the issue is resolved — do not assume.",
        ],
    },
    {
        "archetype": "ROI Doubter",
        "sample_size": 7,
        "retention_rate": 0.57,
        "winning_approaches": [
            "Calculate the actual ROI on the call using the seller's own numbers (BL orders × average order value) and share the calculation via WhatsApp before hanging up — concrete math beats abstract value propositions.",
            "Upgrade BL filter criteria to reduce retail buyer noise immediately on the call, then schedule a 30-day lead quality review with a specific metric target.",
            "Pull 90-day lead quality data and show it side-by-side with the seller's category benchmark — context turns a complaint into a solvable problem.",
        ],
        "failed_approaches": [
            "Generic discount offers without addressing the lead quality root cause — seller interprets this as IndiaMART knowing the product has problems.",
            "Vague promises that 'leads will improve next quarter' with no mechanism — this archetype has heard this before and stopped believing it.",
            "Free month extensions — they delay churn without changing the seller's perception of value.",
        ],
        "key_insight": "ROI Doubters are analytical — they respond to data and accountability, not reassurance. Show the math, fix a specific thing during the call, and commit to a measurable 30-day target.",
        "do_not_do": [
            "Do not open with pricing concessions — it validates their concern that the product is overpriced.",
            "Do not make commitments you cannot track — promise specific metrics with specific review dates.",
            "Do not end the call without sharing something concrete in writing (ROI calculation, lead report, or filter change confirmation).",
        ],
    },
    {
        "archetype": "Seasonal Dip",
        "sample_size": 5,
        "retention_rate": 0.80,
        "winning_approaches": [
            "Show the historical seasonality chart for their category — proving the dip is normal and temporary completely reframes the conversation from 'should I leave' to 'when does it pick up'.",
            "Remove renewal pressure during the off-season entirely — offer to reconnect in the peak month and remove the immediate decision deadline.",
            "Offer a contract pause or renewal deferral aligned with their peak season start — shows IndiaMART is being fair, not just extracting renewal.",
        ],
        "failed_approaches": [
            "Pushing for immediate renewal at the standard rate during a documented off-peak period — creates resentment and feels opportunistic.",
            "Treating the seasonal dip as a churn signal and applying heavy intervention — over-intervention with a Seasonal Dip seller can itself create churn.",
        ],
        "key_insight": "Seasonal Dip sellers are not dissatisfied — they are anxious. The most effective move is removing decision pressure and providing external context (category benchmarks, seasonal data) that reframes their dip as normal.",
        "do_not_do": [
            "Do not apply urgency or scarcity tactics — this archetype responds negatively to pressure during their low season.",
            "Do not offer discounts as the first response — it signals you agree the product is underperforming when the real cause is seasonal.",
            "Do not schedule intensive follow-ups during the off-season — check in lightly and save the substantive conversation for peak season.",
        ],
    },
]


def seed(db_path: str = DB_PATH):
    conn = sqlite3.connect(db_path)

    count = conn.execute("SELECT COUNT(*) FROM playbook_entries").fetchone()[0]
    if count >= 5:
        print(f"Already have {count} playbook entries — skipping.")
        conn.close()
        return

    now = datetime.utcnow().isoformat() + "Z"
    inserted = 0
    for entry in PLAYBOOK_ENTRIES:
        full_entry = {
            "archetype":          entry["archetype"],
            "sampleSize":         entry["sample_size"],
            "retentionRate":      entry["retention_rate"],
            "winningApproaches":  entry["winning_approaches"],
            "failedApproaches":   entry["failed_approaches"],
            "keyInsight":         entry["key_insight"],
            "doNotDo":            entry["do_not_do"],
            "updatedAt":          now,
        }
        conn.execute(
            """INSERT OR REPLACE INTO playbook_entries
               (archetype, sample_size, retention_rate, synthesis, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (
                entry["archetype"],
                entry["sample_size"],
                entry["retention_rate"],
                json.dumps(full_entry),
                now,
            ),
        )
        inserted += 1
        print(f"  OK {entry['archetype']} ({entry['sample_size']} cases, {entry['retention_rate']:.0%} retention)")

    conn.commit()
    conn.close()
    print(f"\nSeeded {inserted} playbook entries into {db_path}")


if __name__ == "__main__":
    seed(DB_PATH)
