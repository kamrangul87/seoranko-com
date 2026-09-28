# SEORANKO — Delivery Roadmap (Beta Reliability Gate)

Sequenced work to make the **existing** repository a coherent GitHub+GSC beta.
No new Fix Agent strategies, CMS connectors, or content features.

**Branch policy (this repo):** direct-to-`main` unless explicitly requesting human
review. Do not leave draft PRs green and unmerged.

---

## Spec additions (2026-09-09)

1. **CI-gated regressions.** Every Phase 2D fixture must run in
   `.github/workflows/test.yml` (merge gate to `main`). Confirmed in
   `VERIFICATION_MATRIX.md` + enforced by `regression-fixtures-ci.contract.test.ts`.
2. **Phase effort bands** (below) — rough hours; calendar days assume one focused agent.
3. **Additive migrations only by default.** Prefer `CREATE … IF NOT EXISTS`, new
   columns nullable / with defaults, new tables with RLS. **Stop and ask** before
   any `DROP`, destructive `ALTER`, data rewrite, or truncate — production now holds
   verified interventions and GSC history.
4. **Phase 4 platform usage report** — GSC inspection quota vs soft cap, Supabase
   size/row inventory, Vercel function envelope (+ live minutes when `VERCEL_TOKEN`
   present). Script: `scripts/beta-platform-usage-probe.mjs` (migrate CI).
5. **First beta candidates from data** — `scripts/beta-candidates-probe.mjs`.
   Do not assume autodun.com is “the customer”; classify dogfood vs external.

---

## Rough effort per phase (before / as planning)

| Phase | Rough hours | Rough calendar (1 focused agent) | Notes |
|---|---|---|---|
| 1 Inventory docs | 2–4 h | &lt; 1 day | Done |
| 2A First GSC inspection row | 4–8 h eng + **manual token/Sync** | 1 day eng; Sync is the long pole | Data still blocked until Sync |
| 2B Fix Agent honesty + 2 live kinds | 6–12 h | 1–2 days | Honesty done; 2 live kinds pending |
| 2C Audit reliability | 4–8 h | 1 day | Largely done |
| 2D Regression fixtures + CI gate | 3–6 h | &lt; 1 day | Done + CI contract |
| 3 UX simplification | 4–8 h | 1 day | Done |
| 4 Beta readiness + usage + candidates | 4–8 h | 1 day | Usage/candidates probes; Phase 4 not “complete” until blockers clear |

**Serial total (engineering):** ~27–54 h ≈ **4–7 focused days**.  
**Not included:** waiting on valid GSC OAuth Sync, recruiting/consenting an external site, Vercel usage secret wiring.

---

## Phase 1 — Truthful inventory *(docs)*

| Deliverable | Status |
|---|---|
| `docs/PRODUCT_MODEL.md` | Done |
| `docs/DELIVERY_ROADMAP.md` | This file |
| `docs/VERIFICATION_MATRIX.md` | Done — update evidence as probes land |

---

## Phase 2 — Reliability gate *(engineering)*

### A–C

See prior sections — honesty, audit restore, Link Graph freshness, contracts landed.
First `gsc_url_inspections` row and two additional verified GitHub kinds remain
**credential / manual**.

### D. Regression fixtures (CI-gated)

All ten bug classes must appear in Test workflow paths. Contract test fails the
merge gate if any path is removed.

---

## Phase 3 — Product UX simplification

Primary nav + finding status + onboarding checklist + Experimental CMS labels — Done.

---

## Phase 4 — Beta readiness

| Gate | Status |
|---|---|
| Human approval / volume throttle / failure details | Done |
| Platform usage vs GSC / Supabase / Vercel | Probe in migrate CI; Vercel live minutes need token |
| First-beta candidate recommendation | Probe in migrate CI — update matrix from output |
| Additive migration policy | Documented — ask before destructive DDL |

**Phase 4 is not complete until:** usage probe reviewed, candidate recommendation
recorded from live inventory (not assumed), and core workflow blockers (GSC row +
extra verified kinds) are either done or explicitly accepted as dogfood-only.

**Exit criterion:** a new user can complete the core workflow on one GitHub-hosted
site with stored mechanical evidence end-to-end. Next step is **external customer
validation**, not another engineering feature phase.

---

## Phase 5 — Agentic Fix Run *(BLOCKED)*

Directive on file: `docs/PHASE5_AGENTIC_FIX_RUN.md`.

**Do not start 5A–5H** until Phase **2A** (first live GSC inspection + quota RPC
exercise) and **2B** (two additional verified GitHub strategies) are closed with
production evidence in `VERIFICATION_MATRIX.md`.

Public Index Diagnosis / `public_scans` is on **feature hold** (justified + deny
policies only — no further funnel work).

---

## Explicit non-goals (post-gate)

- WordPress / Shopify / Webflow expansion
- New content generation / image features
- New audit categories or Fix Agent strategies
- Ranking / causal lift claims on invalid data
