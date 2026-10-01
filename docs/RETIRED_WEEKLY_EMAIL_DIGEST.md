# Retired: weekly email digest cron

**Removed:** `/api/cron/send-digests` (and its `vercel.json` schedule `0 9 * * 1`).

## What it was

A Monday cron that queried `profiles` / `digest_enabled` and emailed a
pre-pivot “weekly digest” (rank score, articles cited by AI) via Resend
(`digest@seoranko.com`).

## Why it was retired

It never successfully sent mail in production. The recipient query targeted
a `profiles` table / `digest_enabled` column that is not present in the live
schema. On a missing relation, supabase-js returns `{ data: null, error }`;
older code treated empty `data` as success and reported `{ sent: 0 }`. The
copy also predates the SEO Copilot pivot.

## What replaces it

Change Monitoring’s **what-changed digest** (in-product, after a terminal
crawl) — see `docs/fix-strategies/CHANGE_MONITORING_STAGE_4.md`. That is not
an email cron.

## Kept on purpose

- **Resend** (`RESEND_API_KEY`) — still used for auth email (Supabase SMTP);
  see `docs/AUTH_EMAIL.md`.
- `src/lib/digest-email.ts` — unused HTML builder left in tree for reference;
  not wired to any route.
