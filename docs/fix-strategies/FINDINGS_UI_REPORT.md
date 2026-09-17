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
| Live crawl orchestration into detectors | Demo dataset only (`demo: true`) |
| CMS / GitHub commit for fix-strategies | Stub — records intent; connector not wired |
| Live verify-live.* after deploy | Stub — returns deterministic pass after stub commit |
| Persisting findings / fix attempts to DB | In-memory session map only |
| Wiring real verify modules (topic-49 etc.) | Not connected to UI yet |

## Rules enforced
- Report-only / human-review: no Fix button; API rejects approve/commit
- Human-review: proposal + evidence shown; never auto-applied
- Internal evidence: detail accordion only, never list rows
