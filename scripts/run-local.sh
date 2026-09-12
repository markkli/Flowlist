#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

if [[ ! -x "$BACKEND_DIR/.venv/bin/uvicorn" ]]; then
  echo "Flowlist's local environment is missing. Run:"
  echo "  python3 -m venv backend/.venv"
  echo "  backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt"
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/local-development.env" ]]; then
  cp "$BACKEND_DIR/local-development.env.example" "$BACKEND_DIR/local-development.env"
  echo "Created backend/local-development.env (AI breakdown remains disabled until you add a key)."
fi

cd "$BACKEND_DIR"
set -a
source local-development.env
set +a

"$BACKEND_DIR/.venv/bin/alembic" upgrade head
"$BACKEND_DIR/.venv/bin/uvicorn" main:app --port 8000 > "$ROOT_DIR/.flowlist-backend.log" 2>&1 &
BACKEND_PID=$!
python3 -m http.server 5500 -d "$ROOT_DIR/frontend" > "$ROOT_DIR/.flowlist-frontend.log" 2>&1 &
FRONTEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Flowlist is running at http://127.0.0.1:5500"
echo "Backend health: http://127.0.0.1:8000/health"
echo "Press Ctrl+C to stop both servers."
wait "$BACKEND_PID" "$FRONTEND_PID"
