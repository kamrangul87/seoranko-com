# SEORANKO — Delivery Roadmap (Beta Reliability Gate)

Sequenced work to make the **existing** repository a coherent GitHub+GSC beta.
No new Fix Agent strategies, CMS connectors, or content features.

**Branch policy (this repo):** direct-to-`main` unless explicitly requesting human
review. Do not leave draft PRs green and unmerged.

---

## Phase 1 — Truthful inventory *(docs)*

| Deliverable | Status |
|---|---|
| `docs/PRODUCT_MODEL.md` | Done |
| `docs/DELIVERY_ROADMAP.md` | This file |
| `docs/VERIFICATION_MATRIX.md` | Done — update evidence as probes land |

---

## Phase 2 — Reliability gate *(engineering)*

### A. GSC Index Insights — first real inspection row

| Step | Status |
|---|---|
| Live OAuth + property containment + quota RPC | Infra proven |
| Probe script in migrate CI (`gsc-first-inspection-probe.mjs`) | Done |
| First `gsc_url_inspections` row from live API | **Blocked** — needs valid token + Sync |
| UI shows Our crawl / Google view / deltas | Code ready; data pending |

### B. Fix Agent verification honesty

| Step | Status |
|---|---|
| Remove rubber-stamp verified for llms-txt / security-headers | Done |
| Strategy contracts (before/after/assert/handoff) | Done (`fix-agent-strategy-contract.ts`) |
| Prove two additional GitHub strategies live | **Pending** — `fix-agent-verified-kinds-probe.mjs` |

### C. Audit reliability

| Step | Status |
|---|---|
| Fresh crawl when stored evidence invalid | Done (`385842c` + schema validate) |
| Link Graph Run uses fresh crawl | Done (UI forceFresh + no stale restore) |
| Schema-validate stored snapshots | Done (`isSchemaValidIndexDiagnosis`) |
| Fix Agent refuse missing crawl | Done (`NO_CRAWL_DATA`) |
| Cross-host findings name hostname | Done (prior) |

### D. Regression fixtures

All ten bug classes listed in VERIFICATION_MATRIX §Regression have Vitest coverage.

---

## Phase 3 — Product UX simplification

| Step | Status |
|---|---|
| Primary nav: Sites / Audit / Google status / History | Done (`DashboardNav`) |
| Findings/Fixes remain on Audit (single workflow surface) | Done |
| Single finding status vocabulary | Done (`finding-status.ts` + Audit labels) |
| Onboarding checklist | Done (`BetaOnboardingChecklist` + `/api/beta/onboarding-status`) |
| Experimental labels on WP/Shopify/Webflow/Universal Tag | Done (`ConnectSiteModal`) |

---

## Phase 4 — Beta readiness

| Gate | Status |
|---|---|
| Human approval before write (`confirm: true`) | Done |
| Per-site volume throttle (20/hour) | Done |
| Failure details on attempts | Done |
| Connection health / audit freshness | Partial — freshness done; health surfaces exist |
| Deployment verification | Done (live re-crawl for verified) |
| Google recrawl freshness | Code ready; needs inspections |
| RLS on new tables | Required going forward |
| Multi-site support | Done (exact-host matching) |
| Weekly digest evidence summary | Use existing digest if present — do not invent |
| No silent failures | Improved (fresh crawl, refuse empty, honest statuses) |

**Exit criterion:** a new user can complete the core workflow on one GitHub-hosted
site with stored mechanical evidence end-to-end. Next step is **external customer
validation**, not another engineering feature phase.

---

## Explicit non-goals (post-gate)

- WordPress / Shopify / Webflow expansion
- New content generation / image features
- New audit categories or Fix Agent strategies
- Ranking / causal lift claims on invalid data
