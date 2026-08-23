FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080 \
    MODEL_LOCAL_PATH=/models/qwen2.5-3b-instruct-q4.gguf \
    PRELOAD_MODEL=1 \
    N_CTX=8192 \
    N_THREADS=4 \
    # Portable CPU build (Cloud Build hosts != Cloud Run hosts).
    CMAKE_ARGS="-DGGML_NATIVE=OFF -DGGML_BLAS=OFF -DGGML_CCACHE=OFF" \
    FORCE_CMAKE=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY app.py ./

RUN mkdir -p /models

EXPOSE 8080

# Single worker: one in-memory model per instance.
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --timeout-keep-alive 75"]
