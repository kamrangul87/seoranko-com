# Fix → verify → outcome record

Ledger of findings that completed the full loop: detect → fix (PR) →
production verify → recrawl confirms absence.

Each entry is keyed to a finding identity `(origin, topic, verdict, page)`.
Detected date = first live crawl that raised it. Fixed date = PR merge to
the site’s production branch. Production verification = topic verify-live
against the live URL (not a preview). Recrawl = live findings crawl after
deploy.

`auto_merged: true` = product merged under site `auto_merge_enabled` gates.
`auto_merged: false` = human merged the customer PR, **or** the agent merged
only after **explicit per-PR owner approval** (see `_implementation-rules.md`).

---

## 1. Topic 49 · `auto-set-dimensions` · autodun MOT advisories

| Field | Value |
|-------|-------|
| Origin | `https://autodun.com` |
| Topic | 49 |
| Verdict | `auto-set-dimensions` |
| Page | `https://autodun.com/blog/mot-advisories-explained-uk.html` |
| Kind | `performance/img-missing-dimensions` |
| Detected | 2026-09-21T09:31:39.011Z (`FINDINGS_LIVE_CRAWL_AUTODUN_REPORT.md` prior run; actionable 5 including this row) |
| Fixed | 2026-09-22T06:41:58Z |
| PR | [kamrangul87/autodun-ai#34](https://github.com/kamrangul87/autodun-ai/pull/34) — merge `9ad64e0` |
| auto_merged | **false** |
| Fix detail | Set `width="1200" height="675"` on 3 content images from JPEG headers (`mot-advisory-suspension.jpg`, `mot-advisory-brakes.jpg`, `mot-advisory-shock-absorber.jpg`) |
| Production verify | **OK** — 2026-09-22T06:44Z |
| Verifier | `verifyFindingLive` + `verifyLiveImgDimensions` against production URL (not preview) |
| Attribute check | All 3 `<img>` tags carry `width="1200"` and `height="675"` |
| Ratio check | Declared ratio matches intrinsic JPEG headers (failures: none) |
| Recrawl | 2026-09-22 — `LIVE_CRAWL=1` autodun report |
| Actionable before | 5 (included `auto-set-dimensions` on this page) |
| Actionable after | **4** — `auto-set-dimensions` absent |
| Remaining actionable | `human-review-no-height-auto`, `finding-wrong-ratio`, topic 8 `human-review-preferred-conflict`, topic 25 `moderate-out-of-scope` |
| Outcome | **closed** — finding gone on recrawl; production postcondition holds |

Script used for production verify: `scripts/verify-prod-topic49.ts`.

---

## 2. Topic 49 · `human-review-no-height-auto` · charger map UK

| Field | Value |
|-------|-------|
| Origin | `https://autodun.com` |
| Topic | 49 |
| Verdict | `human-review-no-height-auto` |
| Page | `https://autodun.com/blog/electric-car-charger-map-uk.html` |
| Kind | `performance/img-missing-dimensions` |
| Detected | 2026-09-22T06:44:18.162Z (prior live crawl; actionable 4 including this rollup) |
| Fixed | 2026-09-22T07:55:54Z |
| PR | [kamrangul87/autodun-ai#35](https://github.com/kamrangul87/autodun-ai/pull/35) — merge `579b82a` |
| auto_merged | **false** |
| owner_approved | **true** — Kamran explicitly approved this specific PR/fix on 2026-09-22 (agent merge under `_implementation-rules.md` exception) |
| Fix detail | Pre-check: page-local `<style>` had bare `img { max-width:100% }` (no `height:auto`); no logo/icon `<img>`s. Replaced with **`article img { max-width:100%; height:auto; … }`**. Set width/height from file headers on 6 content images (1200×630 / 1200×527 / 1200×527 / 1200×1500 / 1200×799 / 1200×900). |
| Production verify | **OK** — 2026-09-22T08:00Z |
| Control | Other blog pages (e.g. `ulez-checker-uk.html`) still lack `article img { height:auto }` — no cross-page CSS bleed |
| Recrawl | 2026-09-22T08:00:43Z — `LIVE_CRAWL=1` |
| Actionable before | 4 |
| Outcome | **closed** — this rollup page no longer listed; residual `human-review-no-height-auto` remains on **other** URLs |

---

## 3. Topic 49 · `finding-wrong-ratio` · MOT changes 2026

| Field | Value |
|-------|-------|
| Origin | `https://autodun.com` |
| Topic | 49 |
| Verdict | `finding-wrong-ratio` |
| Page | `https://autodun.com/blog/mot-changes-2026-dvsa-updates.html` |
| Kind | `performance/img-wrong-aspect-ratio` |
| Detected | 2026-09-22T06:44:18.162Z |
| Fixed | 2026-09-22T07:59:05Z |
| PR | [kamrangul87/autodun-ai#36](https://github.com/kamrangul87/autodun-ai/pull/36) — merge `b679e9b` |
| auto_merged | **false** |
| owner_approved | **true** — Kamran explicitly approved this specific PR/fix on 2026-09-22 |
| Pre-check | `figure img` CSS has **no `object-fit`** — not a deliberate crop; proceeded |
| Fix detail | Corrected declared dimensions from JPEG headers: all 3 images **1024×1024** (were 780×520) |
| Production verify | **OK** — 2026-09-22T08:00Z — `width="1024" height="1024"` ×3 |
| Recrawl | 2026-09-22T08:00:43Z |
| Outcome | **closed** — this page absent from actionable; residual `finding-wrong-ratio` on **other** page (`mot-cost-uk-2026.html`) |

---

## 4. Topic 8 · `human-review-preferred-conflict` · /blog URL form

| Field | Value |
|-------|-------|
| Origin | `https://autodun.com` |
| Topic | 8 (related topic 26) |
| Verdict | `human-review-preferred-conflict` |
| Page | `https://autodun.com/blog` |
| Detected | 2026-09-22T06:44:18.162Z |
| Fixed | 2026-09-22T07:58:11Z |
| PR | [kamrangul87/autodun-ai#37](https://github.com/kamrangul87/autodun-ai/pull/37) — merge `830a10a` |
| auto_merged | **false** |
| owner_approved | **true** — Kamran explicitly approved this specific PR/fix on 2026-09-22 |
| Fix detail | Canonical (+ og:url) on `public/blog/index.html` → `https://autodun.com/blog`. Internal links `/blog/` and `/blog/index.html` → `/blog`. **No** `vercel.json` / redirects. |
| Production verify | **OK** — `/blog`, `/blog/`, `/blog/index.html` all carry canonical `https://autodun.com/blog` |
| Recrawl | 2026-09-22T08:00:43Z — topic 8 actionable preferred-conflict: **none** |
| Outcome | **closed** |

---

## 5. Topic 25 · `moderate-out-of-scope` · mot.autodun.com in sitemap

| Field | Value |
|-------|-------|
| Origin | `https://autodun.com` |
| Topic | 25 |
| Verdict | `moderate-out-of-scope` |
| Page | `https://mot.autodun.com/` (listed in autodun.com sitemap) |
| Detected | 2026-09-22T06:44:18.162Z |
| Fixed | 2026-09-22T07:58:13Z |
| PR | [kamrangul87/autodun-ai#38](https://github.com/kamrangul87/autodun-ai/pull/38) — merge `eafa461` |
| auto_merged | **false** |
| owner_approved | **true** — Kamran explicitly approved this specific PR/fix on 2026-09-22 |
| Pre-check | Sitemap is hand-maintained `public/sitemap.xml` (not generated). **mot.autodun.com already has its own sitemap** (`https://mot.autodun.com/sitemap.xml`, declared in its robots.txt) — not created in this task. |
| Fix detail | Removed `<loc>https://mot.autodun.com/</loc>` from autodun.com sitemap |
| Production verify | **OK** — entry absent; sitemap still valid XML (`12` `<url>` entries) |
| Recrawl | 2026-09-22T08:00:43Z — topic 25 actionable: **none** |
| Outcome | **closed** |

### Recrawl summary (after all four)

| Metric | Before | After |
|--------|--------|-------|
| Actionable | 4 | **2** |
| Production tip | — | `eafa461` (`dpl_7gAoGPg9Ni6xV3uvCBQEijD7on2a`) Ready |

Remaining actionable (not in this batch): topic 49 `human-review-no-height-auto` on other blog URLs; topic 49 `finding-wrong-ratio` on `/blog/mot-cost-uk-2026.html`.

---

## 6–11. Topic 49 residual pages (owner-approved same fix types)

Rollup bug (fake `generator:site-images`) was hiding these as one verdict-level
row. After seoranko [#124](https://github.com/kamrangul87/seoranko-com/pull/124)
(`ea537ac`), live crawl listed **6** per-page findings. Same two fix types as
§2–§3; Kamran authorized applying them to every remaining page (2026-09-22).

Autodun Production tip after this batch: **`0b5c0eb`**
(`dpl_DHYj3MaFQ4TvbV557xa2mCXPdqpB`) **Ready**.

### 6. `human-review-no-height-auto` · ev-charging-on-uk-motorways

| Field | Value |
|-------|-------|
| Page | `https://autodun.com/blog/ev-charging-on-uk-motorways.html` |
| PR | [autodun-ai#39](https://github.com/kamrangul87/autodun-ai/pull/39) — merge `0648616` |
| auto_merged | **false** |
| owner_approved | **true** — same fix type as #35; batch authorized 2026-09-22 |
| Pre-check | Bare `img { max-width:100% }`; no fixed-height img CSS; no logo imgs. Wrapped `.wrap` in `<article>` (page had none). |
| Fix | `article img { max-width:100%; height:auto; … }` + dims from headers (3 imgs: 1200×675 / 600×800 / 639×800) |
| Preview verify | **OK** (Vercel READY + `web_fetch_vercel_url` + dims vs headers) |
| Production verify | **OK** — `verifyLiveImgDimensions` |
| Outcome | **closed** |

### 7. `human-review-no-height-auto` · ev-charging-reliability-uk

| Field | Value |
|-------|-------|
| Page | `https://autodun.com/blog/ev-charging-reliability-uk.html` |
| PR | [autodun-ai#40](https://github.com/kamrangul87/autodun-ai/pull/40) — merge `2427bc4` |
| auto_merged | **false** |
| owner_approved | **true** — same as §6 |
| Fix | article scope + dims (2 imgs: 1200×675 / 518×800) |
| Production verify | **OK** |
| Outcome | **closed** |

### 8. `human-review-no-height-auto` · mot-history-check-uk

| Field | Value |
|-------|-------|
| Page | `https://autodun.com/blog/mot-history-check-uk.html` |
| PR | [autodun-ai#41](https://github.com/kamrangul87/autodun-ai/pull/41) — merge `64650e8` |
| auto_merged | **false** |
| owner_approved | **true** — same as §6 |
| Fix | article scope + dims (6 imgs from PNG/JPEG headers) |
| Production verify | **OK** |
| Outcome | **closed** |

### 9. `human-review-no-height-auto` · ulez-checker-uk

| Field | Value |
|-------|-------|
| Page | `https://autodun.com/blog/ulez-checker-uk.html` |
| PR | [autodun-ai#42](https://github.com/kamrangul87/autodun-ai/pull/42) — merge `d78cf51` |
| auto_merged | **false** |
| owner_approved | **true** — same as §6 |
| Fix | article scope + dims (4 imgs) |
| Production verify | **OK** |
| Outcome | **closed** |

### 10. `human-review-no-height-auto` · why-uk-councils-flying-blind

| Field | Value |
|-------|-------|
| Page | `https://autodun.com/blog/why-uk-councils-are-flying-blind-on-ev-charging-infrastructure.html` |
| PR | [autodun-ai#43](https://github.com/kamrangul87/autodun-ai/pull/43) — merge `a6b393e` |
| auto_merged | **false** |
| owner_approved | **true** — same as §6 |
| Fix | article scope + dims (2 imgs: 1200×630 / 1200×675) |
| Production verify | **OK** |
| Outcome | **closed** |

### 11. `finding-wrong-ratio` · mot-cost-uk-2026

| Field | Value |
|-------|-------|
| Page | `https://autodun.com/blog/mot-cost-uk-2026.html` |
| PR | [autodun-ai#44](https://github.com/kamrangul87/autodun-ai/pull/44) — merge `0b5c0eb` |
| auto_merged | **false** |
| owner_approved | **true** — same fix type as #36; batch authorized 2026-09-22 |
| Pre-check | **No `object-fit`** — proceeded |
| Fix | Corrected declared dims from JPEG headers (were 780×520 → 2048×2048 / 1024×1024) on 4 imgs |
| Production verify | **OK** |
| Outcome | **closed** |

### Recrawl summary (after six residual topic-49 fixes)

| Metric | Before (post-rollup fix) | After |
|--------|--------------------------|-------|
| Actionable | **6** (all topic 49) | **0** |
| Topic 49 actionable | 6 | **0** |
| Production tip | — | `0b5c0eb` Ready |

## 12. Fresh verify (2026-09-22, owner re-confirm)

Owner re-authorized the same two fix types for any remaining pages. Live check:

| Check | Result |
|-------|--------|
| Live crawl (`LIVE_CRAWL=1`) | actionable **0**; topic 49 per-page section empty |
| Production tip | `0b5c0eb` (`fix(seo): topic 49 correct img ratio dimensions — mot-cost-uk-2026 (#44)`) |
| 5× `human-review-no-height-auto` pages | Live HTML has `article img { … height:auto }` + width/height attrs |
| `mot-cost-uk-2026` wrong-ratio | **No `object-fit`** (would have been FP stop); dims already corrected 2048×2048 / 1024×1024 |
| New autodun PRs this turn | **None** — §6–§11 already closed every remaining page |

Grouped findings UI: list + detail now render **every** `memberUrls` entry (not count-only).

Final actionable count: **0**.

---

## 13. Topic 1 · `human-review` · about → charging-map href

| Field | Value |
|-------|-------|
| Origin | `https://autodun.com` |
| Topic | 1 |
| Verdict | `human-review` (broken internal link / 404) |
| Page | `https://autodun.com/about` |
| Kind | `broken-internal-link/404` |
| Detected | 2026-09-24 (live crawl after render guard; actionable 4) |
| Fixed | 2026-09-24T09:12:24Z |
| PR | [autodun-ai#46](https://github.com/kamrangul87/autodun-ai/pull/46) — merge `9150765` |
| auto_merged | **false** |
| owner_approved | **true** — Kamran explicitly approved applying #1–#3 on 2026-09-24 |
| Pre-check | `https://ev.autodun.com/` → **200**, **0 redirect hops**. Used final URL `https://ev.autodun.com/`. |
| Fix detail | Rewrote CTA href `/charging-map` → `https://ev.autodun.com/`; CTA text kept |
| Preview verify | **OK** — preview `/about` has `href="https://ev.autodun.com/"`, no `/charging-map` |
| Production verify | **OK** — live `/about` CTA → `https://ev.autodun.com/` |
| Production tip | included in `c35e8ee` / later `7cc9538` Ready (`dpl_GpX2FdsU3surk1KrgwUFh7Z5ZRxp`) |
| Outcome | **closed** |

---

## 14. Topic 27 · `report-omission` · /about sitemap

| Field | Value |
|-------|-------|
| Origin | `https://autodun.com` |
| Topic | 27 |
| Verdict | `report-omission` |
| Page | `https://autodun.com/about` |
| Detected | 2026-09-24 |
| Fixed | 2026-09-24T09:12:33Z |
| PR | [autodun-ai#47](https://github.com/kamrangul87/autodun-ai/pull/47) — merge `c35e8ee` |
| auto_merged | **false** |
| owner_approved | **true** — Kamran, 2026-09-24 |
| Pre-check | 200, self-canonical `https://autodun.com/about`, no noindex / X-Robots-Tag |
| Fix detail | Added `<loc>https://autodun.com/about</loc>` to hand-maintained `public/sitemap.xml`; XML validated |
| Preview verify | **OK** |
| Production verify | **OK** — sitemap lists about |
| Outcome | **closed** |

---

## 15. Topic 27 · `report-omission` · /contact sitemap

| Field | Value |
|-------|-------|
| Origin | `https://autodun.com` |
| Topic | 27 |
| Verdict | `report-omission` |
| Page | `https://autodun.com/contact` |
| Detected | 2026-09-24 |
| Fixed | 2026-09-24T09:17:57Z |
| PR | [autodun-ai#48](https://github.com/kamrangul87/autodun-ai/pull/48) — merge `7cc9538` |
| auto_merged | **false** |
| owner_approved | **true** — Kamran, 2026-09-24 |
| Pre-check | 200, self-canonical `https://autodun.com/contact`, no noindex / X-Robots-Tag |
| Fix detail | Added `<loc>https://autodun.com/contact</loc>` to `public/sitemap.xml` (rebased onto #47); XML validated |
| Preview verify | **OK** — preview sitemap has about + contact |
| Production verify | **OK** — live sitemap lists contact |
| Production tip | **`7cc9538`** (`dpl_GpX2FdsU3surk1KrgwUFh7Z5ZRxp`) **Ready** |
| Outcome | **closed** |

---

## 16. Topic 34 · `human-review-missing-lang` · /mot-predictor (no fix — guard)

| Field | Value |
|-------|-------|
| Origin | `https://autodun.com` |
| Topic | 34 |
| Verdict | `human-review-missing-lang` (false positive) |
| Page | `https://autodun.com/mot-predictor` |
| Detected | 2026-09-24 |
| Action | **No site change** — left alone per owner |
| Exclusion | Cross-host redirect: 308 → `https://mot.autodun.com/` which already has `<html lang="en">` |
| Detector guard | seoranko [PR #144](https://github.com/kamrangul87/seoranko-com/pull/144) / main `f370e0e` — `suppress-cross-host-redirect` when 3xx Location is another host |
| owner_approved | **true** — Kamran directed leave #4 alone + add guard, 2026-09-24 |
| Outcome | **excluded** — not a content fix; FP prevented going forward |

### Recrawl summary (after #13–#15 + topic 34 guard)

| Metric | Before (2026-09-24 pre-fix) | After |
|--------|------------------------------|-------|
| Actionable | **4** | **0** |
| Informational | 42 | 41 |
| Topic 34 `/mot-predictor` | `human-review-missing-lang` | `suppress-cross-host-redirect` (internal) |
| Production tip | — | **`7cc9538`** Ready |

Remaining listable: **none** actionable. Informational left: click-depth metrics, recommended `author.url` absent, FAQPage deprecated-type (inert — do not auto-remove), one `raw-render-mismatch` on `/`, trailing-slash `informational-generated-only`.
