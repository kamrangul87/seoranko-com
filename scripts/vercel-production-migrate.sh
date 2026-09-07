#!/usr/bin/env bash
# Run hosted migrations during Vercel *production* builds (merge-to-main deploys).
#
# Why: GitHub Actions cannot always hold SUPABASE_DB_PASSWORD (App token lacks
# secrets:write). Vercel already stores Supabase env for the app — adding
# SUPABASE_DB_PASSWORD there makes every production deploy apply pending SQL.
#
# Preview / local builds skip this step so PRs stay unblocked.
# Production without credentials warns and continues (site deploy must not brick
# while the secret is being added); production *with* credentials runs db push
# and fails the build if push fails.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${VERCEL_ENV:-}" != "production" ]]; then
  echo "vercel-production-migrate: skip (VERCEL_ENV=${VERCEL_ENV:-unset})"
  exit 0
fi

if [[ -z "${SUPABASE_DB_PASSWORD:-}" && -z "${SUPABASE_DB_URL:-}" && -z "${DATABASE_URL:-}" ]]; then
  echo "::warning::Production deploy missing SUPABASE_DB_PASSWORD — skipping db push."
  echo "Add Vercel Production env SUPABASE_DB_PASSWORD (or SUPABASE_DB_URL) so"
  echo "merge-to-main deploys auto-apply supabase/migrations. See docs/MIGRATION_CI.md."
  exit 0
fi

chmod +x scripts/ci-supabase-db-push.sh
exec ./scripts/ci-supabase-db-push.sh
