# Consolidation audit — fix-strategies register

Date: 2026-09-17  
Branch note: audit against `main` @ `3f2c88c` (post topics 2b/3/15/38/43/45).  
Live run artefact: `CONSOLIDATION_AUDIT_AUTODUN_RUN.json`

---

## 1. Helper discipline

The standing rules list **eight** named shared helpers. This audit also tracks
two closely related spines that topics are expected to reuse
(`canonical-extraction`, `fetch/evidence`), for ten total.

### Callers (topic folders + plumbing)

| # | Helper | Topics / modules that call it |
|---|---|---|
| 1 | `hop-recording-fetch` (`recordRedirectHops`, `normalizeHopUrl`) | `redirect-chain` (topics 4–7 via `walkRedirectChain`), `duplicate-url`, 13, 14, 26, 42; also `sitemap-inspect` |
| 2 | `url-normalize` | 14, 15, 26–28, 33, 36, 38, 42, 43, 48 + heavy use inside shared extractors |
| 3 | `canonical-normalize` | **none** (orphan — intended for GSC 55/58/59) |
| 4 | `robots-txt-matcher` / `robots-txt-inspect` | Direct matcher: only via inspect. Wrappers: 21, 22, 27, 36; `hreflang-inspect`, `sitemap-inspect` |
| 5 | `repo-declared-noindex` | 1, 2b, 19, 26, `redirect-chain`; 15 uses the type only (caller supplies discriminator) |
| 6 | `generated-output-guard` (`resolveFixTarget`) | ~28 topics with fix artefacts; **not** used by 1–3, 2b, 4–12 barrels, 15, 21, 38, 43, 45 |
| 7 | `html-parser` | Direct: 2b, 17, 21, 38, 39, 49. Most others go through head/canonical/hreflang/SD extractors |
| 8 | `response-signals` | 1, 13–15, 19, 26, 27, 30, 31, 42, `redirect-chain`, `duplicate-url` |
| 9 | `canonical-extraction` | 13–17, `duplicate-url` verify |
| 10 | `fetch/evidence` (`fetchWithEvidence`) | 1, 26, 42, `redirect-chain` |

### Reimplementations (report only — not refactored)

**Local URL comparison**
- `topic-14/detect.ts` — `sameHost` via `new URL().hostname`
- `topic-27/detect.ts` — `isSlashOrCaseMismatch` local slash/case compare
- `redirect-chain/classify-topic-5.ts` — trailing-slash bounce local compare
- `duplicate-url/detect.ts` + `verify-live.ts` — field-wise `new URL` / slash-strip
- `topic-46/detect.ts`, `topic-48/detect.ts` — `origin` equality
- `topic-36/detect.ts` — `new URL().href` absolutise (bypasses `normalizeFixStrategyUrl`)

**Local redirect / single-hop fetch**
- `duplicate-url/detect.ts` — `fetchManual` (`redirect: 'manual'`)
- `topic-14/detect.ts` — first-hop manual fetch before optional `recordRedirectHops`
- `topic-26/verify-live-sitemap.ts` — manual fetch for sitemap document

**Local HTML parse / regex**
- `topic-1/extract-anchors.ts` — regex `<a href>` (not `parseHtml`)
- `topic-1/successor-similarity.ts` — regex strip duplicates `content-sameness`
- `fetch/detector-guard.ts` — regex presence probes
- `topic-13/fix-add-canonical.ts`, `topic-17/fix-collapse-canonicals.ts`, `duplicate-url/fix-normalize.ts`, `topic-16/fix-remove-header-canonical.ts` — regex HTML/header edits

**Local noindex / robots allow**
- None found that bypass `hasNoindexDirective` / `isPathAllowedFromInspection`.

---

## 2. Dossier vs code drift

Shipped folders: **44** (`topic-1` … `topic-49` minus gaps; includes `topic-2b`).  
Every shipped folder maps to a dossier.

### Hard / partial mismatches

| Topic | Issue |
|---|---|
| **38** | Dossier `## verdict` says “Nothing here is auto-fixed”; fixture CI + code emit `auto-fix-entity-url-self`. **Dossier self-contradiction** — code follows the fixture. |
| **28** | Dossier allows low-value auto-add `Sitemap:`; code is informational-only (`PARTIAL`). |
| **43** | Dossier allows auto-fix (onclick→`<a>`); shipped detect-report has `autoFixable` flag but no fixer (`PARTIAL`). |
| **46** | Dossier `auto-fixable` when locales repo-sourced; code raises findings only — no rewriter (`PARTIAL`). |

### Soft (intent match, naming differs)

- **2b / 3 / 19 / 45** — dossier `not_mechanically_fixable`; code uses `observation-*` / `report-*` / `metric-*` / `record-*` (topic **24** is the rare case that emits an NMF-style literal).
- **20** — redundant meta/header is `informational-redundant`, not `auto-*`.
- **29** — severity-named verdicts + `autoFixable` bool instead of `auto-*` strings.
- **36** — dead required URL is `high-dead-required-url` (`autoFixable: false`), not `human-review-*`.
- **39** — FAQ D17 is `moderate` while headline says informational-only for deprecation.

### Match

Most of 1, 4–17, 21–22, 24–27, 30–37, 42, 47–49 align at the outcome-class level.

### Dossiers without `topic-*` folder

2a (covered via 1/14/19 paths), 18, 23, 32, 40 (dossier claims implemented — **no folder**), 41 (points at topic 1), 44, 50–70 plumbing/GSC/content.

---

## 3. Topic 69 (final URL)

**Verdict: already satisfied by existing helpers.**

Composition in code:
- `recordRedirectHops` / `walkRedirectChain` → `finalUrl` after manual redirect walk
- `normalizeFixStrategyUrl` / `normalizeHopUrl` → comparison / visited-set key (preserves slash, case, query)

Dossier updated from `NOT RESEARCHED` → **`SATISFIED BY EXISTING HELPERS`**.  
`_open-questions.md` marked CLOSED 2026-09-17.

Optional later: a named `resolveFinalUrl` facade (not required for correctness).

---

## 4. Output volume — autodun.com live run

**Sample:** 11 same-origin URLs from `sitemap.xml` (homepage + `/blog` + 9 articles).  
**Detectors covered:** 34 topic ids (1, 8–12, 14, 26, 42 not exercised — need inbound-anchor / variant / repo inputs).  
**Topic 20** skipped (caller arity bug in the audit harness only).

| Bucket | Count |
|---|---|
| Total rows emitted | **435** |
| Actionable-class findings (excl. suppress/ok/route) | **~86** |
| of which informational | **17** |
| of which defect/auto/human-review style | **~69** |
| Suppressed / routed / ok-as-suppress | **321** |

### By severity (all rows)

| Severity | Count |
|---|---|
| `(none)` | 349 |
| high | 40 |
| moderate | 27 |
| informational | 17 |
| low | 2 |

### Dominant actionable verdicts

| Verdict | n | Topic |
|---|---|---|
| `auto-fix-entity-url-self` | 33 | 38 |
| `human-review-no-height-auto` | 20 | 49 |
| `informational-recommended-absent` | 10 | 35 |
| `informational-deprecated-type` | 7 | 39 |
| `finding-wrong-ratio` | 7 | 49 |
| `auto-set-dimensions` | 3 | 49 |
| `d17-faq-markup-not-visible` | 2 | 39 |
| `low-lang-inlanguage-disagree` | 2 | 34 |
| `moderate-out-of-scope` (mot.autodun.com in sitemap) | 1 | 25 |
| `finding-orphan-in-sitemap-lower` | 1 | 43 |

**Usability judgment:** On an 11-page sample the register is **usable but noisy**. Two topics dominate volume: **38** (entity `url` ≠ page on repeated Article/Org markup) and **49** (image dimensions). Without per-topic caps or “same generator defect → one finding” rollup, a full-site crawl would overwhelm. Guards already remove ~¾ of raw candidates (see §5).

Also notable: homepage served HTML has crawlable edges (`clientOnly: false`, 68 edges / 16 nodes), but blog URLs looked **orphaned from the homepage** in the served graph (topic 45 routed 15× to topic 43) — consistent with a thin nav in static HTML.

---

## 5. Suppression rate

| | |
|---|---|
| Suppressed or routed rows | **321 / 435 (74%)** |
| Actionable-class rows | **~86 / 435 (20%)** |

### Guards that fired most

| Guard / suppress verdict | n |
|---|---|
| `suppress-unknown-type` (35/37 — unknown ≠ non-compliant) | **139** |
| `ok` (no-op / healthy paths folded into suppress bucket) | 93 |
| `suppress-article-recommended-only` | 19 |
| `suppress-listed-in-index-child` | 11 |
| `suppress-healthy-target` (15) | 11 |
| `suppress-supported-type` | 9 |
| `suppress-at-id-identifier` (36) | 8 |
| `route-topic-39-deprecated` | 7 |
| `suppress-live-external-profile` | 7 |
| `ok-no-redirect` / `ok-single-hop` | 6 |
| `suppress-dateModified-equals-datePublished` | 3 |

**Takeaway:** the unknown-type and Article-recommended guards are doing the heavy lifting. Without them, structured-data topics would drown the report.

---

## 6. Product decisions still `null`

From `src/lib/fix-strategies/product-decisions.ts`:

| Knob | Owning topics | Degradation while unset |
|---|---|---|
| `persistent5xxObservationWindowMs` | **3** (also gates language in 26) | Can record `stableAcrossRefetch`; **must not** emit `persistent-5xx` |
| `successorSimilarityFloor` | **1**, **41** | 301-vs-remove successor proposals stay human-review / cannot auto-pick successor by similarity |
| `clickDepthReportingThreshold` | **45** | Correct: no Google threshold. Metric-only reporting; no “too deep” product flag |
| `impressionsFloor` | **59** (unshipped) | GSC “impressions, no internal links” cannot raise |
| `urlInspectionPrioritisationPolicy` | **55–59** (unshipped) | No prioritisation under the 2k/day Inspection cap |
| `titleDisplayTruncationHintChars` | **30** | Long titles produce **nothing** (correct per H9) |
| `descriptionDisplayTruncationHintChars` | **31** | Long descriptions produce **nothing** (correct per H15) |

Set (not null): refetch trio (68), `imageIntrinsicRatioComparisonTolerance` (49), `trackingParameterAllowlist` (12a).

---

## Recommended follow-ups (not done in this audit)

1. Resolve dossier **38** verdict prose vs fixture/auto-fix.
2. Either implement or downgrade dossier auto claims for **28 / 43 / 46**.
3. Wire callers to `canonical-normalize` or delete/defer until GSC topics ship.
4. Collapse generator-level repeats (38 entity url, 49 images) before UI volume caps.
5. Replace local URL compares listed in §1 with `normalizeFixStrategyUrl` (mechanical cleanup PR).
6. Investigate autodun homepage→blog crawlable-link gap (real orphan vs client-rendered nav).
