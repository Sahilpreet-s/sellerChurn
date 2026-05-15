"""
Generate 500 synthetic labeled training examples for XGBoost.
Each row is a feature snapshot with a churn label (1=churned, 0=renewed).

Labels are derived from the same rule-based logic the Go scorer uses,
plus realistic noise — so the XGBoost model will learn the same patterns
but generalize better once real outcomes accumulate.
"""
import sqlite3
import random
import math
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
]


def rule_score(row: dict) -> float:
    """Mirror of the Go calcRisk formula."""
    login_risk   = (100 - row["loginPct_last"])  * 0.15 + max(0, row["loginPct_drop"])  * 0.35
    bl_risk      = (100 - row["blPct_last"])      * 0.15 + max(0, row["blPct_drop"])      * 0.35
    pns_risk     = (100 - row["pnsPct_last"])     * 0.12 + max(0, row["pnsPct_drop"])     * 0.30
    lms_risk     = (100 - row["lmsPct_last"])     * 0.12 + max(0, row["lmsPct_drop"])     * 0.30
    retail_risk  = row["retailPct_last"]           * 0.12
    catalog_risk = (100 - row["catalogScore"])     * 0.06
    cqs_risk     = (100 - row["cqs"])              * 0.08
    score = min(100, login_risk + bl_risk + pns_risk + lms_risk + retail_risk + catalog_risk + cqs_risk)
    if row["priorChurn"] > 0.5:
        score = min(100, score * 1.30)
    return score


def rand_range(lo, hi):
    return lo + random.random() * (hi - lo)


def generate_row(churned: bool) -> dict:
    """Generate one feature row. Churned sellers have worse signals."""
    if churned:
        login_last  = rand_range(15, 55)
        login_drop  = rand_range(8, 35)
        bl_last     = rand_range(8, 48)
        bl_drop     = rand_range(8, 40)
        pns_last    = rand_range(10, 52)
        pns_drop    = rand_range(5, 30)
        lms_last    = rand_range(8, 48)
        lms_drop    = rand_range(5, 28)
        retail      = rand_range(35, 85)
        catalog     = rand_range(22, 62)
        cqs         = rand_range(20, 60)
        prior       = 1.0 if random.random() < 0.45 else 0.0  # 45% of churned had prior churn
        days        = rand_range(30, 90)
        arr_norm    = rand_range(0.05, 0.6)
    else:
        login_last  = rand_range(58, 98)
        login_drop  = rand_range(0, 12)
        bl_last     = rand_range(50, 95)
        bl_drop     = rand_range(0, 10)
        pns_last    = rand_range(55, 98)
        pns_drop    = rand_range(0, 10)
        lms_last    = rand_range(55, 95)
        lms_drop    = rand_range(0, 10)
        retail      = rand_range(10, 45)
        catalog     = rand_range(60, 95)
        cqs         = rand_range(58, 92)
        prior       = 1.0 if random.random() < 0.05 else 0.0  # 5% of renewers had prior churn
        days        = rand_range(30, 90)
        arr_norm    = rand_range(0.1, 1.0)

    return {
        "loginPct_last": round(login_last, 1),
        "loginPct_drop":  round(login_drop, 1),
        "blPct_last":    round(bl_last, 1),
        "blPct_drop":    round(bl_drop, 1),
        "pnsPct_last":   round(pns_last, 1),
        "pnsPct_drop":   round(pns_drop, 1),
        "lmsPct_last":   round(lms_last, 1),
        "lmsPct_drop":   round(lms_drop, 1),
        "retailPct_last":round(retail, 1),
        "catalogScore":  round(catalog, 1),
        "cqs":           round(cqs, 1),
        "priorChurn":    prior,
        "daysToRenewal": round(days, 0),
        "arr_norm":      round(arr_norm, 3),
    }


def seed(db_path: str, n: int = 500):
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

    # Check if already seeded
    count = conn.execute("SELECT COUNT(*) FROM feature_snapshots WHERE seller_id LIKE 'SEED_%'").fetchone()[0]
    if count >= n:
        print(f"Already have {count} seed rows — skipping.")
        conn.close()
        return

    rows = []
    # 250 churned, 250 renewed (balanced)
    for i in range(n // 2):
        r = generate_row(churned=True)
        rows.append(("SEED_C_%04d" % i, json.dumps(r), "Churned", rule_score(r)))
    for i in range(n // 2):
        r = generate_row(churned=False)
        rows.append(("SEED_R_%04d" % i, json.dumps(r), "Resolved", rule_score(r)))

    base_date = datetime(2025, 11, 1)
    for idx, (seller_id, snap, outcome, score) in enumerate(rows):
        logged = base_date + timedelta(days=idx // 3)
        conn.execute(
            "INSERT INTO feature_snapshots (seller_id, feature_snapshot, outcome, risk_score_rule, logged_at) VALUES (?,?,?,?,?)",
            (seller_id, snap, outcome, score, logged.isoformat()),
        )

    conn.commit()
    conn.close()
    print(f"Seeded {n} synthetic training examples into {db_path}")


if __name__ == "__main__":
    seed(DB_PATH)
