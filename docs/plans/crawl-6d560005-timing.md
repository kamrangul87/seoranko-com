# Crawl `6d560005` timing (autodun.com, 2026-10-19)

Run id: `6d560005-2843-4020-a22f-1e3f461f099a`  
Wall: **17m59s** (started 07:45:20 → finished 08:03:20 UTC)  
Pages: **15 crawled, 0 rendered** (`render_mode=http` on every URL)

## Where the time went

| Phase | Wall clock | Actual work | Idle / lockout |
| --- | --- | --- | --- |
| URL chunk 1 (5 pages) | 07:45:21–07:45:26 | ~5s fetch+detectors | — |
| Lease gap | 07:45:26–07:50:02 | — | **~276s** |
| URL chunk 2 (5 pages) | 07:50:02–07:50:05 | ~3s | — |
| Lease gap | 07:50:05–07:54:43 | — | **~278s** |
| URL chunk 3 (5 pages) | 07:54:43–07:54:46 | ~3s | — |
| Post-crawl (GSC etc.) | 07:54:46–07:54:56 | ~10s | — |
| Lease gap | 07:54:56–07:59:26 | — | **~270s** |
| Post-crawl (sitemap / dup URL) | 07:59:26–07:59:28 | ~2s | — |
| Lease gap + finish | 07:59:28–08:03:20 | residual post-crawl | **~232s** |

**Summary:** ~15–20s of real HTTP + detector work; **~17 minutes of tick-lease lockout** between one-chunk-per-tick claims (lease ~280s, not released on return → browser drain got `lease_held`).

Render contributed **0ms** (`pages_rendered=0`, `total_render_time_ms=0`).

## Fixes (this PR)

1. `release_run_tick` in `finally` so the next tick can claim immediately.
2. Multi-chunk drain inside one soft budget (~240s) so 15 pages finish in one tick when possible.
3. `[crawl-tick]` phase timings logged (`urlFetchMs`, `detectorsMs`, `postCrawlMs`, `chunksClaimed`, `totalMs`).
