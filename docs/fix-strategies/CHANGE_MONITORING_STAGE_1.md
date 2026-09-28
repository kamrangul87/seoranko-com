# Change Monitoring — Stage 1 (master plan §3.1)

**Status:** Landing on `cursor/change-monitoring-obs-922c` (2026-09-28).

## Scope (this stage only)

Observation timeline across crawl runs — persist one row per assessed URL per
run, classify the ordered series in code.

Not in this stage: regression fields (§3.2), scheduled recrawl (§3.3),
what-changed digest (§3.4).

## Shipped here

| Piece | Location |
|---|---|
| Table `fix_strategies_url_observations` | `supabase/migrations/20260928063525_url_observation_timeline.sql` |
| Classifier (never persistent from 1 obs) | `src/lib/fix-strategies/findings-ui/crawl/observation-timeline.ts` |
| Store append/list (memory + Supabase) | `store.ts`, `supabase-store.ts` |
| Persist on every terminal job path | `orchestrator.ts` → `persistUrlObservation` |
| Unit + memory-store tests | `observation-timeline.test.ts` |

## Classification rules (product)

- `< 2` points → `insufficient`
- All HTTP ok → `insufficient` (no error signal to monitor)
- Error earlier, ok now → `historical_resolved`
- Mix of ok/error ending in error → `intermittent`
- All-error 5xx streak spanning `persistent5xxObservationWindowMs` → `persistent`
- Other multi-error streaks (incl. 4xx-only) → `transient`

Window reuses `FIX_STRATEGY_PRODUCT_DECISIONS.persistent5xxObservationWindowMs`
(same product decision as topic-3 persistent-5xx).

## Definition of done for this stage

1. Migration additive + RLS select-own.
2. Observations written for crawled / failed / client_only / fetch-throw paths.
3. Tests green (classify + upsert + scope isolation).
4. PR → CI → merge → Production Ready on `main`.
