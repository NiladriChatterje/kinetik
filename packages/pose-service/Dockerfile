# ─── Two-stage build ─────────────────────────────────────────────
# Stage 1: install Python packages
# Stage 2: slim runtime image

FROM python:3.11-slim AS builder

WORKDIR /app

# Copy only lockfile first for Docker layer caching
COPY requirements-lock.txt ./
ENV PATH=/root/.local/bin:$PATH
# mediapipe pins opencv-contrib-python (the GUI OpenCV build), which needs X11
# libs slim images don't have. Reinstall headless last so its cv2 build wins
# and the runtime image stays slim (no X11 libs required).
RUN pip install --no-cache-dir --user -r requirements-lock.txt \
    && pip install --no-cache-dir --user --force-reinstall --no-deps opencv-python-headless

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
