#!/usr/bin/env sh
set -eu

# Print the migration graph in deployment logs, then apply every current head.
echo "== Alembic migration heads in deployed source =="
alembic heads
echo "== Applying database migrations =="
alembic upgrade heads
echo "== Registering provider sources and optional first administrator =="
python scripts/seed_demo.py
echo "== Starting UrbanSaarthi API =="
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
