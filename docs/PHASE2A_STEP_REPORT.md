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

### H3 — empty candidate queue before reserve — **matches the symptom**

In `syncUrlInspectionsForConnection`:

1. `buildInspectionQueue(...)` (diagnosis pages, sitemap, `url_metrics_daily` impressions>0, deferred, interventions; skip succeeded inspections <3d)
2. `batch = queue.slice(0, batchCap)`
3. **`if (batch.length === 0) return` with `stoppedReason: 'empty'` — before `reserveQuota()`**

That yields: cron metrics update `last_sync_at`, inspection path reserves nothing, `last_error` stayed null. Exactly production’s “clean cron, quota_usage=0” shape.

**Fix shipped:** empty queue / zero reservation / thrown batch now write `gsc_connections.last_error` via `formatInspectionLastError`. Successful `inspected > 0` clears it.

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

## STEP 1 — Live GSC token probe *(blocked in this agent env)*

### Attempted

- Local agent env has **demo** Supabase (`127.0.0.1:54321`) + `test-…` encryption key; no `GOOGLE_GSC_CLIENT_*`.
- GitHub Actions migrate job (e.g. `34453784926`): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_CONNECTION_ENCRYPTION_KEY` are **empty** in the job env (secrets not set / not passed). Only `SUPABASE_DB_PASSWORD` is present → probe skips live API.
- `curl https://www.seoranko.com/api/cron/gsc-sync` → `401 {"error":"Unauthorized"}` (no `CRON_SECRET` in agent).
- Dashboard session: not logged in; cannot click Sync.

### Script ready

`scripts/gsc-phase2a-token-probe.mjs` — decrypts autodun refresh token, refreshes,
calls `sites.list` + one-day `searchAnalytics`, prints raw JSON (no tokens).

### Silent-failure finding (from code, independent of token)

Even when cron runs: failures set `gsc_connections.last_error` and log to Vercel.
There is **no** email / pager / dashboard badge gated on stale `last_sync_at`.
Experiments page shows `last_error` only if the user opens it. That is why four
days of stale `url_metrics_daily` (latest **2026-09-06**) can go unnoticed.

### Unblock

Add hosted secrets to the Cloud Agent env **or** GitHub Actions (and Vercel):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_CONNECTION_ENCRYPTION_KEY`
- `GOOGLE_GSC_CLIENT_ID` / `GOOGLE_GSC_CLIENT_SECRET`
- Optional: `CRON_SECRET` to invoke production cron once

Then re-run the probe and paste its JSON here as Step 1 evidence.

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
