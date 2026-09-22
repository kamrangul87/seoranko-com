# Fix → verify → outcome record

Ledger of findings that completed the full loop: detect → fix (PR) →
production verify → recrawl confirms absence.

Each entry is keyed to a finding identity `(origin, topic, verdict, page)`.
Detected date = first live crawl that raised it. Fixed date = PR merge to
the site’s production branch. Production verification = topic verify-live
against the live URL (not a preview). Recrawl = live findings crawl after
deploy.

`auto_merged: true` = product merged under site `auto_merge_enabled` gates.
`auto_merged: false` = human merged the customer PR.

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
