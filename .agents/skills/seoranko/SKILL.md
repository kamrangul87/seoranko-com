---
name: seoranko
description: >-
  Standing workflow and product rules for the seoranko-com repo and customer
  fix-flow. Use for any SEORANKO engineering, crawl/findings, fix-flow, or
  launch work.
---

# SEORANKO — agent skill

Canonical standing rules for Cursor / Claude work on this product. Prefer this
file plus `docs/fix-strategies/_implementation-rules.md` over stale session
summaries.

## Git & deploy (this product repo: `seoranko-com`)

- **Everything goes through a feature branch and a PR with CI gates.** Never
  push commits straight to `main`. Direct pushes skip the Vercel preview check;
  production has already failed silently behind green previews when that was
  skipped.
- **A green PR is not done.** A task is not done until the Vercel **Production**
  deployment for the merge commit on `main` reaches **Ready**. If Production
  fails (including migrate), stop and fix before starting new work.
- After a green PR on this repo: merge it (do not leave draft PRs green and
  open). Then confirm Production Ready.

## Customer repos (e.g. `autodun-ai`)

- The agent **never merges a customer PR** without **explicit per-PR owner
  approval** (named PR / finding — not a blanket “merge everything”).
- Product auto-merge is a separate, opt-in, gated path — see
  `_implementation-rules.md`. Standing “always merge” prefs apply only to
  `seoranko-com`.

## User-facing copy

Must **not** contain: `rank`, `ranking`, `traffic`, `visibility`, `penalty`,
or `Google will`. Enforced by `src/lib/fix-strategies/findings-ui/owner-copy.test.ts`
(and related owner-copy maps). Prefer structural, page-level plain English.

## Current product state (as of 2026-09-28)

Landed:

- P1 — Finding resolution lifecycle (`open` / `resolved` / `regressed`)
- P2 — Durable Postgres crawl-start quota
- P3 — Persistent-5xx reachability from live crawl data
- Crawl-run completion (`complete` / `partial` / `failed` + `finished_at`) and
  URL-scoped resolution on complete **and** partial

**Change Monitoring** — Stage 1 (§3.1 observation timeline) landing; Stages
2–4 (regression fields → scheduled recrawl → what-changed digest) not started.
See `docs/fix-strategies/CHANGE_MONITORING_STAGE_1.md`.

Outcome ledger (`docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md`) **shipped**.

### Autodun dogfood — honest accounting

The eleven autodun-ai production fixes were **real** (owner-approved PRs,
production tip Ready, live HTML/sitemap verified).

Autodun’s actionable **5 → 0** was **list drift across differently-scoped /
still-running crawls**, **not** finding resolution. Resolution could not fire
until crawl runs finalized. See `docs/SEORANKO_IMPLEMENTATION_RECORD.md`.

## Other standing rules

- Global by default — no silent UK/autodun fallbacks (`.cursorrules`).
- All model calls via `src/lib/model-router.ts`.
- Mechanical fixes over stronger prompts.
- No sub-daily Vercel crons (Hobby).
- Additive migrations by default; ask before DROP/destructive DDL.
- Verify against merged code + Production Ready, not session summaries.
