# Fix-site redirect loops (Sentry)

## Incident

Sentry: `TypeError: fetch failed` / `redirect count exceeded` on
`/api/cron/fix-site`.

**Loop that crashed verify:** autodun-ai PR **#60** preview served a
trailing-slash bounce:

`/privacy` → `/privacy/` → `/privacy` → …

`defaultTickDeps.fetchPage` used `redirect: 'follow'`. Undici follows until its
internal limit, then **throws** — the cron returned empty HTTP 500 instead of
failing the fix-run item.

## Permanent behaviour

- Fix-run / live verifiers use `fetchPreviewPage` → `recordRedirectHops`
  (`redirect: 'manual'`, max **10** hops, visited-set loop detect).
- On loop: item fails with readable
  `Redirect loop: urlA → urlB → urlA` and the chain is stored as
  `fix_failures` evidence (JSON `{ kind, chain }`). No throw.
- Crawl `safeCrawlFetch` uses the same max-10 + loop rules.
- Fixture: `topic-4-7-redirects` includes `/privacy` ↔ `/privacy/` as
  `finding-loop` with full cycle evidence.
