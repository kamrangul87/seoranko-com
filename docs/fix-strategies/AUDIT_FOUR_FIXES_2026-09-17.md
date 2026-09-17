# Audit four-fixes — 2026-09-17

Branch: `cursor/audit-four-fixes-922c`

## 1. Topic 38 — auto-fix removed

- Verdict `auto-fix-entity-url-self` → `human-review-entity-url-mismatch`
- `autoFixable: false`; `proposedEntityUrl: null`
- `values.left` = entity URL, `values.right` = page URL (both shown in detail)
- Dossier fixture section aligned (no longer claims auto-fix for entity url)

## 2. Generator-level rollup (register-wide)

- New: `shared/declaration-site.ts`, `shared/finding-rollup.ts`
- Group by `(topicId, declarationSite, verdict)` when site is shared layout /
  component / generator (topic 70 classification)
- Topics 38 + 49 accept `declarationSite` for the rollup step

### Autodun.com before → after (11-page sample)

Live artefact: `AUDIT_FOUR_FIXES_AUTODUN_ROLLUP.json`

| | Before | After |
|---|---|---|
| Topic 38 findings | 33 | **1** (rolled) |
| Topic 49 findings | 30 | **3** (one per verdict) |
| Full-register rows (approx) | **435** | **~376** (−59) |

## 3. Dossier/code mismatches 28 / 43 / 46

| Topic | Decision | Action |
|---|---|---|
| **28** | Agree — deterministic `Sitemap:` append | Shipped `fix-add-sitemap-record.ts` (`applyAddSitemapRecord`) |
| **46** | Agree — reciprocal when locales repo-sourced | Shipped `fix-add-reciprocal.ts` (HTML `<link>` path) |
| **43** | Agree — dossier narrowed | Only onclick→href is theoretically mechanical; rewriter not shipped. Related-link slot filling is editorial NMF. Code: `autoFixable: false` on onclick; dossier detect-and-report |

## 4. Product knobs set

| Knob | Value | Reasoning |
|---|---|---|
| `persistent5xxObservationWindowMs` | **48h** (`172_800_000`) | Inside Google's 2–3 day 503/429 crawl-rate *context* without treating it as our threshold; a topic-68 re-fetch pair (~1s) cannot mint `persistent-5xx` |
| `successorSimilarityFloor` | **0.55** | Already documented (`_sources.md` §57) and hard-coded in topic-1; now authoritative. Enables successor *proposal* filtering; 301 remains human-review (never auto) |

Left null: click-depth, impressions floor, URL Inspection policy, title/description truncation hints.

## 5. Other

- `canonical-normalize.ts` header notes it is for unshipped GSC topics 55–59
- Local URL-compare reimplementations tracked in `BACKLOG_LOCAL_URL_COMPARE.md` (not refactored)
