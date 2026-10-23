#!/usr/bin/env sh
set -eu

# `heads` handles the case where the deployed repository contains more than
# one Alembic branch head. Do not seed placeholder city/junction records on
# every production boot; location-based fallbacks are provided by the APIs.
alembic upgrade heads
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
