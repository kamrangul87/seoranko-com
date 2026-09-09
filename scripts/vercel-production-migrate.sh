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
./scripts/ci-supabase-db-push.sh

# Sweep leftover seoranko-fix-* review branches on connected GitHub client
# repos (legacy PR-fallback). Best-effort — never fails the deploy.
if [[ -n "${SITE_CONNECTION_ENCRYPTION_KEY:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "vercel-production-migrate: cleaning stale client Fix Agent branches…"
  node scripts/cleanup-client-fix-branches.mjs || echo "::warning::client branch cleanup skipped/failed (non-fatal)"
else
  echo "vercel-production-migrate: skip client branch cleanup (encryption key or service role missing)"
fi

# One-shot Intervention Dataset e2e when the table is still empty.
# Uses the same secrets already present on Vercel production (CI lacks them).
# Never fails the deploy. Skip once any intervention_events row exists.
if [[ -n "${SITE_CONNECTION_ENCRYPTION_KEY:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" && -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
  echo "vercel-production-migrate: checking whether intervention e2e is needed…"
  NEED_E2E="$(node --input-type=module -e "
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { count, error } = await sb.from('intervention_events').select('id', { count: 'exact', head: true })
if (error) { console.error(error.message); process.exit(0) }
process.stdout.write(String(count === 0 ? '1' : '0'))
" 2>/dev/null || echo 0)"
  if [[ "$NEED_E2E" == "1" ]]; then
    echo "vercel-production-migrate: intervention_events empty — running autodun Fix Agent e2e…"
    npx --yes tsx scripts/run-autodun-intervention-e2e.ts \
      || echo "::warning::autodun intervention e2e failed (non-fatal — inspect logs)"
  else
    echo "vercel-production-migrate: skip intervention e2e (intervention_events already has rows, or count failed)"
  fi
else
  echo "vercel-production-migrate: skip intervention e2e (missing Supabase/encryption secrets)"
fi
