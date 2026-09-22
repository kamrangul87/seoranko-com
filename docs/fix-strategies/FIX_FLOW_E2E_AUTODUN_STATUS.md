# Fix-flow E2E status — autodun actionable five → four

Source: `FINDINGS_LIVE_CRAWL_AUTODUN_REPORT.md` (recrawl 2026-09-22).
Outcome ledger: `FIX_VERIFY_OUTCOME_RECORD.md`.

## Closed (fix → production verify → recrawl)

| Topic | Verdict | Page | Status |
|-------|---------|------|--------|
| 49 | `auto-set-dimensions` | `/blog/mot-advisories-explained-uk.html` | **Closed** — [autodun-ai#34](https://github.com/kamrangul87/autodun-ai/pull/34) merged 2026-09-22; production verify OK; recrawl actionable **5 → 4** |

Production verify (not preview):

- URL: `https://autodun.com/blog/mot-advisories-explained-uk.html`
- 3 images → `width="1200" height="675"`
- `verifyLiveImgDimensions` + `verifyFindingLive` → OK

Script: `scripts/verify-prod-topic49.ts`

## Human-review remaining (show evidence + proposal; do not apply)

| Topic | Verdict | Scope | UI |
|-------|---------|-------|-----|
| 49 | `human-review-no-height-auto` | 6 URLs (rollup) | Declared vs intrinsic evidence; proposal shown; **No auto-fix** |
| 49 | `finding-wrong-ratio` | 2 URLs | Declared vs intrinsic; ratio mismatch; **No auto-fix** |
| 8 | `human-review-preferred-conflict` | 3 URLs · `config:vercel.json` | Preferred-form conflict; related topic 26 evidence; **No auto-fix** |
| 25 | `moderate-out-of-scope` | `mot.autodun.com` | Out-of-scope host; **No auto-fix** |

API rejects `approve`/`commit` for non-`auto-fixable` surface classes.
