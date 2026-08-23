FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app \
    PORT=8000

WORKDIR /app

# System libs for Pillow/reportlab image handling in PDF generation + postgresql-client for backups
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    zlib1g \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && pip install httpx python-dateutil

# Keep Cloud Run / existing start command compatible:
#   uvicorn main:app --host 0.0.0.0 --port $PORT
# Root main.py is a thin shim that imports backend.main:app
COPY main.py ./
COPY backend/ ./backend/
COPY data/ ./data/

EXPOSE 8000

# Single worker keeps in-memory WebSocket state consistent across connections.
# ${PORT} is injected by Cloud Run; WEB_CONCURRENCY defaults to 1.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-1}"]
