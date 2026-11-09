# Internal Link Map

**Goal:** Visual internal-linking graph for a connected site’s existing Audit crawl (no second crawler), with live build-up, orphan/deep/broken insights, and deterministic link suggestions.

**Architecture:** Persist crawlable internal anchors as the findings crawler already fetches HTML. Build the graph in pure functions (BFS depth, inlink counts, metrics). Dashboard polls the latest run. Suggestions reuse Page-2 / path-token overlap. Create PR only via existing related-articles / topic-43 transforms (approval required).

**Stack:** Next.js 14, existing findings crawl, additive Supabase table, canvas + d3-force, no new env vars.

## Files

- Create: `src/lib/internal-link-map/` (extract, build, metrics, suggest, persist)
- Create: `supabase/migrations/20261109160000_crawl_link_edges.sql`
- Create: `src/app/api/internal-link-map/route.ts` (+ suggest-fix)
- Create: `src/app/dashboard/links/page.tsx` + canvas component
- Modify: findings crawler orchestrator (persist edges on each crawled page)
- Modify: `NAV_ITEMS` (Link map next to Audit)
- Modify: `.github/workflows/test.yml` (add `src/lib/internal-link-map/`)

## Data

`fix_strategies_crawl_link_edges`: one row per internal anchor on a crawl run (`run_id`, `site_id`, `user_id`, source, target, href_raw, anchor_text, is_nofollow, target_http_status, target_final_url, is_redirect). RLS: `auth.uid() = user_id`. Grants: service_role write; authenticated SELECT.

## Constraints

- Reuse findings crawl; cap 2000; Hobby-safe (chunked inserts, no realtime, canvas, unique visual edges, limited labels)
- Ownership on every API route
- Never auto-apply fixes
- Do not touch fixture `expected.json`
- No holding-company names in UI
