#!/usr/bin/env bash
# UrbanSaarthi - local runner (macOS / Linux).   ./run_local.sh help
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"; FRONTEND="$ROOT/frontend"; VENV="$BACKEND/.venv"
PY="${PYTHON:-python3}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
need_py() {
  "$PY" - <<'PYV' || { echo "Python 3.11+ is required (found: $("$PY" --version 2>&1)). Set PYTHON=/path/to/python3.12 and retry."; exit 1; }
import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)
PYV
}
activate() { [ -f "$VENV/bin/activate" ] || { echo "Run './run_local.sh setup' first."; exit 1; }; . "$VENV/bin/activate"; }

setup_backend() {
  say "Backend: virtualenv + dependencies"
  need_py
  [ -d "$VENV" ] || "$PY" -m venv "$VENV"
  . "$VENV/bin/activate"
  python -m pip install --upgrade pip
  python -m pip install -r "$BACKEND/requirements-core.txt"
  [ -f "$BACKEND/.env" ] || { cp "$BACKEND/.env.example" "$BACKEND/.env"; echo "Created backend/.env (edit it to add optional keys)."; }
  say "Backend: database migrations (SQLite by default)"
  (cd "$BACKEND" && alembic upgrade heads)
}
setup_frontend() {
  say "Frontend: npm install"
  command -v npm >/dev/null || { echo "Node.js 18+ and npm are required: https://nodejs.org"; exit 1; }
  [ -f "$FRONTEND/.env" ] || { cp "$FRONTEND/.env.example" "$FRONTEND/.env"; echo "Created frontend/.env"; }
  (cd "$FRONTEND" && npm install)
}

case "${1:-help}" in
  setup)         setup_backend; setup_frontend; say "Done. Next:  ./run_local.sh all   (or: check)";;
  setup-vision)  activate; python -m pip install -r "$BACKEND/requirements-vision.txt";;
  seed)          activate; (cd "$BACKEND" && python scripts/seed_demo.py ${2:-});;   # e.g. ./run_local.sh seed --demo-telemetry
  check)         "$PY" "$BACKEND/scripts/check_agent.py";;                        # no install needed
  test)          activate; (cd "$BACKEND" && python -m pytest -q);;
  backend)       activate; cd "$BACKEND"; exec uvicorn app.main:app --reload --host 127.0.0.1 --port 8000;;
  frontend)      cd "$FRONTEND"; exec npm run dev;;
  all)
    activate
    (cd "$BACKEND" && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000) & BPID=$!
    trap 'kill $BPID 2>/dev/null || true' EXIT INT TERM
    sleep 2
    say "API:      http://127.0.0.1:8000/docs     Web app: http://localhost:5173"
    cd "$FRONTEND" && npm run dev;;
  *) cat <<'H'
Usage: ./run_local.sh <command>
  setup         create venv, install backend deps, run migrations, npm install
  check         verify the Traffic Intelligence Agent (works with no installs at all)
  all           start backend (:8000) and frontend (:5173) together
  backend       start only the API          frontend   start only the web app
  test          run the backend pytest suite
  seed [--demo-telemetry]   load demo junctions (synthetic data)
  setup-vision  optional: install torch/ultralytics for the two vision pages
H
  ;;
esac
