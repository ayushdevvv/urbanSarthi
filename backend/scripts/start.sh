#!/usr/bin/env sh
set -eu

# Print the migration graph in deployment logs, then apply every current head.
echo "== Alembic migration heads in deployed source =="
alembic heads
echo "== Applying database migrations =="
alembic upgrade heads
echo "== Traffic simulation runtime =="
WHEEL_SUMO_HOME="$(python -c 'import sumo; print(sumo.SUMO_HOME)' 2>/dev/null || true)"
if [ -n "$WHEEL_SUMO_HOME" ] && [ -x "$WHEEL_SUMO_HOME/bin/sumo" ]; then
  export SUMO_HOME="$WHEEL_SUMO_HOME"
  export PATH="$SUMO_HOME/bin:$PATH"
  export SUMO_BINARY="$SUMO_HOME/bin/sumo"
fi
if [ -n "${SUMO_BINARY:-}" ] && [ -x "$SUMO_BINARY" ]; then
  "$SUMO_BINARY" --version | head -n 2
elif command -v sumo >/dev/null 2>&1; then
  sumo --version | head -n 2
else
  echo "Native road simulation unavailable; network forecast mode remains enabled."
fi
echo "== Registering provider sources and optional first administrator =="
python scripts/seed_demo.py
echo "== Starting UrbanSaarthi API =="
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
