# Cloud Build builds this image for Cloud Run; Docker is not required on the developer machine.
FROM node:22-bookworm-slim AS web-build
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080 \
    APP_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libglib2.0-0 libgl1 libgomp1 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/requirements.txt backend/requirements-agent.txt ./
COPY backend/requirements-core.txt backend/requirements-vision.txt ./
RUN python -m pip install --upgrade pip && pip install -r requirements.txt
COPY backend/ ./
COPY --from=web-build /workspace/frontend/dist ./app/static
EXPOSE 8080
CMD ["sh", "-c", "alembic upgrade heads && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
