# Phase 2A — step reports (10 Sept 2026)

Do not treat this file as proof of closed 2A. Each step’s **Evidence** must
point at a live row / HTTP body / CI log. Update when evidence lands.

---

## Hypotheses (checked 10 Sept against `origin/main` @ `6bf7dab`)

### H1 — return-column `day` vs `quota_day` — **not the cause on current code**

| Side | Fields |
|---|---|
| Live SQL (`20260909144000_…rename_day.sql`) | `reserved`, `remaining`, `quota_day`, `requests_used`, `exhausted` |
| `reserveQuota()` reader | `row.reserved`, `row.remaining`, `row.quota_day` **or** legacy `row.day`, `row.exhausted` |

Caller already prefers `quota_day` with `day` fallback. A pure rename mismatch would not prevent the RPC from inserting a `gsc_inspection_quota_usage` row — reserve still runs. Zero rows ⇒ reserve was never called (or never committed).

### H2 — Vercel deploy lag vs DB — **was briefly true, now cleared**

- `a21c444` Vercel **failed** (missing imports in `run-public.ts`).
- Fix `6bf7dab` Vercel **success** (“Deployment has completed”).
- Quota rename landed earlier (`7833f65` / `20260909144000`). Live app commit **postdates** the rename.

### H3 — empty candidate queue before reserve — **mechanism real; not why prod is empty**

In `syncUrlInspectionsForConnection`:

1. `buildInspectionQueue(...)` (diagnosis pages, sitemap, `url_metrics_daily` impressions>0, deferred, interventions; skip succeeded inspections <3d)
2. `batch = queue.slice(0, batchCap)`
3. **`if (batch.length === 0) return` with `stoppedReason: 'empty'` — before `reserveQuota()`**

That path can explain quota_usage=0 **if** the queue is empty. Production counters (CI run `34460594608`, probe `gsc-inspection-queue-sources-probe.mjs`) show it would **not** be empty for autodun:

| Source | Predicate (code) | Prod count (site `50b305a3-…`) |
|---|---|---|
| Diagnosis | latest `index_diagnosis_runs` for `user_id` + `domain` → pages not BLOCKED/excluded | **14** eligible pages |
| Sitemap | same run `coverage.sitemapDiscoveredUrls` | **13** eligible |
| Metrics | `url_metrics_daily` `site_id` + `impressions > 0` (**no date window**) | **370** rows / **12** distinct URLs (freshest 2026-09-06) |
| Deferred | `gsc_inspection_deferred` `property_url` + `pending` + `next_attempt_at <= now()` | **0** |
| Interventions | `intervention_events` verified + `site_id` + `verified_at` | **1** (with URL) |

Date-window suspicion **disproven** in code. (Hypothetical `date >= today-3` would match **0** distinct URLs today — same failure class as discontinuity floor — but metrics does not filter on date.)

**Fix shipped (observability):** empty queue / zero reservation / thrown batch write `gsc_connections.last_error`.

### H4 — cron inspection wave orders by missing `gsc_connections.updated_at` — **root cause of quota_usage=0**

`syncAllUrlInspections` selected active connections with `.order('updated_at')`. Table only has `connected_at` / `last_sync_at` (migration `20260907120000_…`). PostgREST errors → entire inspection try/catch in cron logs and returns metrics `ok: true` with no reserve. Metrics sync never touches that order column.

**Fix shipped (`8d7cd91`):** order by `last_sync_at` (nulls first). Regression test asserts no `updated_at` order on that wave.

---

## STEP 2 — What triggers URL Inspection sync? *(answered from merged code)*

`gsc_inspection_quota_usage = 0` means `reserve_gsc_inspection_quota` has never
been invoked by a successful real run. Callers that are *supposed* to invoke it:

| Trigger | Path | How |
|---|---|---|
| **Daily cron** | `src/app/api/cron/gsc-sync/route.ts` | `GET` with `Authorization: Bearer $CRON_SECRET` → `syncAllActiveGscConnections` then `syncAllUrlInspections` (`src/lib/gsc/inspection-scheduler.ts`) which calls `reserve_gsc_inspection_quota` |
| **Cron schedule** | `vercel.json` | `"path": "/api/cron/gsc-sync", "schedule": "0 11 * * *"` (daily 11:00 UTC) |
| **UI / API** | `src/app/api/gsc/inspections/route.ts` `POST` | Authenticated user + `{ siteId }` → `syncUrlInspectionsForConnection` |
| **UI button** | `src/components/IndexDiagnosisPanel.tsx` | `runInspectionSync()` → `POST /api/gsc/inspections` (“Sync Google’s last recorded view”) |

**Not “nothing”.** Callers exist. Zero quota rows means none of those paths have
successfully reserved quota against production yet (token/secret failure,
cron auth miss, or inspection batch error swallowed after metrics).

Cron swallows inspection failures:

```ts
// src/app/api/cron/gsc-sync/route.ts
try {
  inspections = await syncAllUrlInspections(supabase)
} catch (err) {
  console.error('[cron/gsc-sync] url inspection batch', ...)
}
// still returns ok: true for metrics
```

**Status:** Step 2 complete (code evidence). Do not patch sync internals until
Step 1’s live token call succeeds or is proven dead.

---

## STEP 1 — Live GSC token probe *(production-only; not env validation)*

Token decrypt uses `SITE_CONNECTION_ENCRYPTION_KEY`, which stays on **Vercel
Production** only — not the Cloud Agent VM. Env validation is: `npm ci`, unit
tests, Postgres pooler, and service-role REST (all confirmed 10 Sept).

Live Google calls / first inspection: trigger **Index Diagnosis → Sync Google’s
last recorded view** in production (or wait for `gsc-sync` cron). Do not require
encryption key in Actions/Cloud Agent.

`scripts/gsc-phase2a-token-probe.mjs` remains for optional local use when someone
has production decrypt secrets; it is **not** part of the CI env-validation path.

---

## STEP 3 — One inspection + one quota row

**Not started** — blocked on Step 1.

When Step 1 passes: trigger `POST /api/gsc/inspections` for autodun `siteId`
(or probe `syncUrlInspectionsForConnection` with `maxUrls: 1`). Pass only when
both tables gain a row from the same run.

---

## STEP 4 — 2B

**Not started** — blocked on Step 3 / 2A close.

---

## CONTAINMENT (public tool)

Shipped on `main` with this workstream: public Index Diagnosis rate limit **1
scan / IP / hour**, crawl cap **40** discovered / **40** fetched, depth **4**,
~25s deadline. No new features.
