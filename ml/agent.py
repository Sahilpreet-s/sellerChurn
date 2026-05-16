"""
LangGraph agent for seller churn analysis.

Pipeline: score_xgboost → classify_cause → generate_guide

Existing /features, /predict, /train, /outcomes endpoints are untouched.
This module adds two entry points:
  run_agent(seller)   — sync, called by nightly batch via Go
  stream_agent(seller) — generator of SSE events, called by live demo endpoint
"""
import json
import os
import re
import urllib.request
from datetime import datetime
from typing import TypedDict

from langgraph.graph import StateGraph, END

import trainer  # existing XGBoost module — untouched

# ─── LLM client (mirrors LLM_PROVIDER logic from the Go backend) ──────────────

_PROVIDER = os.environ.get("LLM_PROVIDER", "gemini").lower()
_GEMINI_MODEL = "gemini-2.5-flash"


def _llm_call(prompt: str, max_tokens: int = 1024) -> str:
    if _PROVIDER == "openrouter":
        return _call_openai_compat(
            base_url="https://openrouter.ai/api/v1",
            model=os.environ.get("LLM_MODEL", "google/gemini-2.5-flash"),
            api_key=os.environ.get("OPENROUTER_API_KEY", ""),
            prompt=prompt,
            max_tokens=max_tokens,
        )
    if _PROVIDER == "litellm":
        base = os.environ.get("LITELLM_BASE_URL", "https://imllm.intermesh.net").rstrip("/")
        return _call_openai_compat(
            base_url=f"{base}/v1",
            model=os.environ.get("LLM_MODEL", "google/gemini-2.5-flash-lite"),
            api_key=os.environ.get("LITELLM_API_KEY", ""),
            prompt=prompt,
            max_tokens=max_tokens,
        )
    return _call_gemini(prompt, max_tokens)


def _call_gemini(prompt: str, max_tokens: int) -> str:
    api_key = os.environ.get("GEMINI_API_KEY", "")
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{_GEMINI_MODEL}:generateContent?key={api_key}"
    )
    payload = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json",
        },
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return data["candidates"][0]["content"]["parts"][0]["text"]


def _call_openai_compat(base_url: str, model: str, api_key: str, prompt: str, max_tokens: int) -> str:
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }).encode()
    headers: dict = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(f"{base_url}/chat/completions", data=payload, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


def _parse_json(text: str):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text.strip())


# ─── State ────────────────────────────────────────────────────────────────────

class AnalysisState(TypedDict):
    seller: dict
    xgb_prob: float
    xgb_top_features: list
    llm_risk_score: int
    churn_cause: str
    cause_reason: str
    guide_sections: list   # [{title, pitch, actions[]}] — matches Go's GuideSection
    events: list           # accumulated SSE events; each node appends one entry


# ─── Metric helpers ───────────────────────────────────────────────────────────

def _latest(h: list) -> float:
    return h[-1]["value"] if h else 0.0


def _drop(h: list) -> float:
    if len(h) < 2:
        return 0.0
    return max(0.0, h[0]["value"] - h[-1]["value"])


def _build_xgb_features(seller: dict) -> list[float]:
    """Mirrors buildFeatures() in backend/internal/batch/nightly.go exactly."""
    m = seller.get("metrics", {})
    insights = seller.get("callInsights", [])

    insights = insights or []  # guard against JSON null
    has_competitor = disposition = has_exec = 0.0
    for c in insights:
        if c.get("competitorMentioned"):
            has_competitor = 1.0
        if c.get("commitmentByExec"):
            has_exec = 1.0
        d = c.get("disposition", "")
        if d == "Hostile":
            disposition = 1.0
        elif d == "Skeptical" and disposition < 1.0:
            disposition = 0.5

    return [
        _latest(m.get("loginPct", [])),          _drop(m.get("loginPct", [])),
        _latest(m.get("blConsumptionPct", [])),   _drop(m.get("blConsumptionPct", [])),
        _latest(m.get("pnsPickupRatePct", [])),   _drop(m.get("pnsPickupRatePct", [])),
        _latest(m.get("lmsReplyRatePct", [])),    _drop(m.get("lmsReplyRatePct", [])),
        _latest(m.get("retailBlRecommendedPct", [])),
        _latest(m.get("catalogScore", [])),
        _latest(m.get("cqs", [])),
        1.0 if seller.get("priorChurn") else 0.0,
        float(seller.get("daysToRenewal", 0)),
        seller.get("arr", 0) / 350_000.0,
        has_competitor, disposition, 0.0, has_exec,
    ]


# ─── Node 1: XGBoost scoring ──────────────────────────────────────────────────

def node_score(state: AnalysisState) -> dict:
    features = _build_xgb_features(state["seller"])
    prob, top3 = trainer.predict(features)
    return {
        "xgb_prob": prob,
        "xgb_top_features": top3,
        "events": state["events"] + [{
            "step": "xgboost",
            "label": "Risk scored with XGBoost",
            "churnProb": round(prob, 4),
            "topFeatures": top3,
        }],
    }


# ─── Node 2: Cause classification ────────────────────────────────────────────

def node_classify(state: AnalysisState) -> dict:
    s = state["seller"]
    m = s.get("metrics", {})
    insights = s.get("callInsights", [])
    live = s.get("liveContext")  # present only for real IndiaMART GLIDs
    insights = insights or []  # guard against JSON null
    month = datetime.now().month

    signals = "\n".join([
        f"  Login %:        {_latest(m.get('loginPct', [])):.0f}%  (3-month drop: {_drop(m.get('loginPct', [])):.0f}pts)",
        f"  BL Consumption: {_latest(m.get('blConsumptionPct', [])):.0f}%  (drop: {_drop(m.get('blConsumptionPct', [])):.0f}pts)",
        f"  PNS Pickup:     {_latest(m.get('pnsPickupRatePct', [])):.0f}%",
        f"  LMS Reply Rate: {_latest(m.get('lmsReplyRatePct', [])):.0f}%",
        f"  Retail BL %:    {_latest(m.get('retailBlRecommendedPct', [])):.0f}%  (>52% = BL filter mismatch)",
    ])

    call_lines = []
    for c in insights[-4:]:
        line = f"  [{c.get('date', '?')}] {c.get('sentiment', '')} | {c.get('disposition', 'Unknown')} disposition"
        if c.get("competitorMentioned"):
            line += f" | Competitor: {c['competitorMentioned']}"
        if c.get("issues"):
            line += f" | Issues: {', '.join(c['issues'])}"
        if c.get("quote"):
            line += f" | \"{c['quote']}\""
        call_lines.append(line)

    # Date context — critical for partial-month data interpretation.
    if live:
        elapsed = live.get("daysElapsedInMonth", 0)
        curr_month = live.get("currentMonth", "")
        curr_date = live.get("currentDate", "")
        date_ctx = (
            f"\nCURRENT DATE: {curr_date} — day {elapsed} of {curr_month}\n"
            "⚠ The current month is PARTIAL. Metrics for this month are naturally lower "
            "than a full month; evaluate trends and rates, not raw numbers."
        )
    else:
        date_ctx = ""

    # Extra real-data signals for the LLM (absent for synthetic sellers).
    live_signals = ""
    if live:
        trend = live.get("monthlyTrend", [])
        trend_lines = "\n".join([
            f"  {t['month']}: {int(t['enq'])} enquiries, "
            f"{int(t['blCons'])} BL used (lapsed: {int(t['blLapsed'])}), "
            f"{int(t['blni'])} BL-NI flags, {t['successConnect']} successful connect"
            for t in trend
        ])
        live_signals = (
            f"\nSALES TEAM ACTIVITY:\n"
            f"  Outgoing calls: {live['outgoingCallAttempted']} attempted / "
            f"{live['outgoingCallAnswered']} answered\n"
            f"  Assigned exec: {live.get('salesExecName', 'Unknown')}\n"
            f"\nPRODUCT HEALTH (current month):\n"
            f"  Live products: {live['livePrdCnt']} | "
            f"A-rank categories: {live['aRankMcats']} | "
            f"B/C-rank primary: {live['bAndCRankPrimary']}\n"
            f"  Top categories: {live.get('topCategories', '')}\n"
            f"\nMONTHLY DETAIL — last 3 months, oldest → newest:\n{trend_lines}\n"
        )

    seller_line = f"{s.get('name')} | {s.get('category')} | {s.get('packageType')}"
    if s.get("company"):
        seller_line = f"{s.get('name')} | {s.get('company')} | {s.get('category')} | {s.get('packageType')}"

    prompt = f"""You are a senior seller success analyst at IndiaMART.
{date_ctx}
SELLER: {seller_line} | ARR ₹{s.get('arr', 0)//1000 if s.get('arr') else 'N/A'}k
Days to renewal: {s.get('daysToRenewal') or 'N/A'} | Month: {month} | Prior churn: {s.get('priorChurn', False)}

ENGAGEMENT METRICS (3-month trend):
{signals}

CALL HISTORY (most recent):
{chr(10).join(call_lines) if call_lines else "  No call history"}
{live_signals}
XGBOOST OUTPUT:
  Churn probability: {state['xgb_prob'] * 100:.1f}%
  Top features driving score: {', '.join(state['xgb_top_features']) if state['xgb_top_features'] else 'model not yet trained'}

Classify the PRIMARY churn cause — pick exactly one:
- EXTERNAL: competitor or external market pressure is the dominant driver
- PLATFORM_FAILURE: platform product issue (BL filter, PNS, catalog) is the main frustration
- BEHAVIORAL: seller progressively disengaging with no clear external or product trigger
- MIXED: only when multiple causes are genuinely of equal weight

Factor in seasonal context: month {month} may explain metric dips for certain categories (construction Apr–Jun, textiles Oct–Dec, agriculture post-monsoon Aug–Sep).

Also assign a churn risk score from 0–100:
- 70–100: high risk — immediate intervention required
- 40–69: medium risk — close monitoring and proactive outreach
- 0–39: low risk — healthy engagement, routine check-in sufficient

Return JSON only, no markdown:
{{"cause": "EXTERNAL|PLATFORM_FAILURE|BEHAVIORAL|MIXED", "reason": "one sentence citing specific signals", "riskScore": 0}}"""

    try:
        raw = _llm_call(prompt, max_tokens=300)
        parsed = _parse_json(raw)
        cause = parsed.get("cause", "MIXED")
        reason = parsed.get("reason", "")
        risk_score = int(parsed.get("riskScore", 50))
        risk_score = max(0, min(100, risk_score))
    except Exception as e:
        cause, reason, risk_score = "MIXED", f"Classification unavailable: {e}", 50

    return {
        "churn_cause": cause,
        "cause_reason": reason,
        "llm_risk_score": risk_score,
        "events": state["events"] + [{
            "step": "classify",
            "label": f"Cause identified: {cause}",
            "churnCause": cause,
            "causeReason": reason,
            "riskScore": risk_score,
        }],
    }


# ─── Node 3: Guide generation ─────────────────────────────────────────────────

def node_guide(state: AnalysisState) -> dict:
    s = state["seller"]
    cause = state["churn_cause"]
    insights = s.get("callInsights", [])
    live = s.get("liveContext")
    insights = insights or []  # guard against JSON null
    last_quote = next((c["quote"] for c in reversed(insights) if c.get("quote")), "")

    date_exec_ctx = ""
    if live:
        curr_date = live.get("currentDate", "")
        curr_month = live.get("currentMonth", "")
        elapsed = live.get("daysElapsedInMonth", 0)
        exec_name = live.get("salesExecName", "")
        date_exec_ctx = f"Current date: {curr_date} (day {elapsed} of {curr_month})"
        if exec_name:
            date_exec_ctx += f"\nAssigned exec: {exec_name}"

    strategy_focus = {
        "EXTERNAL": (
            "Focus on switching cost and IndiaMART's established buyer network. "
            "Counter the competitor pitch with the seller's own lead history data — make it concrete. "
            "Never offer a price discount as the first move; it signals the product isn't worth full price."
        ),
        "PLATFORM_FAILURE": (
            "Acknowledge the platform issue directly and escalate to Product immediately. "
            "Offer a catalog expert session and dedicated account review as a service upgrade. "
            "The seller must feel heard before any retention argument lands."
        ),
        "BEHAVIORAL": (
            "Re-engage through ROI demonstration — show actual leads received and response quality. "
            "Schedule an account review within 48 hours. "
            "Behavioral disengagement often signals confusion or overwhelm, not active dissatisfaction."
        ),
        "MIXED": (
            "Separate the issues — handle platform complaints and competitive threat in different parts of the call. "
            "Coordinate Sales Exec and Sales Manager; don't let one exec carry both angles alone."
        ),
    }.get(cause, "")

    seller_id_line = s.get('name') or s.get('id', '')
    cat_line = s.get('category') or ''
    pkg_line = s.get('packageType') or ''

    prompt = f"""You are a KAM retention strategy expert at IndiaMART.

SELLER: {seller_id_line} | {cat_line} | {pkg_line} package
Churn cause: {cause} — {state['cause_reason']}
XGBoost churn probability: {state['xgb_prob'] * 100:.1f}%
Days to renewal: {s.get('daysToRenewal') or 'N/A'}
{date_exec_ctx}
{f'Last seller quote: "{last_quote}"' if last_quote else ''}

Strategy direction: {strategy_focus}

Generate exactly 3 retention action sections. Each must be immediately actionable for a field KAM.
Reference the seller's specific category, package, and cause — no generic advice.

Return JSON array only, no markdown:
[
  {{"title": "short action title", "pitch": "1-2 sentence opening the exec reads aloud", "actions": ["specific step 1", "specific step 2", "specific step 3"]}},
  {{"title": "...", "pitch": "...", "actions": ["...", "...", "..."]}},
  {{"title": "...", "pitch": "...", "actions": ["...", "...", "..."]}}
]"""

    try:
        raw = _llm_call(prompt, max_tokens=1200)
        guide = _parse_json(raw)
        if not isinstance(guide, list):
            guide = [{"title": "Action Required", "pitch": str(guide)[:200], "actions": []}]
    except Exception as e:
        guide = [{"title": "Action Required", "pitch": f"Guide unavailable: {e}", "actions": []}]

    return {
        "guide_sections": guide,
        "events": state["events"] + [{
            "step": "guide",
            "label": "Retention guide ready",
            "guide": guide,
        }],
    }


# ─── Graph ────────────────────────────────────────────────────────────────────

def _build_graph():
    g = StateGraph(AnalysisState)
    g.add_node("score", node_score)
    g.add_node("classify", node_classify)
    g.add_node("guide", node_guide)
    g.set_entry_point("score")
    g.add_edge("score", "classify")
    g.add_edge("classify", "guide")
    g.add_edge("guide", END)
    return g.compile()


_graph = _build_graph()


# ─── Public API ───────────────────────────────────────────────────────────────

def run_agent(seller: dict) -> dict:
    """
    Synchronous full pipeline. Called by the nightly batch via Go POST /agent/analyze.
    Returns churnCause, causeReason, guide (in GuideSection format), churnProb, topFeatures.
    """
    result = _graph.invoke({
        "seller": seller,
        "xgb_prob": 0.0,
        "xgb_top_features": [],
        "llm_risk_score": 0,
        "churn_cause": "MIXED",
        "cause_reason": "",
        "guide_sections": [],
        "events": [],
    })
    return {
        "sellerId": seller.get("id"),
        "churnProb": result["xgb_prob"],
        "topFeatures": result["xgb_top_features"],
        "churnCause": result["churn_cause"],
        "causeReason": result["cause_reason"],
        "guide": result["guide_sections"],
    }


def stream_agent(seller: dict):
    """
    Generator yielding one JSON-encoded event per completed node.
    Called by POST /agent/analyze/stream for the live demo SSE endpoint.
    """
    initial = {
        "seller": seller,
        "xgb_prob": 0.0,
        "xgb_top_features": [],
        "llm_risk_score": 0,
        "churn_cause": "MIXED",
        "cause_reason": "",
        "guide_sections": [],
        "events": [],
    }
    for chunk in _graph.stream(initial, stream_mode="updates"):
        for _node_name, node_updates in chunk.items():
            events = node_updates.get("events", [])
            if events:
                yield json.dumps(events[-1])
    yield json.dumps({"step": "done", "label": "Analysis complete"})
