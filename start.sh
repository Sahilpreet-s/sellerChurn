#!/usr/bin/env bash
# SellerPulse 360° — start all 3 services
# Usage: ./start.sh
# Requires: Go 1.21+, Python 3.10+, bun (or node)

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── 1. Python ML service ────────────────────────────────────────────────────
echo "▶ Starting ML service on :8001..."
cd "$ROOT/ml"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
DB_PATH="$ROOT/backend/data/sellerpulse.db" \
  .venv/bin/python service.py &
ML_PID=$!
echo "  ML PID: $ML_PID"
sleep 3  # wait for training to complete

# ── 2. Go backend ───────────────────────────────────────────────────────────
echo "▶ Starting Go backend on :8080..."
cd "$ROOT/backend"
cp -n .env.example .env 2>/dev/null || true
set -a; source .env 2>/dev/null || true; set +a
go run ./cmd/server &
GO_PID=$!
echo "  Go PID: $GO_PID"
sleep 2

# ── 3. React frontend ───────────────────────────────────────────────────────
echo "▶ Starting React frontend on :3000..."
cd "$ROOT/frontend"
bun run dev &
FRONTEND_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SellerPulse 360° running"
echo "  Frontend:   http://localhost:3000"
echo "  Go API:     http://localhost:8080/api/v1/sellers"
echo "  ML Service: http://localhost:8001/stats"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Press Ctrl+C to stop all services"

# Cleanup on exit
trap "kill $ML_PID $GO_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
