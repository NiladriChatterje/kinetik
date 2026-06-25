#!/bin/bash
# ─── Regenerate requirements-lock.txt from pyproject.toml ────────
# Run this script whenever you add/update dependencies in pyproject.toml.
# Keeps builds reproducible by pinning all transitive dependency versions.
#
# Prerequisites: pip install uv
#
# Usage:
#   ./scripts/update-lockfile.sh

set -e

cd "$(dirname "$0")/.."

echo "🔄 Compiling pinned dependencies for Python 3.11..."
uv pip compile pyproject.toml -o requirements-lock.txt --python-version=3.11
echo "✅ requirements-lock.txt updated!"
echo ""
echo "Next: rebuild the match-engine Docker images"
echo "  docker-compose build match-engine match-engine-worker"
