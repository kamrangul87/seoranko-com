# Fix-flow E2E status — autodun actionable five

Source: `FINDINGS_LIVE_CRAWL_AUTODUN_REPORT.md` (2026-09-21).

## Auto-fixable (apply via real flow)

| Topic | Verdict | Page | Status |
|-------|---------|------|--------|
| 49 | `auto-set-dimensions` | `/blog/mot-advisories-explained-uk.html` | **Blocked on GitHub write token** |

Local apply against the live repo HTML succeeds:

- 3 images → `width=1200 height=675` from JPEG headers
- Paths: `mot-advisory-suspension.jpg`, `mot-advisory-brakes.jpg`, `mot-advisory-shock-absorber.jpg`

E2E script: `scripts/e2e-topic49-fix-flow.ts`  
(opens PR on `kamrangul87/autodun-ai`, waits for Vercel preview, runs `verifyLiveImgDimensions`)

Current blocker: stored `GITHUB_TOKEN` returns **401 Bad credentials**; Cursor GitHub App has **no push** on `autodun-ai`.

## Human-review (show evidence + proposal; do not apply)

| Topic | Verdict | Scope | UI |
|-------|---------|-------|-----|
| 49 | `human-review-no-height-auto` | 6 URLs (rollup) | Declared vs intrinsic evidence; proposal shown; **No auto-fix** |
| 49 | `finding-wrong-ratio` | 2 URLs | Declared vs intrinsic; ratio mismatch; **No auto-fix** |
| 8 | `human-review-preferred-conflict` | 3 URLs · `config:vercel.json` | Preferred-form conflict; related topic 26 evidence; **No auto-fix** |
| 25 | `moderate-out-of-scope` | `mot.autodun.com` | Out-of-scope host; **No auto-fix** |

API rejects `approve`/`commit` for non-`auto-fixable` surface classes.
