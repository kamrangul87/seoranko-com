# SEORANKO — Product Model (Beta)

**Verified against:** `origin/main` (2026-09-09 beta reliability gate), hosted
Supabase migrate CI, and code inspection — not session summaries alone.

---

## One-sentence product

Technical SEO maintenance for teams managing **GitHub-hosted** websites:
SEORANKO finds mechanically provable indexing and site-health problems, applies
**user-approved** deterministic fixes, verifies the **live** deployment, and
shows whether **Google has recrawled** the change.

---

## Primary customer

- Small agencies and in-house SEO/dev teams
- Managing multiple Next.js / static / GitHub / Vercel sites
- Able to connect **GitHub** (write) and **Google Search Console** (read)

---

## Core workflow (the only happy path we optimize)

1. Connect site (domain)
2. Connect GitHub write access
3. Connect Google Search Console
4. Run a **fresh** crawl
5. Show evidence-backed findings
6. User **approves** a deterministic fix
7. Apply the fix (write to repo / config)
8. Re-crawl the live URL
9. Mark **verified** only when live evidence matches
10. Show whether Google has crawled since verification
11. Monitor for regressions

---

## Status vocabulary (single status per finding)

| Status | Meaning |
|---|---|
| Auto-fixable | Mechanical fix exists; needs human approve |
| Human review required | Evidence exists; no safe auto write |
| Connection required | Fix needs a write connection we do not have |
| Implemented | Write succeeded; live verify not yet confirmed |
| Verified | Independent live re-crawl matches intended state |
| Awaiting Google recrawl | Verified locally; Google `lastCrawlTime` predates `verified_at` |
| Failed | Write or verify failed (with stored reason) |
| Invalid evidence | Stored crawl/snapshot unusable — run fresh audit |

**Never** use “verified” for “committed” or “queued”.

---

## Primary metric

> **Active sites receiving at least one useful verified finding, verified fix,
> or confirmed regression per month.**

Supporting metrics (instrument; do not invent numbers):

- Time to first crawl
- Time to first useful finding
- Time to verified fix
- Fix failure rate
- False-verification rate
- Recurring issue rate
- Sites awaiting Google recrawl

---

## What is in beta scope

| Area | Role in beta |
|---|---|
| Sites + GitHub connect | Required |
| GSC OAuth + Index Insights | Required (Google’s recorded view) |
| Audit / Index Diagnosis + Link Graph | Required (evidence) |
| Fix Agent (existing GitHub strategies only) | Required |
| Intervention lifecycle (implemented → verified) | Required |
| History / digests if already present | Nice-to-have |

## What is deferred / hidden (not deleted)

| Area | Label |
|---|---|
| WordPress / Shopify / Webflow connectors | Experimental — not credential-proven |
| Universal Tag as primary write path | Experimental / limited (no headers, no new URLs) |
| Article write / images / AI content tools | Deferred from beta journey |
| Causal “lift” claims on invalid/insufficient data | Honesty only — no success marketing |
| Ranking guarantees / “why Google won’t rank” | Forbidden |

---

## Engineering non-negotiables (summary)

- Deterministic diagnosis and verification; store evidence for every status
- No LLM judgment for audit, fix, verification, or causal validity
- Human approval before live writes; volume throttles
- RLS on new tables; no silent country/brand/locale defaults
- No sub-daily Vercel cron; model calls via `model-router` only when needed

See `docs/VERIFICATION_MATRIX.md` before calling any feature “working.”
See `docs/DELIVERY_ROADMAP.md` for sequenced reliability work.
