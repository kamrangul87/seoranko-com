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
