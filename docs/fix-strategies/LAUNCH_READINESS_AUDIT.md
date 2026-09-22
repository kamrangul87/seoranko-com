# SEORANKO — Launch Readiness Audit

**Date:** 2026-09-22  
**Scope:** Report only. Evidence: live crawl `FINDINGS_LIVE_CRAWL_AUTODUN_REPORT.md` (post topic-49 residual fixes), `FIX_VERIFY_OUTCOME_RECORD.md`, migrations, `vercel.json`, publisher adapters.

**Product frame:** SEO copilot (crawl → findings → approve → fix → live verify). Article Write / article-v2 / `/api/publish*` return **410**.

---

## a) Live / working — findings detect → fix → verify

| Capability | Status | Evidence |
|---|---|---|
| Live crawl + 43 detectors | **Working** | Wired 43/43. Autodun: frontier 12, crawled 11, **actionable: 0**, informational 17 |
| Topic 49 rollup | **Working** | Declaration site = page URL for hand-authored HTML ([#124](https://github.com/kamrangul87/seoranko-com/pull/124)); no cross-page collapse |
| Findings UI + APIs | **Working** | `/dashboard/findings`, crawl/list/detail/fix; auth via `getUser()` + `userId` scope |
| Fix-flow (approve → PR → preview verify → prod verify) | **Partial — proven for topic 49** | Closed loop on autodun (#34–#44) |
| Auto-merge gates | **Implemented, default OFF** | Requires opt-in + CI + preview verify + blast-radius |

---

## b) Gaps that block a first paying customer

1. **Fix surface too narrow** — In-product auto-commit is topic 49 `auto-set-dimensions` only.
2. **Two fix systems** — Findings fix-flow vs legacy Fix Agent; unclear hierarchy.
3. **GitHub-only proven write path** — Other CMS adapters unverified.
4. **GSC Index Insights thin** — Needs live inspection rows for “Google recrawled?” claims.
5. **Billing ≠ product** — No subscription gate on crawl / Fix Agent writes.
6. **Onboarding unproven off autodun** — Connect → crawl → fix not dry-run on an external site.
7. **Crawl envelope** — Hobby 60s / chunk 5; large sites stay `partial`; client-only skips content detectors.

---

## c) Content-safety / human-review / volume-throttle

| Control | Status |
|---|---|
| Human approve before findings fix write | **Yes** |
| Auto-merge opt-in + guards | **Yes** |
| Agent merge of customer PRs | **Forbidden** unless per-PR owner approval |
| Article Phase H / publish caps | Code present; publish endpoints **410** |
| Fix Agent / findings volume throttle | **Not implemented** |

---

## d) Auth, RLS, multi-tenant isolation

- Former “11 tables RLS disabled” — **resolved** in migration `20260831130000_enable_rls_eleven_tables.sql` (`.cursorrules` note is stale).
- Findings / crawl tables: RLS ON + owner SELECT.
- Residual risk: some caches use `authenticated SELECT USING (true)`.
- Service-role bypass: correctness depends on caller scoping.

---

## e) Publisher / live publish readiness

- Article auto-publish **removed** (410).
- **GitHub** adapter proven (autodun PRs). WordPress / Shopify / Webflow / Universal Tag: experimental only.
- Launch sell: GitHub (±Vercel) fix-push only.

---

## f) Ops — cron, Hobby, secrets

Crons are all ≤ daily (Hobby-safe): weekly-jobs, digests, verify-liveness, verify-publications, gsc-sync.  
Secrets for beta: Supabase, `CRON_SECRET`, `SITE_CONNECTION_ENCRYPTION_KEY`, Anthropic, DataForSEO, GSC OAuth, GitHub via site connection, Stripe if charging.

---

## g) Ordered build list (highest launch risk first)

1. Wire multi-topic fix-flow beyond topic 49.
2. Unify Fix Agent vs findings fix-flow (one customer write path).
3. Prove ≥2 additional GitHub fix kinds end-to-end.
4. GSC: first live inspection row + Sync/onboarding.
5. Billing/entitlement for Fix Agent + crawl volume.
6. External-site onboarding dry-run (non-autodun).
7. Per-site write rate limits + failure surfacing.
8. Tighten shared-cache RLS (`USING (true)` → owner/service-role).
9. CMS adapters only if launch segment needs non-GitHub.
10. Hobby capacity report before multi-tenant crawl load.
11. Client-only / JS-rendered crawl (topic 67) or honest HTML-first UI.
12. Cleanup orphaned article/publish surface (410 paths in nav/docs).

---

## Verdict

**Dogfood-ready for GitHub static sites (autodun-class): yes** — detect solid; topic 49 loop closed; actionable **0** on latest crawl.

**First paying multi-tenant launch: not yet** — narrow auto-fix coverage, dual fix stacks, ungated writes, thin GSC proof, GitHub-only verified fix path.
