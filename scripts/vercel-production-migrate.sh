#!/usr/bin/env bash
# Run hosted migrations during Vercel *production* builds (merge-to-main deploys).
#
# Why: GitHub Actions cannot always hold SUPABASE_DB_PASSWORD (App token lacks
# secrets:write). Vercel already stores Supabase env for the app — adding
# SUPABASE_DB_PASSWORD there makes every production deploy apply pending SQL.
#
# Preview / local builds skip this step so PRs stay unblocked.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${VERCEL_ENV:-}" != "production" ]]; then
  echo "vercel-production-migrate: skip (VERCEL_ENV=${VERCEL_ENV:-unset})"
  exit 0
fi

if [[ -z "${SUPABASE_DB_PASSWORD:-}" && -z "${SUPABASE_DB_URL:-}" && -z "${DATABASE_URL:-}" ]]; then
  echo "::error::Production deploy is missing migration credentials."
  echo "Add Vercel Production env SUPABASE_DB_PASSWORD (Supabase → Database password)"
  echo "or SUPABASE_DB_URL / DATABASE_URL. See docs/MIGRATION_CI.md."
  exit 1
fi

chmod +x scripts/ci-supabase-db-push.sh
exec ./scripts/ci-supabase-db-push.sh
