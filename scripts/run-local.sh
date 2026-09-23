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
# This script is explicitly for the private loopback development app.
export FLOWLIST_AUTH_MODE=local FLOWLIST_ENV=development

# Keep SQLite for quick mode, but reuse an existing key from backend/.env when
# the quick-local file leaves AI disabled. The secret stays in the environment.
if [[ -z "${OPENAI_API_KEY:-}" && -f "$BACKEND_DIR/.env" ]]; then
  OPENAI_API_KEY="$(sed -n 's/^OPENAI_API_KEY=//p' "$BACKEND_DIR/.env")"
  export OPENAI_API_KEY
fi

if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  npm --prefix "$ROOT_DIR/frontend" ci
fi

"$BACKEND_DIR/.venv/bin/alembic" upgrade head
"$BACKEND_DIR/.venv/bin/uvicorn" main:app --port 8000 > "$ROOT_DIR/.flowlist-backend.log" 2>&1 &
BACKEND_PID=$!
node "$ROOT_DIR/frontend/node_modules/vite/bin/vite.js" "$ROOT_DIR/frontend" --host 127.0.0.1 --port 5500 --strictPort > "$ROOT_DIR/.flowlist-frontend.log" 2>&1 &
FRONTEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Flowlist is running at http://127.0.0.1:5500"
echo "Backend health: http://127.0.0.1:8000/health"
echo "Press Ctrl+C to stop both servers."
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
echo "A Flowlist server stopped. Check .flowlist-backend.log and .flowlist-frontend.log."
exit 1
