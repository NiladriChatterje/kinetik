# ─── Two-stage build ─────────────────────────────────────────────
# Stage 1: install Python packages
# Stage 2: slim runtime image

FROM python:3.11-slim AS builder

WORKDIR /app

# Copy only lockfile first for Docker layer caching
COPY requirements-lock.txt ./
ENV PATH=/root/.local/bin:$PATH
RUN pip install --no-cache-dir --user -r requirements-lock.txt

# ─── Runtime Stage ──────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy application source
COPY src/ ./src/

# Expose port
EXPOSE 3004

# Default: run the FastAPI server
CMD ["python", "-m", "src.main"]
