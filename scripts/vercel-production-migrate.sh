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

# Complete Intervention → causal loop when causal_results is still empty.
# Prefer service-role e2e (can run Fix Agent); fall back to Postgres-only
# complete-causal-loop (prereg + analyze) which only needs DB password.
complete_causal_via_pg() {
  echo "vercel-production-migrate: completing causal loop via Postgres…"
  npx --yes tsx scripts/complete-causal-loop.ts \
    || echo "::warning::complete-causal-loop failed (non-fatal — inspect logs)"
}

if [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" && -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
  echo "vercel-production-migrate: checking whether causal e2e is needed…"
  # Fail-open: run e2e when count is 0 OR when the check itself errors.
  NEED_E2E="$(
    node --input-type=module -e "
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { count, error } = await sb.from('causal_results').select('id', { count: 'exact', head: true })
if (error) {
  console.error('causal_results count error:', error.message)
  process.stdout.write('1')
  process.exit(0)
}
process.stdout.write(String(count === 0 ? '1' : '0'))
" || echo 1
  )"
  echo "vercel-production-migrate: NEED_E2E=${NEED_E2E}"
  if [[ "$NEED_E2E" == "1" ]]; then
    if [[ -n "${SITE_CONNECTION_ENCRYPTION_KEY:-}" ]]; then
      echo "vercel-production-migrate: causal_results empty — running autodun intervention/causal e2e…"
      npx --yes tsx scripts/run-autodun-intervention-e2e.ts \
        || echo "::warning::autodun intervention e2e failed (non-fatal — falling back to pg loop)"
    else
      echo "vercel-production-migrate: encryption key missing — skipping Fix Agent e2e"
    fi
    # Always ensure prereg+causal via pg if still empty (covers e2e skip/fail).
    complete_causal_via_pg
  else
    echo "vercel-production-migrate: skip intervention e2e (causal_results already has rows)"
  fi
elif [[ -n "${SUPABASE_DB_PASSWORD:-}" || -n "${SUPABASE_DB_URL:-}" || -n "${DATABASE_URL:-}" ]]; then
  echo "vercel-production-migrate: service-role URL missing — pg-only causal completion"
  complete_causal_via_pg
else
  echo "vercel-production-migrate: skip intervention e2e (missing Supabase secrets)"
fi
