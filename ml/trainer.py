"""
XGBoost trainer. Reads labeled snapshots from SQLite, trains the model,
evaluates AUC, and saves the model if it improves.
"""
import sqlite3
import json
import os
import joblib
import numpy as np
from datetime import datetime
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
import xgboost as xgb

DB_PATH    = os.environ.get("DB_PATH",    "../backend/data/sellerpulse.db")
MODEL_PATH = os.environ.get("MODEL_PATH", "./model.joblib")
STATS_PATH = os.environ.get("STATS_PATH", "./model_stats.json")

FEATURE_COLS = [
    "loginPct_last", "loginPct_drop",
    "blPct_last",    "blPct_drop",
    "pnsPct_last",   "pnsPct_drop",
    "lmsPct_last",   "lmsPct_drop",
    "retailPct_last", "catalogScore", "cqs",
    "priorChurn",    "daysToRenewal", "arr_norm",
]


def load_training_data(db_path: str):
    conn = sqlite3.connect(db_path)
    rows = conn.execute("""
        SELECT feature_snapshot, outcome FROM feature_snapshots
        WHERE outcome IN ('Churned', 'Resolved', 'Escalated')
    """).fetchall()
    conn.close()

    X, y = [], []
    for snap_json, outcome in rows:
        try:
            snap = json.loads(snap_json)
            features = [snap.get(col, 0.0) for col in FEATURE_COLS]
            label = 1 if outcome == "Churned" else 0
            X.append(features)
            y.append(label)
        except Exception:
            continue
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int32)


def train(db_path: str = DB_PATH) -> dict:
    X, y = load_training_data(db_path)
    n = len(X)
    if n < 50:
        return {"error": f"Only {n} labeled rows — need at least 50 to train"}

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        use_label_encoder=False,
        eval_metric="logloss",
        random_state=42,
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    y_prob = model.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, y_prob) if len(set(y_test)) > 1 else 0.5

    # Feature importances
    importances = dict(zip(FEATURE_COLS, model.feature_importances_.tolist()))
    top_features = sorted(importances, key=importances.get, reverse=True)[:5]

    # Load old AUC and only swap if improved
    old_auc = 0.0
    if os.path.exists(STATS_PATH):
        with open(STATS_PATH) as f:
            old_stats = json.load(f)
            old_auc = old_stats.get("auc", 0.0)

    swapped = False
    if auc > old_auc + 0.01 or not os.path.exists(MODEL_PATH):
        joblib.dump(model, MODEL_PATH)
        swapped = True

    stats = {
        "trainingExamples": n,
        "auc": round(auc, 4),
        "previousAuc": round(old_auc, 4),
        "swapped": swapped,
        "topFeatures": top_features,
        "featureImportances": {k: round(v, 4) for k, v in importances.items()},
        "nextRetrainAt": 5000,
        "lastTrainedAt": datetime.utcnow().isoformat() + "Z",
        "modelActive": True,
    }
    with open(STATS_PATH, "w") as f:
        json.dump(stats, f, indent=2)

    return stats


def predict(features: list) -> tuple[float, list[str]]:
    """Returns (churn_probability, top_3_feature_names)."""
    if not os.path.exists(MODEL_PATH):
        return 0.5, []
    model = joblib.load(MODEL_PATH)
    X = np.array([features], dtype=np.float32)
    prob = float(model.predict_proba(X)[0, 1])
    importances = dict(zip(FEATURE_COLS, model.feature_importances_.tolist()))
    top3 = sorted(importances, key=importances.get, reverse=True)[:3]
    return prob, top3


if __name__ == "__main__":
    result = train()
    print(json.dumps(result, indent=2))
