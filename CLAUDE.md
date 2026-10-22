# Claude Code Instructions for seoranko-com

## Git Workflow

**Use feature branches and pull requests. Do not commit directly to `main`.**

After every change:

1. Create or switch to a feature branch from `main`:
   ```
   git checkout main && git pull origin main
   git checkout -b <branch-name>
   ```
   Use a short, descriptive branch name (e.g. `fix/login-redirect`, `feat/keyword-export`).

2. Commit on that branch:
   ```
   git add .
   git commit -m 'message'
   git push -u origin <branch-name>
   ```

3. Open a pull request targeting `main`. Merge via the PR when the change is ready.

Never push commits straight to `main`. All work lands through a branch and PR so changes are reviewable and deploys stay predictable.

## Migrations — public table Data API grants

From **30 Oct 2026**, Supabase no longer auto-grants Data API privileges on
new tables in `public`. Every migration that creates a table in `public` must,
**in the same migration file**:

1. `ALTER TABLE … ENABLE ROW LEVEL SECURITY`
2. `GRANT SELECT, INSERT, UPDATE, DELETE` (or `ALL`) **to `service_role`**
3. **`authenticated`**: grant the same only if the app reads/writes with the
   user session — and add RLS policies. Otherwise `REVOKE` from authenticated.
4. **`anon`**: no grants unless the table is genuinely public (state why in a
   SQL comment).

Template: `supabase/migration-templates/new_public_table.sql`  
CI: `npm run check:migration-grants` (wired in `.github/workflows/test.yml`).  
Do **not** rewrite historical migrations to backfill grants on existing tables.

## Competitor & gap analysis

**Never copy competitor content or name third parties in user-facing UI.**

- Use SERP/citation data to find **gaps and angles** — then implement original content here.
- Do not paste competitor prose, structure, or branding into articles or UI.
- Anonymize domains in the product: show generic labels like "another site" or "an official source", not `gov.uk`, `zapmap.com`, etc.
- Internal analysis may use raw URLs; user-visible strings must go through `src/lib/competitor-privacy.ts`.
