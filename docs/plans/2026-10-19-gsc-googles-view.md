# Google's view (GSC not-indexed explanations)

## Goal
Deterministic Index Diagnosis table explaining every GSC not-indexed reason so healthy rows (redirects, proper canonicals, intentional 404s, Google's choice) don't look like emergencies. PROBLEM rows stay actionable and surface in findings.

## Files
- `src/lib/gsc/googles-view/` — classify + build + copy + findings
- `src/app/api/gsc/googles-view/route.ts` — siteId → table rows (live hop fetch for redirects)
- `src/components/IndexDiagnosisPanel.tsx` — "Google's view" table
- Tests: unit fixtures (2-hop path PROBLEM, redirect→404 PROBLEM) + autodun live EXPECTED set

## Rules (mechanical)
- Redirect EXPECTED iff every hop is 301/308 host/scheme/slash-only, final 200 self-canonical, not soft-404 to homepage, not still in sitemap, not still linked.
- Alternate canonical: healthy iff target 200 + self-canonical.
- 404: healthy iff live 404 and not sitemap/linked, OR live already 200 (stale GSC); "Validation passed" only when input says so.
- Crawled/Discovered not indexed: Google's choice + Index Diagnosis causes for those URLs.
