# Hosted migration CI

## Problem this solves

Migration SQL files were repeatedly merged to `main` without being applied on
hosted Supabase (`ddfboapzwclecbdjoqex`). That caused silent empty UI after
reload for Index Diagnosis, Link Graph Audit, Fix Agent attempts, etc.

## Automatic apply (two paths)

### 1) GitHub Actions (every push to `main`)

`.github/workflows/supabase-migrate.yml` → `scripts/ci-supabase-db-push.sh`
→ `supabase db push` (idempotent when schema is already current).

Manual re-run: Actions → **Supabase migrations** → Run workflow.

Requires repo Actions secret `SUPABASE_DB_PASSWORD`.

### 2) Vercel production build (every merge-to-main deploy)

`package.json` `build` runs `scripts/vercel-production-migrate.sh` first.
On `VERCEL_ENV=production` it calls the same `ci-supabase-db-push.sh` when
credentials are present. If `SUPABASE_DB_PASSWORD` is missing, the build
**warns and continues** (so a missing secret cannot brick the site); once the
env is set, every production deploy applies pending SQL and **fails the build**
if `db push` errors. Preview/local builds skip migrate.

## Required secrets

**Minimum (recommended) — set in BOTH places:**

| Where | Secret | Purpose |
|--------|--------|---------|
| GitHub Actions | `SUPABASE_DB_PASSWORD` | `supabase-migrate.yml` on every `main` push |
| Vercel → Production | `SUPABASE_DB_PASSWORD` | production `build` migrate step |

Get the value from Supabase → Project settings → Database → Database password.

The script defaults:

- `SUPABASE_PROJECT_REF` → `ddfboapzwclecbdjoqex`
- `SUPABASE_POOLER_HOST` → `aws-1-eu-west-2.pooler.supabase.com`

and builds a **Session-mode (port 5432) IPv4 pooler** URL:

`postgresql://postgres.<ref>:<password>@aws-1-eu-west-2.pooler.supabase.com:5432/postgres`

Do **not** use `db.<ref>.supabase.co` in CI — that host is IPv6-only and
GitHub-hosted runners cannot reach it (`network is unreachable`).

**Optional alternatives:**

| Secret | Purpose |
|--------|---------|
| `SUPABASE_DB_URL` / `DATABASE_URL` | Full Postgres URL (skips password+ref construction) |
| `SUPABASE_PROJECT_REF` | Override default project ref |
| `SUPABASE_POOLER_HOST` | Override pooler host if Supabase moves the tenant |
| `SUPABASE_ACCESS_TOKEN` | Use `supabase link` instead of `--db-url` |

Until `SUPABASE_DB_PASSWORD` (or a DB URL) exists, the workflow **fails loudly**
so unapplied migrations cannot look “green”.

## One-time history bootstrap

If SQL was applied earlier via the dashboard and is **not** recorded in
`supabase_migrations.schema_migrations`, `db push` may try to re-run those
files and fail. Mark them applied without re-running:

```bash
export SUPABASE_ACCESS_TOKEN=…
export SUPABASE_DB_PASSWORD=…
# Use the same IPv4 session pooler URL as CI
npx supabase migration list --db-url "$DB_URL"
# For each version that is already live but missing from remote history:
npx supabase migration repair --status applied <version> --db-url "$DB_URL"
# For dashboard-only remote versions with no local file:
npx supabase migration repair --status reverted <version> --db-url "$DB_URL"
```

`scripts/ci-supabase-db-push.sh` also auto-repairs orphan remote versions when
`db push` prints `migration repair --status reverted <version>`, then retries
once — so a single ghost row cannot brick every production deploy. Prefer
committing a matching no-op file under `supabase/migrations/` when the orphan
should stay in history.
After remote history matches the repo’s `supabase/migrations/` files, CI
`db push` only applies **new** files.

## Local check before merge

```bash
npx supabase db push --dry-run --db-url "$DB_URL"
```
