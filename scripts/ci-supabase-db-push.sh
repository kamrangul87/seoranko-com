#!/usr/bin/env bash
# Apply pending Supabase migrations to the hosted project (merge-to-main CI).
#
# Preferred (fewest secrets): SUPABASE_DB_PASSWORD only.
# Optional overrides: SUPABASE_PROJECT_REF, SUPABASE_DB_URL / DATABASE_URL,
# SUPABASE_ACCESS_TOKEN (only if using `supabase link` instead of --db-url).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Public project ref for this repo's hosted Supabase (also in docs/).
PROJECT_REF="${SUPABASE_PROJECT_REF:-ddfboapzwclecbdjoqex}"

DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"
if [[ -z "$DB_URL" && -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  # Direct Postgres connection (Supabase hosted). Password must be URL-encoded if special chars.
  enc_pass=$(
    python3 -c 'import os,urllib.parse; print(urllib.parse.quote(os.environ["SUPABASE_DB_PASSWORD"], safe=""))'
  )
  DB_URL="postgresql://postgres:${enc_pass}@db.${PROJECT_REF}.supabase.co:5432/postgres"
fi

if [[ -z "$DB_URL" && -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "::error::Missing credentials for hosted migration apply."
  echo "Set repo Actions secret SUPABASE_DB_PASSWORD (Database settings → Database password)"
  echo "OR set SUPABASE_DB_URL / DATABASE_URL to a Postgres connection string,"
  echo "OR set SUPABASE_ACCESS_TOKEN + SUPABASE_DB_PASSWORD for supabase link."
  echo "Optional: SUPABASE_PROJECT_REF (defaults to ${PROJECT_REF})."
  exit 1
fi

npx --yes supabase@2.116.0 --version

if [[ -n "$DB_URL" ]]; then
  echo "Applying migrations via --db-url (project ${PROJECT_REF})"
  npx --yes supabase@2.116.0 db push --yes --db-url "$DB_URL"
else
  export SUPABASE_ACCESS_TOKEN
  echo "Linking project ${PROJECT_REF} via access token…"
  npx --yes supabase@2.116.0 link --project-ref "$PROJECT_REF" -p "$SUPABASE_DB_PASSWORD"
  echo "Migration list before push:"
  npx --yes supabase@2.116.0 migration list || true
  npx --yes supabase@2.116.0 db push --yes -p "$SUPABASE_DB_PASSWORD"
  echo "Migration list after push:"
  npx --yes supabase@2.116.0 migration list || true
fi

echo "Hosted schema sync attempted for ${PROJECT_REF}."
