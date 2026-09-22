#!/usr/bin/env bash
# Fail if two supabase/migrations files share the same version timestamp.
# Duplicate timestamps brick production db push (see #113 / #119).
set -euo pipefail
ROOT="${MIG_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

if [[ ! -d supabase/migrations ]]; then
  echo "check-unique-migration-timestamps: no supabase/migrations directory"
  exit 0
fi

dupes=0
count=0
# filename -> first seen base name for that version
declare -A seen=()

while IFS= read -r -d '' f; do
  count=$((count + 1))
  base="$(basename "$f")"
  ver="${base%%_*}"
  if [[ ! "$ver" =~ ^[0-9]{14}$ ]]; then
    echo "::error::Migration filename must start with 14-digit timestamp: $base"
    dupes=1
    continue
  fi
  if [[ -n "${seen[$ver]:-}" ]]; then
    echo "::error::Duplicate migration version $ver:"
    echo "  - ${seen[$ver]}"
    echo "  - $base"
    dupes=1
  else
    seen[$ver]="$base"
  fi
done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' -print0 | sort -z)

if [[ $count -eq 0 ]]; then
  echo "check-unique-migration-timestamps: no migrations found"
  exit 0
fi

if [[ $dupes -ne 0 ]]; then
  echo "::error::Each supabase/migrations/*.sql must have a unique timestamp prefix."
  exit 1
fi

echo "check-unique-migration-timestamps: ok ($count files, all unique)"
