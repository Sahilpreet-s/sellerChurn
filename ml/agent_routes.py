"""
Agent API routes — additive, does not touch existing /features, /predict, /train, /outcomes, /stats.

POST /agent/analyze        — sync, for nightly batch (Go calls this)
POST /agent/analyze/stream — SSE streaming, for live demo UI
"""
import json
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import agent

router = APIRouter(prefix="/agent")


class AnalyzeRequest(BaseModel):
    seller: dict[str, Any]


@router.post("/analyze")
def analyze(req: AnalyzeRequest):
    """Synchronous analysis. Used by the Go nightly batch."""
    return agent.run_agent(req.seller)


@router.post("/analyze/stream")
def analyze_stream(req: AnalyzeRequest):
    """
    SSE streaming analysis. Used by the live demo UI via Go proxy.
    Each LangGraph node completion emits one 'data: {...}\\n\\n' event.
    """
    def _generate():
        for event_json in agent.stream_agent(req.seller):
            yield f"data: {event_json}\n\n"

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
