# ─── Two-stage build ─────────────────────────────────────────────
# Stage 1: install system deps + Python packages
# Stage 2: slim runtime image

FROM python:3.11-slim AS builder

WORKDIR /app

# Install system build deps (needed for psycopg2, h3, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy only lockfile first for Docker layer caching
COPY requirements-lock.txt ./
ENV PATH=/root/.local/bin:$PATH
RUN pip install --no-cache-dir --user -r requirements-lock.txt

# ─── Runtime Stage ──────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Runtime system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy application source
COPY src/ ./src/
COPY entrypoint-celery.sh ./

# Expose health / metrics port
EXPOSE 3003

# ─── Default: run the FastAPI server ───────────────────────────
# (Celery worker uses a separate entrypoint)
CMD ["python", "-m", "src.main"]
