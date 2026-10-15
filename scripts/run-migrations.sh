#!/bin/sh
# ─── Kinetik Database Migration Runner ───────────────────────
# Applies pending migration files (*.sql) from scripts/migrations/
# in sorted order, using a _migrations tracking table for safety.
#
# Written in POSIX sh (no bash dependency) so it runs on Alpine's
# default /bin/sh without installing extra packages.
#
# Environment variables (all optional — defaults shown):
#   DB_HOST=postgres   DB_PORT=5432   DB_USER=kinetik
#   DB_PASSWORD=kinetik_dev_2024       DB_NAME=kinetik
#   MIGRATIONS_DIR=./scripts/migrations
#
# Usage:
#   ./scripts/run-migrations.sh
#   DB_HOST=localhost DB_PASSWORD=secret ./scripts/run-migrations.sh
# ─────────────────────────────────────────────────────────────

set -eu

# ── Connection ──────────────────────────────────────────────
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-kinetik}"
DB_PASSWORD="${DB_PASSWORD:-kinetik_dev_2024}"
DB_NAME="${DB_NAME:-kinetik}"

export PGHOST="$DB_HOST"
export PGPORT="$DB_PORT"
export PGUSER="$DB_USER"
export PGPASSWORD="$DB_PASSWORD"
export PGDATABASE="$DB_NAME"

# Resolve migrations directory (default: sibling `migrations/` dir)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$SCRIPT_DIR/migrations}"

echo "═══════════════════════════════════════════════════════"
echo "  Kinetik — Migration Runner"
echo "═══════════════════════════════════════════════════════"
echo "  Host:      $DB_HOST:$DB_PORT"
echo "  Database:  $DB_NAME"
echo "  User:      $DB_USER"
echo "  Migrations: $MIGRATIONS_DIR"
echo ""

# ── Wait for PostgreSQL ────────────────────────────────────
echo "  Waiting for PostgreSQL..."
i=0
while [ $i -lt 30 ]; do
  i=$((i + 1))
  if pg_isready -q 2>/dev/null; then
    echo "  PostgreSQL is ready (attempt $i)"
    echo ""
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  [ERROR] PostgreSQL did not become ready in time."
    exit 1
  fi
  sleep 2
done

# ── Ensure tracking table ──────────────────────────────────
psql -1 -q -c "
  CREATE TABLE IF NOT EXISTS _migrations (
    id          SERIAL PRIMARY KEY,
    filename    VARCHAR(255) NOT NULL UNIQUE,
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    checksum    VARCHAR(64)  NOT NULL
  );
"

echo "  Tracking table ready."
echo ""

# ── First-run baseline ─────────────────────────────────────
# init-db.sql holds the CURRENT full schema, not the original one — some
# migrations have been folded back into it over time. So on the very first
# run against a database (nothing recorded in _migrations yet) we:
#
#   1. create the schema from init-db.sql, unless it is already there —
#      the local postgres container builds it via docker-entrypoint-initdb.d,
#      a hosted database starts empty and needs it applied here;
#   2. record the migrations listed in BASELINE_APPLIED as done WITHOUT
#      running them, because init-db.sql already contains their changes and
#      replaying them would error out (a column that already exists, a
#      rename whose source column was never created).
#
# Every other migration still runs normally. They all use IF NOT EXISTS /
# IF EXISTS, so they are harmless no-ops wherever init-db.sql already
# covers them, and they do the real work where it does not.
#
# If you ever fold a new migration back into init-db.sql, add its filename
# to BASELINE_APPLIED. Forgetting is safe in the recoverable direction: the
# migration simply runs instead of being skipped.
BASELINE_FILE="${BASELINE_FILE:-$SCRIPT_DIR/init-db.sql}"
BASELINE_APPLIED="015_add_razorpay_subscription_id.sql
016_rename_razorpay_columns_to_gateway.sql
017_add_country_code.sql
019_rename_liveness_to_face_verification.sql"

recorded=$(psql -t -A -c "SELECT COUNT(*) FROM _migrations;")
if [ "$recorded" = "0" ]; then
  if [ "$(psql -t -A -c "SELECT to_regclass('public.users') IS NULL;")" = "t" ]; then
    if [ ! -f "$BASELINE_FILE" ]; then
      echo "  [ERROR] Database is empty but the baseline schema is missing:"
      echo "          $BASELINE_FILE"
      exit 1
    fi
    echo "  Empty database — creating the schema from $BASELINE_FILE"
    psql -1 -q -f "$BASELINE_FILE"
    echo "  Schema created."
  else
    echo "  Schema already present — recording the baseline only."
  fi

  for filename in $BASELINE_APPLIED; do
    [ -f "$MIGRATIONS_DIR/$filename" ] || continue
    checksum=$(sha256sum "$MIGRATIONS_DIR/$filename" 2>/dev/null | cut -d' ' -f1 || echo "unknown")
    psql -1 -q -c "INSERT INTO _migrations (filename, checksum)
                   VALUES ('$filename', '$checksum')
                   ON CONFLICT (filename) DO NOTHING;"
    echo "  ⏭  [BASE]  $filename — already contained in init-db.sql"
  done
  echo ""
fi

# ── Apply pending migrations ───────────────────────────────
count_applied=0
count_skipped=0

# Use glob — POSIX sh expands *.sql sorted alphabetically
for migration in "$MIGRATIONS_DIR"/*.sql; do
  [ -f "$migration" ] || continue

  filename=$(basename "$migration")

  # Check if already applied (fail loudly if query fails)
  already=$(psql -t -A -c "SELECT COUNT(*) FROM _migrations WHERE filename = '$filename';")
  if [ "$already" = "1" ]; then
    echo "  ⏭  [SKIP]  $filename"
    count_skipped=$((count_skipped + 1))
    continue
  fi

  echo "  ▶  [APPLY] $filename ..."

  # Compute checksum for integrity verification
  checksum=$(sha256sum "$migration" 2>/dev/null | cut -d' ' -f1 || echo "unknown")

  # Run the migration inside a single transaction
  if psql -1 -q -f "$migration"; then
    psql -1 -q -c "INSERT INTO _migrations (filename, checksum) VALUES ('$filename', '$checksum');"
    echo "  ✅  [DONE]  $filename"
    count_applied=$((count_applied + 1))
  else
    echo "  ❌  [FAIL]  $filename — migration returned an error!"
    exit 1
  fi
done

# Check if any migration files exist at all
if [ "$count_applied" -eq 0 ] && [ "$count_skipped" -eq 0 ]; then
  echo "  (no migration files found in $MIGRATIONS_DIR)"
fi

# ── Summary ────────────────────────────────────────────────
echo ""
echo "───────────────────────────────────────────────────────"
echo "  Applied:  $count_applied"
echo "  Skipped:  $count_skipped"
echo "───────────────────────────────────────────────────────"
echo "  Migration run complete."
echo ""
