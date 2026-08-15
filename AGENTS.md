# AGENTS.md

## Cursor Cloud specific instructions

### What this is
Seoranko — a Next.js 14 (App Router) + TypeScript + Tailwind SEO platform. Auth and data
are backed by Supabase; the content pipeline calls Claude (Anthropic) and DataForSEO.
Deployed on Vercel. Product context lives in `docs/SEORANKO.md`.

### Standard commands (defined in `package.json`)
- `npm run dev` — Next.js dev server on http://localhost:3000
- `npm run build` / `npm run start` — production build / serve
- `npm run lint` — ESLint via `next lint`
- `npm test` — Vitest unit tests

`npm run lint` and `npm test` need no external services or secrets — the tests cover pure
`src/lib` content-processing logic. The npm dependencies are refreshed automatically by the
startup update script (`npm install`).

### Running the app locally (Supabase auth/DB backend)
The app requires Supabase env vars or the client throws at import time
(`src/lib/supabase-client.ts` builds the browser client at module load). For local dev,
run the Supabase stack in Docker. Docker and the Supabase CLI are already installed in the
VM snapshot, but neither the Docker daemon nor Supabase auto-start on a fresh session:

1. Start the Docker daemon and open its socket (it is not running on boot):
   - `sudo dockerd > /tmp/dockerd.log 2>&1 &`
   - `sudo chmod 666 /var/run/docker.sock`
   `/etc/docker/daemon.json` is preconfigured with the `fuse-overlayfs` storage driver and
   `containerd-snapshotter` disabled — both are required for Docker to work in this VM.
2. `supabase start` — see the migration caveat below first. Read `API_URL` and `ANON_KEY`
   from the output (or `supabase status`) into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL`
   and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `.env.local` is gitignored.
3. `npm run dev`.

Local Supabase endpoints: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`,
Postgres on port `54322`.

### Non-obvious caveats
- **Migrations do not apply to a fresh local DB.** The earliest migration
  (`supabase/migrations/20260708000000_phase1_aeo_fields.sql`) runs `ALTER TABLE articles`,
  but no migration in the repo creates the base `articles`/`pages`/`user_profiles` tables —
  that base schema was created in the hosted Supabase project outside version control. So
  `supabase start` / `supabase db reset` fail partway and the stack never comes up. To get
  a working local auth backend, temporarily move the migrations aside so Supabase starts
  with an empty public schema (auth/GoTrue still works fully), then restore them:
  `mv supabase/migrations /tmp/mig && supabase start && mv /tmp/mig supabase/migrations`.
  The dashboard degrades gracefully to its onboarding empty-state when data tables are
  absent (it reads `data || []`), so account creation + reaching `/dashboard` work without
  the app-domain tables.
- **Signup logs the user straight in.** Email confirmations are disabled in
  `supabase/config.toml` (`[auth.email] enable_confirmations = false`), matching the deploy
  note in `src/app/signup/page.tsx`. New signups get a session immediately and are
  redirected to `/dashboard`.
- **The full content pipeline needs real secrets.** Keyword research, article Write/QA, and
  image generation require `ANTHROPIC_API_KEY`, `DATAFORSEO_EMAIL`/`DATAFORSEO_PASSWORD`,
  and optionally `PERPLEXITY_API_KEY` plus image-provider keys (see `.env.local.example`).
  Without them, account creation and the dashboard shell work, but those stations error.
