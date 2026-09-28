# Change Monitoring — Stage 3 (master plan §3.3)

**Status:** Landing on `cursor/change-monitoring-sched-922c` (2026-09-28).

## Scope

Weekly scheduled recrawl per connected site.

| Constraint | How |
|---|---|
| Hobby cron | `0 7 * * 1` only (weekly Monday) — no sub-daily |
| Crawl-start quota | `reserveCrawlStart` (Postgres P2) — never bypassed |
| Plan page limit | `crawlPageQuotaForUser` → `maxUrls` + `plan_page_limit` note |
| Capped run | status `partial`, limit named — never silent truncate |
| Render | Unchanged selective rules in orchestrator |
| Two failures | Skip site; report why |
| Terminal status | Drain ticks until `complete`/`partial`/`failed` + `finished_at` |
| Resolution | Orchestrator: only URLs assessed in that run |

## Pieces

| Piece | Location |
|---|---|
| `trigger` column | `supabase/migrations/20260928074000_crawl_run_trigger.sql` |
| Decision + drain | `scheduled-recrawl.ts` |
| Cron | `/api/cron/scheduled-recrawl` (+ `?domain=` filter) |
| Tests | `scheduled-recrawl.test.ts`, live `scheduled-recrawl.live.test.ts` |

## Acceptance

1. Live scheduled run vs autodun → terminal status, pages crawled/rendered, resolve/regress counts.
2. Immediate second call same UTC week → `already_ran_this_week` skip.

## Not in this stage

What-changed digest (§3.4).
