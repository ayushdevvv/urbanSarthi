FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --create-home app

# requirements.txt includes the Google ADK requirements file. Copy all included
# requirement files before pip install so Docker builds are reproducible.
COPY requirements.txt requirements-agent.txt requirements-core.txt requirements-vision.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .
RUN chown -R app:app /app
USER app
EXPOSE 8000
CMD ["sh", "scripts/start.sh"]
