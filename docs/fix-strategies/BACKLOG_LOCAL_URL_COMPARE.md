/**
 * Backlog (consolidation audit follow-up) — local URL-compare reimplementations.
 *
 * Do NOT refactor in the four-fixes PR. Tracked here so the audit item is not lost.
 *
 * Callers that reimplement something `normalizeFixStrategyUrl` / hop-recording
 * already does:
 *
 * - `topic-14/detect.ts` — `sameHost` via `new URL().hostname`
 * - `topic-27/detect.ts` — `isSlashOrCaseMismatch` local slash/case compare
 * - `redirect-chain/classify-topic-5.ts` — trailing-slash bounce local compare
 * - `duplicate-url/detect.ts` + `verify-live.ts` — field-wise `new URL` / slash-strip
 * - `topic-46/detect.ts`, `topic-48/detect.ts` — `origin` equality
 * - `topic-36/detect.ts` — `new URL().href` absolutise (bypasses normalize)
 *
 * Local redirect / single-hop fetch (vs hop-recording-fetch):
 * - `duplicate-url/detect.ts` — `fetchManual`
 * - `topic-14/detect.ts` — first-hop manual fetch
 * - `topic-26/verify-live-sitemap.ts` — manual fetch for sitemap document
 *
 * Mechanical cleanup PR later: replace with shared helpers, keep behaviour.
 */
export {}
