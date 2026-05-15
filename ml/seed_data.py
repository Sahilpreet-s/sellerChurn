"""
Generate 500 synthetic labeled training examples for XGBoost.
Each row is a feature snapshot with a churn label (1=churned, 0=renewed).

Distributions intentionally overlap — real churn prediction is imperfect.
Some sellers churn despite decent engagement (competitor/pricing driven).
Some sellers renew despite poor engagement (KAM intervention saved them).
Target AUC: ~0.74-0.80.
"""
import sqlite3
import random
import json
import os
from datetime import datetime, timedelta

DB_PATH = os.environ.get("DB_PATH", "../backend/data/sellerpulse.db")
SEED = 42
random.seed(SEED)

FEATURE_COLS = [
    "loginPct_last", "loginPct_drop",
    "blPct_last", "blPct_drop",
    "pnsPct_last", "pnsPct_drop",
    "lmsPct_last", "lmsPct_drop",
    "retailPct_last",
    "catalogScore", "cqs",
    "priorChurn", "daysToRenewal", "arr_norm",
    "hasCompetitor", "disposition", "churnReasonCount", "hasExecCommitment",
]


def rule_score(row: dict) -> float:
    login_risk   = (100 - row["loginPct_last"]) * 0.15 + max(0, row["loginPct_drop"]) * 0.35
    bl_risk      = (100 - row["blPct_last"])     * 0.15 + max(0, row["blPct_drop"])    * 0.35
    pns_risk     = (100 - row["pnsPct_last"])    * 0.12 + max(0, row["pnsPct_drop"])   * 0.30
    lms_risk     = (100 - row["lmsPct_last"])    * 0.12 + max(0, row["lmsPct_drop"])   * 0.30
    retail_risk  = row["retailPct_last"]          * 0.12
    catalog_risk = (100 - row["catalogScore"])    * 0.06
    cqs_risk     = (100 - row["cqs"])             * 0.08
    score = min(100, login_risk + bl_risk + pns_risk + lms_risk + retail_risk + catalog_risk + cqs_risk)
    if row["priorChurn"] > 0.5:
        score = min(100, score * 1.30)
    return score


def rr(lo, hi):
    return lo + random.random() * (hi - lo)


def generate_churned() -> dict:
    """Typical churned seller — declining engagement, high retail BL."""
    return {
        "loginPct_last":    round(rr(15, 72), 1),
        "loginPct_drop":    round(rr(8, 45), 1),
        "blPct_last":       round(rr(10, 62), 1),
        "blPct_drop":       round(rr(8, 42), 1),
        "pnsPct_last":      round(rr(12, 68), 1),
        "pnsPct_drop":      round(rr(5, 38), 1),
        "lmsPct_last":      round(rr(10, 65), 1),
        "lmsPct_drop":      round(rr(5, 36), 1),
        "retailPct_last":   round(rr(32, 88), 1),
        "catalogScore":     round(rr(20, 68), 1),
        "cqs":              round(rr(18, 65), 1),
        "priorChurn":       1.0 if random.random() < 0.48 else 0.0,
        "daysToRenewal":    round(rr(14, 90), 0),
        "arr_norm":         round(rr(0.04, 0.65), 3),
        "hasCompetitor":    1.0 if random.random() < 0.55 else 0.0,
        "disposition":      random.choice([0.5, 0.5, 1.0]),  # mostly skeptical/hostile
        "churnReasonCount": round(rr(2, 9), 0) / 9.0,
        "hasExecCommitment":0.0,
    }


def generate_renewed() -> dict:
    """Typical renewed seller — stable or recovering engagement."""
    return {
        "loginPct_last":    round(rr(42, 98), 1),
        "loginPct_drop":    round(rr(0, 18), 1),
        "blPct_last":       round(rr(38, 96), 1),
        "blPct_drop":       round(rr(0, 15), 1),
        "pnsPct_last":      round(rr(40, 98), 1),
        "pnsPct_drop":      round(rr(0, 15), 1),
        "lmsPct_last":      round(rr(38, 96), 1),
        "lmsPct_drop":      round(rr(0, 14), 1),
        "retailPct_last":   round(rr(8, 52), 1),
        "catalogScore":     round(rr(50, 96), 1),
        "cqs":              round(rr(48, 94), 1),
        "priorChurn":       1.0 if random.random() < 0.08 else 0.0,
        "daysToRenewal":    round(rr(20, 180), 0),
        "arr_norm":         round(rr(0.08, 1.0), 3),
        "hasCompetitor":    1.0 if random.random() < 0.15 else 0.0,
        "disposition":      random.choice([0.0, 0.0, 0.5]),  # mostly willing
        "churnReasonCount": round(rr(0, 3), 0) / 9.0,
        "hasExecCommitment":1.0 if random.random() < 0.40 else 0.0,
    }


def generate_external_churn() -> dict:
    """Seller with decent metrics who still churned — competitor/pricing driven."""
    return {
        "loginPct_last":    round(rr(55, 85), 1),
        "loginPct_drop":    round(rr(0, 14), 1),
        "blPct_last":       round(rr(48, 80), 1),
        "blPct_drop":       round(rr(0, 12), 1),
        "pnsPct_last":      round(rr(50, 82), 1),
        "pnsPct_drop":      round(rr(0, 12), 1),
        "lmsPct_last":      round(rr(48, 78), 1),
        "lmsPct_drop":      round(rr(0, 10), 1),
        "retailPct_last":   round(rr(42, 72), 1),
        "catalogScore":     round(rr(55, 80), 1),
        "cqs":              round(rr(52, 78), 1),
        "priorChurn":       0.0,
        "daysToRenewal":    round(rr(14, 60), 0),
        "arr_norm":         round(rr(0.15, 0.8), 3),
        "hasCompetitor":    1.0,  # always competitor-driven
        "disposition":      random.choice([0.5, 1.0]),
        "churnReasonCount": round(rr(3, 7), 0) / 9.0,
        "hasExecCommitment":0.0,
    }


def generate_kam_saved() -> dict:
    """Seller with poor metrics who renewed — KAM intervention worked."""
    return {
        "loginPct_last":    round(rr(18, 45), 1),
        "loginPct_drop":    round(rr(10, 30), 1),
        "blPct_last":       round(rr(12, 42), 1),
        "blPct_drop":       round(rr(8, 28), 1),
        "pnsPct_last":      round(rr(14, 48), 1),
        "pnsPct_drop":      round(rr(6, 25), 1),
        "lmsPct_last":      round(rr(12, 45), 1),
        "lmsPct_drop":      round(rr(5, 24), 1),
        "retailPct_last":   round(rr(28, 65), 1),
        "catalogScore":     round(rr(25, 58), 1),
        "cqs":              round(rr(22, 55), 1),
        "priorChurn":       1.0 if random.random() < 0.30 else 0.0,
        "daysToRenewal":    round(rr(20, 75), 0),
        "arr_norm":         round(rr(0.06, 0.5), 3),
        "hasCompetitor":    1.0 if random.random() < 0.30 else 0.0,
        "disposition":      0.5,  # skeptical but ultimately renewed
        "churnReasonCount": round(rr(1, 5), 0) / 9.0,
        "hasExecCommitment":1.0,  # exec commitment is what saved them
    }


def seed(db_path: str = DB_PATH):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS feature_snapshots (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            seller_id        TEXT,
            feature_snapshot TEXT NOT NULL,
            outcome          TEXT,
            risk_score_rule  REAL,
            churn_prob_ml    REAL,
            logged_at        DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    count = conn.execute("SELECT COUNT(*) FROM feature_snapshots WHERE seller_id LIKE 'SEED_%'").fetchone()[0]
    if count >= 100:
        print(f"Already have {count} seed rows — skipping.")
        conn.close()
        return

    rows = []

    # 170 typical churned
    for i in range(170):
        r = generate_churned()
        rows.append(("SEED_C_%04d" % i, json.dumps(r), "Churned", rule_score(r)))

    # 30 externally churned (good metrics, still left)
    for i in range(30):
        r = generate_external_churn()
        rows.append(("SEED_EC_%04d" % i, json.dumps(r), "Churned", rule_score(r)))

    # 275 typical renewed
    for i in range(275):
        r = generate_renewed()
        rows.append(("SEED_R_%04d" % i, json.dumps(r), "Resolved", rule_score(r)))

    # 25 KAM-saved (bad metrics, renewed anyway)
    for i in range(25):
        r = generate_kam_saved()
        rows.append(("SEED_KS_%04d" % i, json.dumps(r), "Resolved", rule_score(r)))

    # Flip 13% of labels randomly — mimics real-world uncertainty
    # (misclassified outcomes, data entry errors, external factors)
    flip_indices = random.sample(range(len(rows)), int(len(rows) * 0.13))
    rows = list(rows)
    for idx in flip_indices:
        sid, snap, outcome, score = rows[idx]
        rows[idx] = (sid, snap, "Resolved" if outcome == "Churned" else "Churned", score)

    # Spread dates across last 9 months to look like real history
    base_date = datetime(2025, 8, 1)
    random.shuffle(rows)
    for idx, (seller_id, snap, outcome, score) in enumerate(rows):
        logged = base_date + timedelta(days=int(idx * 0.54))  # ~270 days spread
        conn.execute(
            "INSERT INTO feature_snapshots (seller_id, feature_snapshot, outcome, risk_score_rule, logged_at) VALUES (?,?,?,?,?)",
            (seller_id, snap, outcome, score, logged.isoformat()),
        )

    conn.commit()
    conn.close()
    print(f"Seeded 500 synthetic training examples into {db_path}")


if __name__ == "__main__":
    seed(DB_PATH)
