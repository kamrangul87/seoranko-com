# FOUND_ISSUES.md

Unrelated issues noticed while shipping the public Index Diagnosis tool.
Do not treat this as a fix list for the current task.

| File | Line (approx) | Note |
|---|---|---|
| `src/lib/index-diagnosis/types.ts` | CrawlExcludeReason | `META_NOINDEX` / `X_ROBOTS_NOINDEX` exist on the crawl-exclude enum but the crawler never writes them (noindex is evaluated only on fetched pages). |
| `src/lib/index-diagnosis/crawler.ts` | MAX_FETCHED default 50 | Dashboard Index Diagnosis still fetches at most 50 pages while discovering 200 — fine for dashboard, easy to misread as a “full” crawl. |
| `src/lib/quality-gate/__tests__/regression.test.ts` | snapshots | Full `npm test` can fail on obsolete/mismatched Quality Gate snapshots unrelated to Index Diagnosis (CI subset still green). |
| Cloud agent env | process env | Placeholder `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co` / `SUPABASE_SERVICE_ROLE_KEY=placeholder` in the agent shell override `.env.local` for Next.js (Next does not override existing env). Local public_scans persist returns `scanId: null` until Next is started with the real local URL/key exported. |
