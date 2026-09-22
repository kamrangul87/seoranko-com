# Findings UI — fix-strategies register

Shipped on branch `cursor/findings-ui-922c`.

## Built

### Screens
1. **`/dashboard/findings`** — list of actionable findings by default.
   Informational behind a toggle. Suppress / ok / route never appear.
2. **`/dashboard/findings/[id]`** — observation, verdict, proposed diff,
   `_sources.md` citations (URL + verified-on), internal evidence on request.
3. **`/dashboard/findings/[id]/fix`** — approve → commit → verify flow
   (auto-fixable only).

### Presentation layer (`src/lib/fix-strategies/findings-ui/`)
- Bucket classification from detector verdict prefixes (no detector changes)
- Demo run mirroring post-rollup autodun (10 actionable + 17 informational;
  349 internal counted but not listed)
- Source lookup from `docs/fix-strategies/_sources.md`
- Rolled-up rows show `declarationSite` + `affectedUrlCount` (no page list)

### API
- `GET /api/fix-strategies/findings`
- `GET /api/fix-strategies/findings/[id]`
- `POST /api/fix-strategies/findings/[id]/fix` `{ action: approve|commit|verify }`

Nav: **Findings** under primary dashboard items.

## Stubbed

| Piece | Status |
|---|---|
| ~~CMS / GitHub commit for fix-strategies~~ | **Closed** — opens a PR on a review branch (never pushes to main) |
| ~~Live verify-live.* after deploy~~ | **Closed** — waits for Vercel preview deploy, then topic verify-live |
| ~~Persisting fix-flow sessions~~ | **Closed** — `fix_strategies_fix_flows` table |
| Human-review auto-apply | Still refused — UI shows evidence + proposal only |

## Fix flow (auto-fixable only)

1. **Approve** — records intent in DB
2. **Commit via PR** — topic 49 applies `setImgDimensions` on the repo HTML file, commits to `seoranko/fix-49-…`, opens PR
3. **Verify live** — polls GitHub deployments for the PR preview URL, fetches that page, runs `verifyLiveImgDimensions` (auth-wall guard rejects login interstitials)
4. **Opt-in auto-merge** — only when `connected_sites.auto_merge_enabled` (default OFF; Autodun ON) **and** every gate holds: auto-fixable, CI green, preview verify OK, single-file blast radius. Otherwise a human merges.
5. **Production verify → outcome** — after merge, verify the live URL; on failure open a revert PR and flag. Record in `FIX_VERIFY_OUTCOME_RECORD.md` with `auto_merged: true|false`.

First closed loop: topic 49 `auto-set-dimensions` on autodun MOT advisories ([autodun-ai#34](https://github.com/kamrangul87/autodun-ai/pull/34), `auto_merged: false`); actionable 5 → 4. Owner-approved batch [#35](https://github.com/kamrangul87/autodun-ai/pull/35)–[#38](https://github.com/kamrangul87/autodun-ai/pull/38) closed the remaining four from that crawl → actionable **2** (see `FIX_VERIFY_OUTCOME_RECORD.md`).

Human-review / report-only findings show observation, evidence, and proposed change on the detail page but never offer Fix.
