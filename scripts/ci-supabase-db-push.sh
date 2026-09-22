#!/usr/bin/env bash
# Apply pending Supabase migrations to the hosted project (merge-to-main CI).
#
# Preferred (fewest secrets): SUPABASE_DB_PASSWORD only.
# Optional overrides: SUPABASE_PROJECT_REF, SUPABASE_POOLER_HOST,
# SUPABASE_DB_URL / DATABASE_URL, SUPABASE_ACCESS_TOKEN (link path).
#
# IMPORTANT: GitHub Actions / most CI runners are IPv4-only.
# db.<ref>.supabase.co is IPv6-only and will fail with "network is unreachable".
# Use the Session-mode Supavisor pooler (IPv4) instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Public project ref for this repo's hosted Supabase (also in docs/).
PROJECT_REF="${SUPABASE_PROJECT_REF:-ddfboapzwclecbdjoqex}"
# Session pooler host that serves this project (verified: aws-1-eu-west-2, not aws-0).
POOLER_HOST="${SUPABASE_POOLER_HOST:-aws-1-eu-west-2.pooler.supabase.com}"

DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"
if [[ -z "$DB_URL" && -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  # Session-mode pooler (port 5432). Password must be URL-encoded if special chars.
  enc_pass=$(
    python3 -c 'import os,urllib.parse; print(urllib.parse.quote(os.environ["SUPABASE_DB_PASSWORD"], safe=""))'
  )
  DB_URL="postgresql://postgres.${PROJECT_REF}:${enc_pass}@${POOLER_HOST}:5432/postgres"
fi

if [[ -z "$DB_URL" && -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "::error::Missing credentials for hosted migration apply."
  echo "Set repo Actions secret SUPABASE_DB_PASSWORD (Database settings → Database password)"
  echo "OR set SUPABASE_DB_URL / DATABASE_URL to a Postgres connection string,"
  echo "OR set SUPABASE_ACCESS_TOKEN + SUPABASE_DB_PASSWORD for supabase link."
  echo "Optional: SUPABASE_PROJECT_REF (defaults to ${PROJECT_REF})."
  echo "Optional: SUPABASE_POOLER_HOST (defaults to ${POOLER_HOST})."
  exit 1
fi

npx --yes supabase@2.116.0 --version

push_with_db_url() {
  npx --yes supabase@2.116.0 db push --yes --db-url "$DB_URL"
}

if [[ -n "$DB_URL" ]]; then
  echo "Applying migrations via --db-url (project ${PROJECT_REF}, pooler ${POOLER_HOST:-from-url})"
  set +e
  push_out="$(push_with_db_url 2>&1)"
  push_ec=$?
  set -e
  printf '%s\n' "$push_out"
  if [[ $push_ec -ne 0 ]]; then
    # Ghost remote versions (applied/recorded on hosted, missing from git) block every
    # db push. Repair them as reverted, then retry once.
    mapfile -t orphan_versions < <(
      printf '%s\n' "$push_out" | grep -oE 'supabase migration repair --status reverted [0-9]+' \
        | awk '{print $NF}' | sort -u
    )
    if [[ ${#orphan_versions[@]} -eq 0 ]]; then
      echo "::error::supabase db push failed (no repairable orphan versions detected)."
      exit "$push_ec"
    fi
    echo "::warning::Repairing orphan remote migration version(s): ${orphan_versions[*]}"
    for ver in "${orphan_versions[@]}"; do
      npx --yes supabase@2.116.0 migration repair --status reverted "$ver" --yes --db-url "$DB_URL"
    done
    echo "Retrying db push after orphan repair…"
    push_with_db_url
  fi
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
