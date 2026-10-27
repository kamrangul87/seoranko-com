## SEORANKO — Technical indexability fixer (Next.js 14 + Supabase + Vercel)

SEORANKO finds technical indexing problems, opens a PR with deterministic code edits via the seoranko-fix GitHub App, verifies the preview, and proves the fix is live after merge. It does not claim rankings or traffic outcomes — it fixes concrete, testable defects.

### How it works (Fix Agent loop)
- Detects indexability defects from a crawl and stored findings
- Creates a short‑lived review branch, applies one deterministic transform per finding, and opens one PR
- Waits for the preview deployment and verifies each change against the preview URL
- Requires human approval (or passes auto‑merge gates), merges, then verifies the fix on production
- Records evidence that the fix is live

Phases in code: `create_branch → apply_next → ensure_pr → wait_preview → verify_preview_next → await_approval → merge → verify_production_next → recrawl`.

### Local development
- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase for Auth and data — see `AGENTS.md` for local Supabase caveats (migrations don’t apply to a fresh DB; start with an empty public schema as documented)
- Standard scripts:
  - `npm run dev` — dev server
  - `npm run build` / `npm run start` — production build / serve
  - `npm run lint` — ESLint
  - `npm test` — Vitest unit tests

### Environment variables (names only)
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- CRON_SECRET
- NEXT_PUBLIC_TURNSTILE_SITE_KEY (public; used by the Turnstile widget)
- Optional model and provider keys used by some routes: ANTHROPIC_API_KEY, PERPLEXITY_API_KEY, DATAFORSEO_EMAIL, DATAFORSEO_PASSWORD, SITE_CONNECTION_ENCRYPTION_KEY, etc.

Notes:
- Turnstile secret verification is handled server‑side by Supabase Auth Attack Protection (secret key is stored in Supabase, not in Vercel).
- On Vercel Hobby, cron schedules must be no more frequent than daily (see below).

### Crons and jobs
Vercel `vercel.json` defines once‑daily/weekly crons (Hobby‑safe):
- `/api/cron/fix-agent-e2e` — end‑to‑end fixture run monitor
- `/api/cron/fix-failure-digest` — summarize fix‑run failures
- `/api/cron/scheduled-recrawl` — weekly scheduled recrawl (Change Monitoring)
- `/api/cron/weekly-jobs` — weekly maintenance jobs
- `/api/cron/verify-liveness` — daily liveness and health
- `/api/cron/verify-publications` — daily publication verification
- `/api/cron/gsc-sync` — daily Google Search Console sync

All `/api/cron/*` routes require `Authorization: Bearer ${CRON_SECRET}`. Some jobs (e.g. scheduled recrawl, GSC sync) use `SUPABASE_SERVICE_ROLE_KEY` from server routes.

### Tests
- `npm test` runs fast, hermetic unit tests for the detection and fix pipeline
- Fixture e2e lives under `src/lib/fix-agent-e2e/*` and compares against `fixtures/seoranko-fixture-site/expected.json`

### Principles
- Deterministic transforms; no model‑generated code in PRs
- Preview and production verifies are required for every change
- No promises or claims about rankings — only concrete technical fixes that can be verified live

