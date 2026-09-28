# Issue — live autodun sitemap CI flake

**Status:** Fixed offline (2026-09-28). Live smoke optional via `LIVE_CRAWL=1`.

## Problem

`src/lib/sitemap-generator/generate.autodun.test.ts` hit the live site on every
CI run. After the preferred-form fix, `/blog/index.html` correctly reports
`AT_RISK` (canonical → `/blog`), but the test still expected `INDEXABLE`. That
failed on three consecutive PRs; each was merged by treating it as a
“pre-existing flake,” which trains the team to ignore red CI.

## Resolution

- Default CI path is now an **offline fixture** that asserts sitemap includes
  `/blog` and omits `blog/index.html` when the peer is `AT_RISK`.
- Optional live check remains behind `LIVE_CRAWL=1` and expects `AT_RISK` when
  `/blog/index.html` is present.

## Why not only skip

Skipping without a green offline substitute would still leave CI with no
coverage for the autodun preferred-form sitemap contract. Fixture = always
green + meaningful; live = opt-in smoke.
