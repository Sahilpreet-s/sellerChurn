"""SQLite helpers for the ML service."""
import sqlite3
import json
import os
from typing import Optional

DB_PATH = os.environ.get("DB_PATH", "../backend/data/sellerpulse.db")


def count_training_examples(db_path: str = DB_PATH) -> int:
    """Count rows in feature_snapshots — the synthetic + real training corpus."""
    try:
        conn = sqlite3.connect(db_path)
        n = conn.execute("SELECT COUNT(*) FROM feature_snapshots").fetchone()[0]
        conn.close()
        return n
    except Exception:
        return 0


def insert_training_example(seller_id: str, feature_snapshot: dict, outcome: str, db_path: str = DB_PATH) -> int:
    """Write a real labeled KAM outcome into the ML training corpus. Returns total row count."""
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO feature_snapshots (seller_id, feature_snapshot, outcome) VALUES (?, ?, ?)",
        (seller_id, json.dumps(feature_snapshot), outcome),
    )
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM feature_snapshots").fetchone()[0]
    conn.close()
    return n


def load_latest_snapshot(seller_id: str, db_path: str, feature_cols: list[str]) -> Optional[list[float]]:
    """
    Fetch the most recent feature_snapshot for a real seller from the outcomes table.
    Used as a prediction fallback when the seller is not in the in-memory feature cache.
    (Distinct from feature_snapshots, which holds the ML training corpus.)
    """
    try:
        conn = sqlite3.connect(db_path)
        row = conn.execute(
            "SELECT feature_snapshot FROM outcomes WHERE seller_id=? ORDER BY id DESC LIMIT 1",
            (seller_id,),
        ).fetchone()
        conn.close()
        if row:
            snap = json.loads(row[0])
            return [snap.get(col, 0.0) for col in feature_cols]
    except Exception:
        pass
    return None
