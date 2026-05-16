"""Route handlers for the ML service."""
import json
import os
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db
import trainer

router = APIRouter()

DB_PATH    = os.environ.get("DB_PATH",    "../backend/data/sellerpulse.db")
MODEL_PATH = os.environ.get("MODEL_PATH", "./model.joblib")
STATS_PATH = os.environ.get("STATS_PATH", "./model_stats.json")

# Feature vectors keyed by seller_id — populated via POST /features at Go startup.
_feature_cache: dict[str, list[float]] = {}


RETRAIN_THRESHOLD = 5000


class FeaturePayload(BaseModel):
    sellerId: str
    features: dict[str, float]


class OutcomePayload(BaseModel):
    sellerId: str
    outcome: str
    featureSnapshot: dict[str, float]


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/stats")
def get_stats():
    if os.path.exists(STATS_PATH):
        with open(STATS_PATH) as f:
            stats = json.load(f)
        stats["trainingExamples"] = db.count_training_examples(DB_PATH)
        return stats
    return {
        "trainingExamples": db.count_training_examples(DB_PATH),
        "auc": 0.0,
        "nextRetrainAt": 5000,
        "lastTrainedAt": None,
        "modelActive": os.path.exists(MODEL_PATH),
    }


@router.get("/predict/{seller_id}")
def predict(seller_id: str):
    features = _feature_cache.get(seller_id)
    if features is None:
        features = db.load_latest_snapshot(seller_id, DB_PATH, trainer.FEATURE_COLS)
    if features is None:
        raise HTTPException(status_code=404, detail=f"No feature snapshot for {seller_id}")
    prob, top3 = trainer.predict(features)
    return {
        "sellerId": seller_id,
        "churnProb": round(prob, 4),
        "topFeatures": top3,
        "modelVersion": "xgb-v1",
    }


@router.post("/features")
def store_features(payload: FeaturePayload):
    """Called by the Go backend at startup to register all seller feature vectors."""
    features = [payload.features.get(col, 0.0) for col in trainer.FEATURE_COLS]
    _feature_cache[payload.sellerId] = features
    return {"stored": True}


@router.post("/outcomes")
def log_outcome(payload: OutcomePayload):
    """Called by Go after each KAM outcome. Feeds real labeled data into the training corpus."""
    count = db.insert_training_example(payload.sellerId, payload.featureSnapshot, payload.outcome, DB_PATH)

    # Auto-retrain once when real + synthetic examples cross the threshold
    if count == RETRAIN_THRESHOLD:
        def _retrain():
            print(f"[ml] auto-retraining — {count} training examples reached")
            trainer.train(DB_PATH)
        threading.Thread(target=_retrain, daemon=True).start()

    return {"stored": True, "trainingExamples": count, "nextRetrainAt": RETRAIN_THRESHOLD}


@router.post("/train")
def trigger_training():
    return trainer.train(DB_PATH)
