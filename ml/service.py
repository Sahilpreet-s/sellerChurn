"""ML service — FastAPI app, lifespan, middleware, and entry point."""
import os
import uvicorn
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()  # loads ml/.env before any module reads os.environ

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import seed_data
import trainer
import routes
import agent_routes

DB_PATH = os.environ.get("DB_PATH", "../backend/data/sellerpulse.db")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Seeding synthetic training data...")
    seed_data.seed(DB_PATH)

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

app.include_router(routes.router)
app.include_router(agent_routes.router)


if __name__ == "__main__":
    uvicorn.run("service:app", host="0.0.0.0", port=8001, reload=False)
