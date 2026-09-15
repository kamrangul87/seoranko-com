# broken-internal-link__target_returns_4xx

Status: READY FOR IMPLEMENTATION — depends on topic 70 (site model) and topic 68 (re-fetch rule)
Discriminator revised 2026-09-14 — see detect
Research dates: 2026-09-10
Topic: 1 of the issue register

---

## what's actually wrong

A live page on the site contains an `<a href>` pointing at an internal URL
that does not resolve. The defect is the anchor, not the response: a 404 or
410 at the destination may be entirely correct behaviour. What is wrong is
that a page still links to it.

## primary source

- RFC 9110 (HTTP Semantics), Standards Track, June 2022 — https://www.rfc-editor.org/rfc/rfc9110.html
  - §15.5.5 (404 Not Found), §15.5.11 (410 Gone), §15.5 (Client Error 4xx)
- Google Search Central, How HTTP status codes and network/DNS errors affect
  Google Search — https://developers.google.com/search/docs/crawling-indexing/http-network-errors
- Google Search Central, Troubleshoot crawling errors — https://developers.google.com/search/docs/crawling-indexing/troubleshoot-crawling-errors
- Next.js, `not-found.js` file convention — https://nextjs.org/docs/app/api-reference/file-conventions/not-found
- Next.js, `notFound` function — https://nextjs.org/docs/app/api-reference/functions/not-found
- Next.js, `loading.js` file convention — https://nextjs.org/docs/app/api-reference/file-conventions/loading
- Next.js, Streaming guide — https://nextjs.org/docs/app/guides/streaming
- Next.js, Route Segment Config `dynamicParams` — https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/dynamicParams
- Next.js, `generateStaticParams` — https://nextjs.org/docs/app/api-reference/functions/generate-static-params

Verified facts drawn from these (full detail in `_sources.md`):

- §15.5.5: 404 means the origin server did not find a current representation
  for the target resource. It does **not** indicate whether the absence is
  temporary or permanent.
- §15.5.11: 410 means access is no longer available and the condition is
  **likely permanent**. Where the server cannot determine permanence, RFC 9110
  says 404 ought to be used instead.
- Google: all 4xx except 429 are treated identically for indexing — content
  signalled as non-existent, URL removed from the index if previously indexed,
  crawl frequency gradually decreasing. 404 and 410 sit in the same row.
- Corollary (§15.5.5): a URL returning 404 may later return 200 without any
  contradiction in HTTP semantics. A single 404 observation is therefore not
  evidence of absence.
- **Next.js returns HTTP 200 for streamed responses and 404 for non-streamed
  responses.** Streaming begins the moment a `<Suspense>` fallback renders
  (including via `loading.tsx`) or a component suspends. Once the first chunk
  is sent the status cannot be changed, so a `notFound()` firing mid-stream
  yields 200.
- In that case Next.js injects `<meta name="robots" content="noindex">` into
  the streamed HTML. Next.js's own documentation states that some crawlers
  will label these responses as soft 404s.
- To get a real 404 status, the resource must be checked before any `await` or
  `<Suspense>` boundary.
- `next.config.js` exposes `htmlLimitedBots`, which blocks streaming for
  matching user agents so real status codes are sent.
- `dynamicParams` defaults to `true`, generating unlisted dynamic segments at
  request time. Set to `false`, only paths from `generateStaticParams` are
  served and unspecified routes 404. Opt-in, and with open bug reports against
  its production behaviour — not a reliable detector input.

## threshold

For every internal `href` on a fetched page, the target resolves — meaning
either:

- HTTP 200 **without** an injected `noindex` and without not-found UI, or
- a 3xx resolving to such a response in one hop (that case belongs to topic 42)

**A 200 status alone is no longer sufficient proof that a destination
resolves.** On a Next.js app-router site, a dead dynamic route rendered inside
a streaming boundary returns 200 with `noindex` injected. Any detector keyed
purely on status will silently miss these — which is the largest class of
broken internal links on exactly the stack this product targets.

## detect

1. Parse all `<a href>` values from the fetched HTML of each crawled page.
2. Filter to internal URLs (same host after normalisation).
3. Apply the scheme filter (see guards) before any fetch.
4. Fetch each distinct target. Record status, and distinguish 404 / 410 /
   other 4xx / 5xx / network timeout / connection reset separately — they are
   not interchangeable.
5. **For targets returning 200, also check for the streamed-soft-404
   signature:** `<meta name="robots" content="noindex">` present in the served
   HTML. Presence makes the target a candidate, not a pass.
6. Re-fetch before raising (see topic 68). One observation is not evidence.

### The 200 + noindex ambiguity — RESOLVED

A 200 response carrying `noindex` has two possible causes and they need
different treatment:

- a deliberately noindexed but valid page (leave alone — not a broken link)
- a streamed `notFound()` render (broken link — the destination is gone)

Status and the meta tag alone cannot separate these.

**Chosen discriminator: repo-declared `noindex` check.** Using the site model
(topic 70), resolve the path to its route file and determine whether the repo
*declares* `noindex` for it — via a `metadata` export, `generateMetadata`, or
a robots config.

Check all three declaration sites (topic 70): static `metadata` in
`page.tsx`, static `metadata` in any `layout.tsx` above the route, and
`generateMetadata()`.

- repo declares `noindex` → the directive is deliberate. Valid page. Suppress.
- `generateMetadata` sets `robots` conditionally → indeterminate. Human-review.
- repo does not declare it, yet the live response carries it → Next.js
  injected it during a streamed not-found render. Destination gone. Raise.

Chosen because the injected `noindex` has no counterpart in the source, so the
check is deterministic, offline and quota-free. It holds for dynamic and
static routes alike and does not depend on `dynamicParams`, on page text, or
on the resource existing.

**Superseded: plain repo-side route resolution.** Originally chosen here, then
withdrawn. `app/blog/[slug]/page.tsx` matches `/blog/anything`, so route
resolution proves a route *pattern* exists, never that the *resource* exists.
Streamed soft 404s occur on dynamic routes, so it failed on the only case it
was needed for. Route resolution is still required — it names the route file
whose metadata is checked — but it is not the discriminator by itself.

**Rejected alternatives:**

- *Compare served HTML against the site's rendered `not-found.tsx`.* Content
  matching. Presentation is not semantics — a custom `not-found.tsx` or Vercel
  error page changes only how the response looks. Never build the
  discriminator on text-matching phrases in the page body ("not found", "404",
  "doesn't exist"): site-specific, locale-specific, and broken by any
  redesign.
- *Rely on `dynamicParams: false`.* Per the route-segment-config docs,
  `false` means dynamic segments not returned by `generateStaticParams` will
  404, and only provided paths are served. But it is opt-in and `true` is the
  default, so it is absent on most sites; and there are open Next.js issues
  reporting that unmatched paths do not 404 in production under `false` even
  though they do in dev. Not safe to build on.
- *Re-fetch with an `htmlLimitedBots`-matching user agent.* Only works where
  the site has configured `htmlLimitedBots`. Retained as optional
  confirmation, never as the primary signal.

## false-positive guards

| # | Guard | Action | Verified |
|---|---|---|---|
| 1 | `href` is not a fetchable HTTP URL — `#`, `mailto:`, `tel:`, `javascript:`, bare fragment | never fetch, never raise | spec-obvious, no source needed |
| 2 | Destination is an auth-protected route that returns 404 to unauthenticated requesters | raise as flagged, never auto-act | UNVERIFIED — no authoritative source found |
| 3 | Destination sits behind a WAF, rate limiter or security layer returning 404 deliberately | raise as flagged, manual review only | UNVERIFIED — no authoritative source found |
| 4 | The apparent failure originates in the MDX / shared-layout rendering layer, not the destination | never raise; the destination is valid | Next.js docs treat MDX content and shared layouts as separate rendering layers |
| 5 | Target returns 5xx, network timeout, connection reset, or a rate-limit response | never raise as this finding — availability problem, not a broken link | Google treats network errors similarly to 5xx |
| 6 | Fetch may have hit a stale cached 404 at the CDN | never raise until re-fetched | routed to topic 68 |
| 7 | Target returns 200 with `noindex` and is a deliberately noindexed valid page | never raise | Next.js streaming docs — requires the discriminator above to separate from a streamed soft 404 |
| 8 | Absence of git deletion evidence is not evidence the route never existed — shallow clone (`--depth N`), failed `git log`, missing runner/repo, unreachable path history, **or unconfirmed route-root coverage** (probe must use site-model `detectRouteRoots`, never a hard-coded `app/**` default) | never treat as `no-deletion-found`; emit `history-unavailable` → `human-review`. Never `recreate-scaffold`, never auto `remove-anchor` | git semantics: `git log --diff-filter=D` on a shallow tip cannot see deletions older than the shallow boundary; probing the wrong tree is the same class of false negative |
| 9 | Site model resolves `no-route` (or route kind is unknown/indeterminate) **and** git status is `no-deletion-found` | intent unknown — propose **nothing** (`no-action`, `human-review`). Never `recreate-scaffold`. Scaffold is only proposed when there is positive evidence the route existed/should exist (site model `static-route` / `dynamic-route`) | live autodun run 2026-09-15: `/charging-map` linked from `/about` is a client SPA target with no App Router file and no deletion under `src/app` — recreate was a false product action |

### Explicitly rejected as guards

Recording these matters as much as the guards themselves.

- **`rel="nofollow"` / `sponsored` / `ugc` on the anchor.** These describe the
  link relationship, not the destination. Google has treated them as hints
  rather than directives since Sept 2019 (ranking) and 1 Mar 2020 (crawling
  and indexing), so a nofollowed anchor may still be crawled. A dead
  nofollowed link is still a dead link and a user clicking it still hits a
  dead page. Not a guard.
- **Trailing-slash mismatch.** Next.js normalises this via a redirect, so it
  produces a 3xx, not a 4xx. Belongs to topic 42.
- **Deleted CMS entry on a dynamic route.** The destination is genuinely gone,
  so the 404 is correct and the anchor is stale. This is a
  *remove-the-anchor* case, not a leave-alone. It does guard against the
  recreate branch. Note: on a streamed route this case presents as 200 +
  `noindex`, not 404.
- **"Target returns 200, therefore out of scope."** Withdrawn. This was the
  original scoping rule and the Next.js streaming behaviour makes it unsafe:
  it would have excluded the most common form of the defect on this stack.
  Replaced by guard 7 plus the discriminator.

## fix — branch router

The destination's own status code is a declaration of intent under RFC 9110
and is the top-level branch:

- **Target returns 410** → the server has declared likely-permanent removal.
  Route to `remove-anchor`. No further evidence required.
- **Target returns 404** → permanence is unspecified by definition. Ambiguous.
  Cannot route without further evidence. Candidate evidence, in order of
  strength:
  1. Git history of the connected repo — whether the route ever existed and
     when it was deleted (`git log --diff-filter=D` over the routes
     directory). Deterministic, offline, no quota. The probe must distinguish
     three evidence states (see decision tree below): `deleted`,
     `no-deletion-found`, and `history-unavailable`. A shallow clone or
     failed/missing git probe is `history-unavailable`, never
     `no-deletion-found`.
  2. Successor-page similarity — path similarity plus main-content similarity.
     Requires *exactly one* candidate above the floor; two or more is a
     `human-review` verdict, not a tie to break.
  3. GSC impressions — `connection-required`; needs a defined path for sites
     with no GSC connection.
  - External inbound links are NOT an available input (no backlink API). Must
    not gate any branch.
- **Target returns 200 + `noindex`, confirmed as a streamed soft 404** → treat
  as the 404 branch above. Note that a *secondary* finding may apply to the
  site itself: moving the existence check before the streaming boundary, or
  setting `htmlLimitedBots`, so the route serves a real 404. That is a
  separate strategy with build-config blast radius, not part of this fix.
- **Outcomes:** remove the anchor / 301 to closest live equivalent / recreate
  the destination / hold for human-review when git history is unavailable.
  See per-branch blast radius below.

### 404 decision tree (git × successors)

Evaluated after a stable 404. Successor count is checked first; git status
decides only when successors are zero.

| Successors above floor | Git evidence status | Site-model route kind | Verdict | Action |
|---|---|---|---|---|
| exactly 1 | any | any | `human-review` | `proposed-301` |
| 2 or more | any | any | `human-review` | `ambiguous-successors` |
| 0 | `deleted` | any | `auto-fixable` | `remove-anchor` |
| 0 | `no-deletion-found` | `static-route` or `dynamic-route` | `human-review` | `recreate-scaffold` |
| 0 | `no-deletion-found` | `no-route`, indeterminate, or unknown | `human-review` | `no-action` (guard 9) |
| 0 | `history-unavailable` | any | `human-review` | `history-unavailable` |

`history-unavailable` covers: shallow clone with no matching deletion in the
tip, `git` command failure, missing `repoRoot`/`runGit`, empty/unconfirmed
site-model route roots (cannot prove the candidate path list covers the repo's
routing), or a path-history probe that cannot run. Positive deletion matches
found even on a shallow tip remain `deleted` — presence is trusted; absence on
incomplete history is not. Git path candidates come from `detectRouteRoots`
(primary App Router dir plus any secondary roots such as `src/pages`), never a
silent `app/**` default.

## postcondition

Asserted against the live deployed response, via a code path separate from the
executor. Never against repo or config state.

- remove-anchor: the live HTML of the source page no longer contains the href
- 301 branch: the live response for the old URL is 301 and its target returns
  200 in one hop
- recreate branch: the URL returns 200 with the expected content **and without
  injected `noindex`** — a 200 carrying `noindex` would mean the recreate
  silently failed into a streamed not-found render

## idempotent?

- remove-anchor: yes
- 301 branch: **no** — breaks if the successor later moves. Requires
  redirect-chain and self-redirect guards.
- recreate: n/a (scaffold only)

## risk / blast radius

Per branch, and they cannot share an autonomy level:

- remove-anchor, single page file: one file. Rollback = revert commit.
- remove-anchor, shared nav or layout component: affects every page. Higher
  review bar.
- 301: `next.config` / `vercel.json` — shared build config, affects all
  routes, not idempotent. Lower autonomy cap.
- recreate: scaffold only, same reasoning as the privacy-page 2b dossier.

## rollback

Revert the commit. For the 301 branch, also confirm no chain was introduced.

## verdict

- 410 target → `auto-fixable` (remove-anchor)
- 404 target with git evidence of deletion (`deleted`) and no successor →
  `auto-fixable` (remove-anchor)
- 200 + `noindex` confirmed streamed soft 404, with git evidence and no
  successor → `auto-fixable` (remove-anchor)
- 200 + `noindex` where the discriminator is inconclusive → `human-review`
- 404 target with exactly one high-similarity successor → `human-review`
  (proposed 301)
- 404 target with two or more candidate successors → `human-review`
- 404 target with `no-deletion-found`, no successor, and site-model
  `static-route`/`dynamic-route` → scaffold only, `human-review`
  (`recreate-scaffold`)
- 404 target with `no-deletion-found`, no successor, and site-model `no-route`
  (or unknown/indeterminate) → `human-review` (`no-action`) — propose nothing
  (guard 9)
- 404 target with `history-unavailable` and no successor → `human-review`
  (`history-unavailable`) — never recreate-scaffold, never auto remove-anchor
- guards 2 and 3 triggered → `human-review`

## fixture

Synthetic repo containing: one anchor to a 410 route, one anchor to a 404
route with a deleted predecessor in git history (`deleted` → remove-anchor),
one anchor to a 404 route with a single obvious successor, one anchor to a
404 route with two candidate successors, one anchor to a 404 with full
history and no matching deletion with `no-route` (`no-deletion-found` →
`no-action`), one anchor to a 404 on a shallow clone with no matching deletion
(`history-unavailable` → human-review), **one anchor to a dynamic route
with `loading.tsx` present whose `notFound()` fires mid-stream (returns 200 +
`noindex`)**, **one anchor to a deliberately noindexed valid page**, one
`mailto:` href, one `#` href.

CI asserts: the correct branch for each evidence state (including both
`no-deletion-found` and `history-unavailable`), scheme/healthy suppressions,
and specifically that the streamed soft 404 is raised while the deliberately
noindexed valid page is not.

---

## Causes observed in the wild

Discovery only — these do not set thresholds.

| Cause | Frequency |
|---|---|
| Page moved or renamed without updating internal links or redirects | very common |
| Slug change in Next.js leaving old hardcoded href/route references | common, especially after restructuring or migration |
| Case-sensitive URL mismatch (`/About` vs `/about`) | common on case-sensitive hosting/filesystems |
| Hardcoded localhost or preview URL left in production links | real; frequency not established by any authoritative source |
| Dead dynamic route inside a streaming boundary serving 200 instead of 404 | structural on Next.js app router wherever `loading.tsx` or `<Suspense>` is present |

## Open questions — blocking

1. ~~Does `notFound()` serve a real HTTP 404 on Vercel?~~ **CLOSED.** 404 for
   non-streamed responses, 200 for streamed. Verified against Next.js docs,
   2026-09-10.
2. ~~Which discriminator separates a streamed soft 404 from a deliberately
   noindexed valid page?~~ **CLOSED 2026-09-10.** Repo-side route resolution
   via the site model. Two alternatives rejected with reasons — see detect.
3. Guards 2 and 3 remain unverified. They stay flag-only until a primary
   source is found.
4. Confirm which Google page actually carries the soft-404 definition before
   citing it in `_sources.md`.

## Cross-references

- topic 2 — soft 404s. **Overlaps this topic more than expected:** on Next.js,
  a broken internal link and a soft 404 are frequently the same event
  observed from two sides. The two dossiers must agree on the discriminator.
- topic 41 — the remove / 301 / recreate decision tree
- topic 42 — internal links pointing at redirects
- topic 67 — pre-hydration crawl producing false findings. The streaming
  finding here is direct evidence for that suspicion.
- topic 68 — re-fetch rule; single-fetch evidence insufficiency
- topic 23 — link attributes (nofollow/sponsored/ugc reference lives here)
