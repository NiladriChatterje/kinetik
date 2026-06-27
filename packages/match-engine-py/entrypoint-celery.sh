#!/bin/bash
# ─── Celery worker entrypoint ────────────────────────────────────
# Starts the Celery worker that processes match-queue jobs.
# Run separately from the FastAPI server (scales independently).
#
# Usage:
#   ./entrypoint-celery.sh                         # defaults
#   CELERY_CONCURRENCY=4 ./entrypoint-celery.sh     # custom concurrency

set -e

CONCURRENCY="${CELERY_CONCURRENCY:-2}"
QUEUES="${CELERY_QUEUES:-default}"
LOG_LEVEL="${CELERY_LOG_LEVEL:-info}"

echo "Starting Celery worker (concurrency=$CONCURRENCY, queues=$QUEUES)..."

cd "$(dirname "$0")"

exec celery -A src.workers.match_worker.celery_app worker \
    --loglevel="$LOG_LEVEL" \
    --concurrency="$CONCURRENCY" \
    --queues="$QUEUES" \
    --hostname=kinetik-worker@%h \
    --max-tasks-per-child=100 \
    --time-limit=600
