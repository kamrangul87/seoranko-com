#!/usr/bin/env bash
# Apply pending Supabase migrations to the hosted project (merge-to-main CI).
# Required GitHub Actions secrets:
#   SUPABASE_ACCESS_TOKEN  — https://supabase.com/dashboard/account/tokens
#   SUPABASE_PROJECT_REF   — e.g. ddfboapzwclecbdjoqex
#   SUPABASE_DB_PASSWORD   — database password for the project
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

missing=()
[[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]] || missing+=(SUPABASE_ACCESS_TOKEN)
[[ -n "${SUPABASE_PROJECT_REF:-}" ]] || missing+=(SUPABASE_PROJECT_REF)
[[ -n "${SUPABASE_DB_PASSWORD:-}" ]] || missing+=(SUPABASE_DB_PASSWORD)

if ((${#missing[@]} > 0)); then
  echo "::error::Missing required secrets for hosted migration apply: ${missing[*]}"
  echo "Add them under GitHub → Settings → Secrets and variables → Actions,"
  echo "then re-run this workflow. Until then, migrations can still land in git"
  echo "without being applied — the failure mode this job exists to prevent."
  exit 1
fi

export SUPABASE_ACCESS_TOKEN

npx --yes supabase@2.116.0 link --project-ref "$SUPABASE_PROJECT_REF" -p "$SUPABASE_DB_PASSWORD"
echo "Linked project $SUPABASE_PROJECT_REF — migration list before push:"
npx --yes supabase@2.116.0 migration list || true

# Push only migrations not yet recorded in schema_migrations.
npx --yes supabase@2.116.0 db push --yes -p "$SUPABASE_DB_PASSWORD"

echo "Migration list after push:"
npx --yes supabase@2.116.0 migration list || true
echo "Hosted schema is now in sync with supabase/migrations."
