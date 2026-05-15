"""
XGBoost FastAPI microservice. Runs on port 8001.
Go backend calls this for ML predictions and training triggers.
"""
import json
import os
import sqlite3
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import seed_data
import trainer

DB_PATH    = os.environ.get("DB_PATH",    "../backend/data/sellerpulse.db")
MODEL_PATH = os.environ.get("MODEL_PATH", "./model.joblib")
STATS_PATH = os.environ.get("STATS_PATH", "./model_stats.json")

FEATURE_COLS = trainer.FEATURE_COLS

# ─── Feature cache keyed by seller_id ────────────────────────────────────────
# The Go backend posts feature snapshots to /outcomes when a KAM logs a result.
# For prediction, we pull from the outcomes table if the seller is there,
# or use the pre-computed snapshot passed directly.
_feature_cache: dict[str, list[float]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Seed synthetic training data if DB is empty
    print("Seeding synthetic training data...")
    seed_data.seed(DB_PATH)

    # 2. Train model on startup
    print("Training XGBoost model...")
    stats = trainer.train(DB_PATH)
    print(f"Model ready. AUC={stats.get('auc', 'N/A')} on {stats.get('trainingExamples')} examples")
    yield


app = FastAPI(title="SellerPulse ML Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class FeaturePayload(BaseModel):
    sellerId: str
    features: dict[str, float]


class OutcomePayload(BaseModel):
    sellerId: str
    outcome: str
    featureSnapshot: dict[str, float]


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/stats")
def get_stats():
    if os.path.exists(STATS_PATH):
        with open(STATS_PATH) as f:
            stats = json.load(f)
        stats["trainingExamples"] = _count_outcomes()
        return stats
    return {
        "trainingExamples": _count_outcomes(),
        "auc": 0.0,
        "nextRetrainAt": 5000,
        "lastTrainedAt": None,
        "modelActive": os.path.exists(MODEL_PATH),
    }


@app.get("/predict/{seller_id}")
def predict(seller_id: str):
    features = _feature_cache.get(seller_id)
    if features is None:
        # Try to pull the most recent snapshot from the outcomes table
        features = _load_latest_snapshot(seller_id)
    if features is None:
        raise HTTPException(status_code=404, detail=f"No feature snapshot for {seller_id}")

    prob, top3 = trainer.predict(features)
    return {
        "sellerId": seller_id,
        "churnProb": round(prob, 4),
        "topFeatures": top3,
        "modelVersion": "xgb-v1",
    }


@app.post("/features")
def store_features(payload: FeaturePayload):
    """Called by Go backend when computing predictions for all sellers."""
    features = [payload.features.get(col, 0.0) for col in FEATURE_COLS]
    _feature_cache[payload.sellerId] = features
    return {"stored": True}


@app.post("/train")
def trigger_training():
    result = trainer.train(DB_PATH)
    return result


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _count_outcomes() -> int:
    try:
        conn = sqlite3.connect(DB_PATH)
        n = conn.execute("SELECT COUNT(*) FROM feature_snapshots").fetchone()[0]
        conn.close()
        return n
    except Exception:
        return 0


def _load_latest_snapshot(seller_id: str) -> Optional[list[float]]:
    try:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute(
            "SELECT feature_snapshot FROM outcomes WHERE seller_id=? ORDER BY id DESC LIMIT 1",
            (seller_id,)
        ).fetchone()
        conn.close()
        if row:
            snap = json.loads(row[0])
            return [snap.get(col, 0.0) for col in FEATURE_COLS]
    except Exception:
        pass
    return None


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("service:app", host="0.0.0.0", port=8001, reload=False)
