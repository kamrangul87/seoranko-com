# Change Monitoring — Stage 2 (master plan §3.2)

**Status:** Landing on `cursor/change-monitoring-reg-922c` (2026-09-28).

## Scope

Regression / post-fix fields on the **same** finding row as P1 resolution.
No parallel lifecycle.

| Field | Role |
|---|---|
| `first_seen_at` | Already on table (crawl persist) |
| `last_seen_at` | Already on table |
| `resolved_at` | P1 — crawl absence |
| `fixed_at` | SEORANKO customer-PR merge time |
| `verification_at` | Production/preview verify completion |
| `post_fix_status` | `verified` \| `verify_failed` \| `regressed` \| null |
| `regression_observed_at` | Set on `resolved` → `regressed` |

## Behaviour

- Re-observe after `resolved` → `status=regressed`, same `id`, keep `resolved_at`.
- If the row had a SEORANKO fix (`fixed_at` / `post_fix_status=verified`) →
  `post_fix_status=regressed` and owner copy names the PR (from fix-flow, else
  cross-ref `FIX_VERIFY_OUTCOME_RECORD.md` — **not** duplicated into the DB).
- Auto-merge production verify stamps `recordSeorankoFix` on the finding.

## Acceptance

See `finding-regression.test.ts`:

1. seed → resolve → reintroduce → REGRESSION, same id.
2. SEORANKO-fixed row names PR #N and “reverted or undone” on regression.

## Not in this stage

Scheduled recrawl (§3.3 — see `CHANGE_MONITORING_STAGE_3.md`), what-changed
digest (§3.4).
