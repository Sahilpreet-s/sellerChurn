"""
Full three-tier seller analysis via the LangGraph agent streaming endpoint.

Requires the ChurnGaurd stack to be running:
    docker compose up   (starts ml:8001 → backend:8080 → frontend:5173)

Usage:
    python analyze.py S-20001
    python analyze.py S-20001 --base-url http://localhost:8080
    python analyze.py S-20001 --json          # raw JSON output, no pretty print

The script calls POST /api/v1/agent/analyze/stream (SSE) and prints each
pipeline node as it completes:
    [1/3] XGBoost scored      → churn probability + top 3 features
    [2/3] Cause classified    → External / Seller Disengaged / Mixed + reason
    [3/3] Retention guide     → 3 actionable KAM sections
"""
import argparse
import json
import sys
import urllib.request
import urllib.error


def stream_analysis(seller_id: str, base_url: str, raw_json: bool) -> int:
    url = f"{base_url.rstrip('/')}/api/v1/agent/analyze/stream"
    payload = json.dumps({"sellerId": seller_id}).encode()

    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        )
        resp = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        print(f"Error {e.code}: {e.reason}", file=sys.stderr)
        if e.code == 404:
            print(f"Seller '{seller_id}' not found. Check the GLID.", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"Cannot reach {base_url} — is the stack running?", file=sys.stderr)
        print(f"  Start with: docker compose up", file=sys.stderr)
        return 1

    step_labels = {
        "xgboost": "[1/3] XGBoost scored",
        "classify": "[2/3] Cause classified",
        "guide":    "[3/3] Retention guide ready",
        "done":     "     Analysis complete",
    }

    if not raw_json:
        print(f"\nAnalysing seller {seller_id}...\n")

    events = []
    for raw_line in resp:
        line = raw_line.decode("utf-8").strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data:
            continue
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            continue

        events.append(event)
        step = event.get("step", "")

        if raw_json:
            print(json.dumps(event, indent=2))
            continue

        label = step_labels.get(step, f"[{step}]")

        if step == "xgboost":
            prob_pct = round(event.get("churnProb", 0) * 100, 1)
            top = ", ".join(event.get("topFeatures", []))
            print(f"{label}")
            print(f"     Churn probability : {prob_pct}%")
            print(f"     Top features      : {top}")

        elif step == "classify":
            print(f"\n{label}")
            print(f"     Cause      : {event.get('churnCause', '—')}")
            print(f"     Risk score : {event.get('riskScore', '—')}")
            print(f"     Reason     : {event.get('causeReason', '—')}")

        elif step == "guide":
            print(f"\n{label}")
            guide = event.get("guide", [])
            for i, section in enumerate(guide, 1):
                print(f"\n     {i}. {section.get('title', '')}")
                print(f"        {section.get('pitch', '')}")
                for action in section.get("actions", []):
                    print(f"        • {action}")

        elif step == "done":
            print(f"\n{label}\n")

    return 0


def main():
    parser = argparse.ArgumentParser(description="Analyse a seller through the 3-tier pipeline")
    parser.add_argument("seller_id", help="Seller GLID, e.g. S-20001")
    parser.add_argument("--base-url", default="http://localhost:8080", help="Backend base URL")
    parser.add_argument("--json", dest="raw_json", action="store_true", help="Print raw JSON events")
    args = parser.parse_args()

    sys.exit(stream_analysis(args.seller_id, args.base_url, args.raw_json))


if __name__ == "__main__":
    main()
