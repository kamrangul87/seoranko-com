# Hosted migration CI

## Problem this solves

Migration SQL files were repeatedly merged to `main` without being applied on
hosted Supabase (`ddfboapzwclecbdjoqex`). That caused silent empty UI after
reload for Index Diagnosis, Link Graph Audit, Fix Agent attempts, etc.

## Automatic apply

On **every** push to `main`, GitHub Actions runs
`.github/workflows/supabase-migrate.yml` → `scripts/ci-supabase-db-push.sh`
→ `supabase db push` (idempotent when schema is already current).

Manual re-run: Actions → **Supabase migrations** → Run workflow.

## Required GitHub Actions secrets

**Minimum (recommended):**

| Secret | Where to get it |
|--------|-----------------|
| `SUPABASE_DB_PASSWORD` | Project settings → Database → Database password |

The script defaults `SUPABASE_PROJECT_REF` to `ddfboapzwclecbdjoqex` and builds
`postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres`.

**Optional alternatives:**

| Secret | Purpose |
|--------|---------|
| `SUPABASE_DB_URL` / `DATABASE_URL` | Full Postgres URL (skips password+ref construction) |
| `SUPABASE_PROJECT_REF` | Override default project ref |
| `SUPABASE_ACCESS_TOKEN` | Use `supabase link` instead of `--db-url` |

Until `SUPABASE_DB_PASSWORD` (or a DB URL) exists, the workflow **fails loudly**
so unapplied migrations cannot look “green”.

## One-time history bootstrap

If SQL was applied earlier via the dashboard and is **not** recorded in
`supabase_migrations.schema_migrations`, `db push` may try to re-run those
files and fail. Mark them applied without re-running:

```bash
export SUPABASE_ACCESS_TOKEN=…
npx supabase link --project-ref ddfboapzwclecbdjoqex
npx supabase migration list
# For each version that is already live but missing from remote history:
npx supabase migration repair --status applied <version>
```

After remote history matches reality, CI `db push` only applies **new** files.

## Local check before merge

```bash
npx supabase db push --dry-run   # when linked
```
