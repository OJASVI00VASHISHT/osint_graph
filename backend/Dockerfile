# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder – install Python dependencies in an isolated layer so the
# final image does not need pip, build tools, or caches.
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# System packages needed to compile some Python wheels (e.g. lxml).
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install --no-cache-dir --prefix=/install -r requirements.txt


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime – lean image with only what the application needs.
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

LABEL maintainer="osint-graph-team"
LABEL description="OSINT Relationship Graph FastAPI backend"

# Non-root user for security.
RUN useradd -m -u 1001 appuser

WORKDIR /app

# Copy installed packages from the builder stage.
COPY --from=builder /install /usr/local

# Copy application source and static data.
COPY app/ ./app/
COPY data/ ./data/

# Download the spaCy model at build time so the container is self-contained.
# If the model download fails (e.g. no internet during build) the container
# will still start; entity extraction falls back to regex-only mode.
RUN python -m spacy download en_core_web_sm || true

# Ownership to non-root user.
RUN chown -R appuser:appuser /app
USER appuser

# ── Runtime environment ───────────────────────────────────────────────────────
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Expose the Uvicorn port.
EXPOSE 8000

# ── Health check ──────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" \
    || exit 1

# ── Entry point ───────────────────────────────────────────────────────────────
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--log-level", "info"]
