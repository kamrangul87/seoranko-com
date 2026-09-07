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

| Secret | Where to get it |
|--------|-----------------|
| `SUPABASE_ACCESS_TOKEN` | [Account tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_REF` | Project settings → Reference ID (`ddfboapzwclecbdjoqex`) |
| `SUPABASE_DB_PASSWORD` | Project settings → Database → Database password |

Until these three secrets exist, the workflow **fails loudly** (by design) so
unapplied migrations cannot look “green”.

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
