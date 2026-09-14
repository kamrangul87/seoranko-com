# plumbing__repo_to_url_site_model

Status: DRAFT — one open question
Topic: 70 of the issue register
Tier: A (cross-cutting plumbing)
Blocks: topic 1 and every fix branch
Research dates: 2026-09-14

---

## what this is

Not a user-facing finding. The mapping every fixer needs: given a URL on the
live site, which file in the connected repo is responsible for it. Without
this, no fix can be applied to the right place and topic 1's discriminator
cannot run.

## primary source

- Next.js, App Router routing fundamentals and file conventions —
  https://nextjs.org/docs/app/api-reference/file-conventions/page
- Next.js, dynamic routes (catch-all and optional catch-all) —
  https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes
- Next.js, route groups —
  https://nextjs.org/docs/app/api-reference/file-conventions/route-groups
- Next.js, parallel routes —
  https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes
- Next.js, middleware —
  https://nextjs.org/docs/app/api-reference/file-conventions/middleware

URLs to be confirmed against the live docs before entering `_sources.md`;
the facts below were gathered 2026-09-14 and need one direct read each.

### Verified facts

| Fact | Consequence for the model |
|---|---|
| Folders define URL segments; `page.tsx` supplies the page for that segment | base case of the mapping |
| `[...slug]` catch-all requires at least one segment and 404s at the parent root | `/shop` does not resolve against `app/shop/[...slug]/page.tsx` |
| `[[...slug]]` optional catch-all also matches the parent root | `/shop` does resolve against `app/shop/[[...slug]]/page.tsx` |
| Route groups `(name)` organise files and apply shared layouts without appearing in the URL | group folders must be stripped when deriving a path |
| Parallel routes `@name` are slots rendered into a layout, not URL segments | `@` folders must be ignored entirely when deriving a path |
| `NextResponse.rewrite()` changes the destination path server-side while the browser URL stays the same | the repo route tree alone can be wrong about which file serves a path |

## resolution order

A URL's apparent path does not determine which code handles it. The model must
resolve in this order, and a fixer may act only once the order has run to
completion:

    URL → middleware rewrite/redirect → route-group stripping → parallel-slot
    exclusion → static segment → [param] → [...catchAll] → [[...optionalCatchAll]]
    → resolved route file → HTTP status

A path with no literal folder of that name may still be served correctly by a
dynamic segment, a catch-all, a route hidden behind a route group, or a
middleware rewrite. "No folder named `/x/y`" is never proof that `/x/y` has no
page.

## threshold — what the model must answer

Given a path, return exactly one of:

- `static-route` — a concrete `page.tsx` resolves it. The file is named.
- `dynamic-route` — a dynamic segment pattern resolves it. The pattern file is
  named. **Resource existence is not proven.**
- `no-route` — no pattern in the repo can resolve this path.
- `indeterminate` — middleware may rewrite this path and the rewrite could not
  be resolved statically.

## the dynamic-route limitation — read before using this for topic 1

`app/blog/[slug]/page.tsx` matches `/blog/anything`. Route resolution
therefore proves that a *route pattern* exists, never that a *resource*
exists. Since streamed soft 404s occur on dynamic routes, route resolution
alone cannot separate a dead dynamic route from a live one.

**This invalidates the discriminator originally chosen in topic 1** and
replaces it:

> For a target returning 200 with `noindex`, check whether the repo *declares*
> `noindex` for that route — via a `metadata` export, `generateMetadata`, or a
> robots config on the resolved route file.
>
> - repo declares `noindex` → the directive is deliberate. Valid page.
>   Suppress the finding.
> - repo does not declare it, yet the live response carries it → Next.js
>   injected it during a streamed not-found render. The destination is gone.
>   Raise the finding.

This works because the injected `noindex` has no counterpart in the source.
It holds for dynamic and static routes alike, and does not depend on
`dynamicParams`, on text in the page body, or on the resource existing.

Where the resolved route is `dynamic-route` and the repo declares no
`noindex`, `generateStaticParams` output may be used as supporting evidence,
but only where the route is statically generated.

## detect / construction

1. Walk the repo route directory. Collect every `page.tsx` / `page.js`.
2. Derive each route's URL pattern: strip `(group)` folders, ignore `@slot`
   folders, keep `[param]`, `[...catchAll]`, `[[...optionalCatchAll]]`.
3. Record, per route file, whether it declares `noindex` (metadata export,
   `generateMetadata`, robots config).
4. Parse `middleware.ts` for `rewrite()` calls. Any path that may be rewritten
   is `indeterminate`.
5. Resolve a path by matching most-specific-first: static segment, then
   `[param]`, then `[...catchAll]`, then `[[...optionalCatchAll]]`.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Middleware rewrite cannot be resolved statically (dynamic condition, runtime value) | return `indeterminate`; never let a fixer act on an indeterminate path |
| 2 | Route group folder treated as a URL segment | strip before matching, or every grouped route resolves wrongly |
| 3 | Parallel route `@slot` treated as a URL segment | ignore entirely |
| 4 | `[...slug]` assumed to match the parent root | it does not; only `[[...slug]]` does |
| 5 | `dynamic-route` resolution mistaken for proof the resource exists | never; see the limitation above |

### Explicitly rejected

- **Using route resolution alone as topic 1's soft-404 discriminator.**
  Insufficient for dynamic routes, which is the only case it was needed for.
  Replaced by the repo-declared-`noindex` check above.
- **Treating the repo route tree as authoritative where middleware rewrites
  exist.** The served path and the repo path can differ by design.

## consumers

Every fix branch — a transform cannot be applied without knowing which file
serves the URL. Topic 1 depends on it for the discriminator.

## Open questions

1. Can `middleware.ts` rewrites be resolved statically often enough to be
   useful, or should any site with a middleware rewrite mark all affected
   paths `indeterminate` by default? Needs a look at real middleware.
2. ~~Confirm the six facts above against the Next.js docs directly.~~
   **Corroborated 2026-09-14** by a second independent pass covering route
   groups, parallel slots, catch-all vs optional catch-all, and middleware
   rewrites. Still worth one direct read before the `_sources.md` rows are
   marked verified rather than corroborated.
3. **The discriminator's `noindex` declaration check is not yet specified.**
   Every way a route can declare `noindex` — static `metadata` export,
   `generateMetadata`, layout-level inheritance, `robots` config — must be
   enumerated before the check can be implemented. This is now the blocking
   item for topic 1.

## Cross-references

- topic 1 — supplies the replacement discriminator; topic 1's detect section
  must be updated to match this file
- topic 41, 42, 44 — all fix branches need the file mapping
- topic 2 — soft 404s, same discriminator
