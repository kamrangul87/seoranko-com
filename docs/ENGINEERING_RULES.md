# SEORANKO engineering rules

## Regression tests for production bugs

Every production bug fix **must** include a regression test in the **same PR**
that ships the fix. Prefer a deterministic unit/integration test under
`src/lib/**` that fails before the fix and passes after. Do not close a
production incident with “fixed in prod” and no test.

## New auto-fixable transforms require a planted fixture defect

Before a `(topicId, verdict)` pair may be registered in
`src/lib/fix-strategies/findings-ui/fix-run/apply-registry.ts` as
auto-fixable:

1. Plant the defect in `fixtures/seoranko-fixture-site/` (and the live
   `kamrangul87/seoranko-fixture` **seed** branch).
2. Document it in `fixtures/seoranko-fixture-site/README.md`.
3. Add the expected finding to `fixtures/seoranko-fixture-site/expected.json`
   (topic, verdict, page URL, surface class, `autoFixable: true`).
4. Confirm the Fix Agent e2e (`/admin/fix-agent-e2e`) still passes against seed.

No registry entry without a planted fixture + expected.json row.

## Fix Agent e2e

The permanent e2e at `/api/cron/fix-agent-e2e` (daily) and
`/admin/fix-agent-e2e` (“Run now”) resets the fixture site to seed, crawls,
runs Fix my site, merges, and recrawls. Failures email `MASTER_EMAIL` via
Resend and raise a Sentry event. **Fix my site remains master-only** until
consecutive passing e2e days justify a separate product decision.

## Fix Agent failure learning

Every Fix Agent failure is written to `fix_failures` with a normalised
**signature** (`topic|verdict|stage|reason` with ids/URLs/numbers stripped).
Evidence is tag-level HTML only (≤ 2 KB) — never customer page body text.

1. **Every new failure signature** must get a draft fixture case under
   `fixtures/failure-cases/<signature-hash>/` (sanitised snippet + expected
   finding). The ledger opens a draft PR to this repo; do **not** auto-merge.
2. **Circuit breaker:** when apply / live-verify failures for a
   `(topic, verdict)` hit 2 distinct sites or 2 consecutive failures within
   14 days, that type is **paused**. `canOfferFix` returns false and the
   finding shows in Needs you with: “Automatic fix paused while we fix a
   problem with it.”
3. **Resume** is master-only (`/admin/fix-failures`) and allowed **only
   after** Fix Agent e2e has passed since the pause.
