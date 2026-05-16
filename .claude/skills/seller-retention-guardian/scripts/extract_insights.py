"""
Extract structured call insights from a raw sales call transcript.

Requires: GEMINI_API_KEY environment variable (or set LLM_PROVIDER=openrouter
with OPENROUTER_API_KEY for OpenRouter compatibility).

Usage:
    # Pipe transcript text
    echo "Seller said TradeIndia gave them a better offer..." | python extract_insights.py

    # From file
    python extract_insights.py < transcript.txt

    # With metadata
    python extract_insights.py --agent "Vikram Singh" --date "2025-05-10" < transcript.txt

Output JSON (matches CallInsight schema in mock-sellers.ts and models/types.go):
{
  "date": "2025-05-10",
  "agent": "Vikram Singh",
  "durationMin": 0,
  "sentiment": "Negative",
  "summary": "...",
  "issues": ["Low BL", "Pricing"],
  "quote": "...",
  "disposition": "Skeptical",
  "competitorMentioned": "TradeIndia",
  "commitmentByExec": "",
  "source": "MANUAL"
}

Known issue categories (from classifier/cause.go platformIssues map):
  "BL filters not working", "Catalog edits rejected", "PNS routing",
  "Drop in enquiries", "Lead quality dropped", "Low BL", "Pricing",
  "PNS quality", "Renewal cost", "Competition"
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import date as _date


# ─── LLM client ───────────────────────────────────────────────────────────────

def _llm_call(prompt: str) -> str:
    provider = os.environ.get("LLM_PROVIDER", "gemini").lower()

    if provider == "openrouter":
        return _call_openai_compat(
            base_url="https://openrouter.ai/api/v1",
            model=os.environ.get("LLM_MODEL", "google/gemini-2.5-flash"),
            api_key=os.environ.get("OPENROUTER_API_KEY", ""),
            prompt=prompt,
        )

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("Error: GEMINI_API_KEY not set. Export it or set LLM_PROVIDER=openrouter.", file=sys.stderr)
        sys.exit(1)

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash:generateContent?key={api_key}"
    )
    payload = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 800, "responseMimeType": "application/json"},
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return data["candidates"][0]["content"]["parts"][0]["text"]


def _call_openai_compat(base_url: str, model: str, api_key: str, prompt: str) -> str:
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 800,
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


# ─── Extraction ───────────────────────────────────────────────────────────────

KNOWN_ISSUES = [
    "BL filters not working", "Catalog edits rejected", "PNS routing",
    "Drop in enquiries", "Lead quality dropped", "Low BL", "Pricing",
    "PNS quality", "Renewal cost", "Competition",
]

EXTRACT_PROMPT = """You are an IndiaMART KAM analyst. Extract structured insights from this seller call transcript.

Return JSON only:
{{
  "sentiment": "Negative|Neutral|Positive",
  "summary": "1-2 sentence summary of the call",
  "issues": ["issue1", "issue2"],
  "quote": "most revealing verbatim quote from the seller, or empty string",
  "disposition": "Willing|Skeptical|Hostile",
  "competitorMentioned": "competitor name or empty string",
  "commitmentByExec": "any specific commitment made by the exec, or empty string"
}}

Known issue categories (use these exact strings when they apply):
{issues}

Transcript:
{transcript}"""


def extract_insights(transcript: str, agent: str, call_date: str) -> dict:
    prompt = EXTRACT_PROMPT.format(
        issues=", ".join(f'"{i}"' for i in KNOWN_ISSUES),
        transcript=transcript,
    )

    raw = _llm_call(prompt)
    parsed = _parse_json(raw)

    return {
        "date":               call_date,
        "agent":              agent,
        "durationMin":        0,
        "sentiment":          parsed.get("sentiment", "Neutral"),
        "summary":            parsed.get("summary", ""),
        "issues":             parsed.get("issues", []),
        "quote":              parsed.get("quote", ""),
        "disposition":        parsed.get("disposition", ""),
        "competitorMentioned":parsed.get("competitorMentioned", ""),
        "commitmentByExec":   parsed.get("commitmentByExec", ""),
        "source":             "MANUAL",
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Extract structured insights from a call transcript")
    parser.add_argument("--agent", default="", help="Name of the sales executive on the call")
    parser.add_argument("--date", default=str(_date.today()), help="Call date YYYY-MM-DD (default: today)")
    args = parser.parse_args()

    transcript = sys.stdin.read().strip()
    if not transcript:
        print("Error: no transcript provided on stdin.", file=sys.stderr)
        sys.exit(1)

    insight = extract_insights(transcript, args.agent, args.date)
    print(json.dumps(insight, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
