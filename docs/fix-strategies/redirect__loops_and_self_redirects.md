# redirect__loops_and_self_redirects

Status: READY
Topic: 5 of the issue register
Tier: A
Depends on: topic 68 (re-fetch rule), topic 70 (site model)
Research dates: 2026-09-14

---

## what's actually wrong

A redirect returns to a URL already visited in the same chain, so the chain
never reaches a final response. A self-redirect (A → A) is the one-hop case.

## primary source

- Google, How HTTP status codes affect Google's crawlers —
  https://developers.google.com/crawling/docs/troubleshooting/http-status-codes
  (last updated 2026-02-04)
- Apache HttpClient 4.5.x, `DefaultRedirectStrategy` —
  https://github.com/apache/httpcomponents-client/blob/4.5.x/httpclient/src/main/java/org/apache/http/impl/client/DefaultRedirectStrategy.java

### Verified facts

| Fact | Status |
|---|---|
| Google's crawlers follow up to 10 redirect hops, then give up | verified |
| **No RFC defines loop detection.** It is client behaviour, not a protocol requirement | verified (absence of spec) |
| Apache HttpClient detects loops by maintaining a set of URIs already visited in the chain and failing when a target repeats — not by comparing only consecutive hops | verified (reference implementation) |
| Apache normalises URI syntax before comparing against the visited set, when normalisation is enabled | verified |
| Apache resolves a relative `Location` against the request URI before comparing | verified |
| Loop detection is configurable in Apache and can be switched off — it is convention, not a universal | verified |
| A 3xx response with no `Location` header is a protocol error in its own right | verified |
| Hop ceilings across clients: Googlebot 10, browsers ~20, Node/undici ~20, Python requests ~30, cURL ~50. Googlebot is the strictest | corroborated, no single primary source |

## threshold

A redirect chain revisits any URL already seen in that chain.

**Detection is by visited-set membership, not consecutive comparison.**
A → B → A is a loop and would be missed by only checking whether each hop
differs from the one before it.

Loop detection is client convention with no spec behind it, so the specifics
below are a **SEORANKO product decision**, recorded as such:

- comparison is against the full visited set for the chain
- URLs are normalised before comparison, per the rules below
- a relative `Location` is resolved to an absolute URL before comparison
- the chain is abandoned at 10 hops even without a repeat. 10 is chosen
  because it matches Googlebot, the strictest of the common clients

### Normalisation — exactly what to do, and what not to

Normalise (safe; standard client behaviour):

- resolve relative `Location` to absolute
- lowercase the scheme and host
- resolve dot segments (`/a/b/../c` → `/a/c`)

Do **not** normalise (these must stay distinct):

- trailing slash — `/page` and `/page/` are different URLs
- path case — `/About` and `/about` are different URLs
- query parameters
- port

The second list is the whole guard. A server bouncing between `/page` and
`/page/` is a trailing-slash defect (topic 8), not a loop. Collapsing those
during comparison converts a real duplicate-URL finding into a false loop, and
loses the finding that actually matters.

## detect

1. Fetch without following redirects. Record status and `Location`.
2. Resolve `Location` to absolute, normalise, compare against the visited set.
3. Repeat set membership → loop. Record the full cycle, not just the repeat.
4. Stop at 10 hops regardless.
5. Re-fetch per topic 68 before raising.

**Separate finding:** a 3xx with no `Location` header. Not a loop — the chain
cannot continue at all. Report distinctly rather than folding it in.

## fix

None applied automatically. A loop means two or more redirect rules
contradict each other, and which one is wrong is the site owner's intent, not
a mechanical fact. The agent reports the full cycle and the rules that produce
it.

A self-redirect (A → A) is the one case where the transform is unambiguous:
remove the rule. Still `human-review` because it lives in shared build config.

## postcondition

Where a fix is applied: the origin URL resolves to a 200 within one hop on the
live response, asserted via a code path separate from the executor.

## idempotent?

n/a — no automatic transform.

## risk / blast radius

`next.config` / `vercel.json` — shared build config. A wrong edit here can
break every route.

## rollback

Revert commit.

## verdict

`human-review`. Report the cycle with every participating rule. Never
auto-resolve a contradiction between two deliberate rules.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Normalisation over-collapses — treating `/a` and `/a/`, or `/A` and `/a`, as the same URL when the server does not | never raise. These are topics 8 and 11, not loops |
| 2 | Loop depends on a cookie, session, auth state or geo header | not reproducible by a crawler. Human-review, state the dependency |
| 3 | A hop is produced by middleware | resolve via topic 70; `indeterminate` if not statically resolvable |
| 4 | Chain observed once only | re-fetch first (topic 68) |
| 5 | Chain exceeds 10 hops without repeating a URL | topic 4, not a loop |
| 6 | 3xx with no `Location` header | separate finding, not a loop |

### Explicitly rejected

- **Detecting loops by comparing consecutive hops only.** Misses A → B → A.
- **Auto-removing one rule from a multi-rule cycle.** Which rule is wrong is
  intent, not a mechanical fact.
- **Normalising aggressively to catch more loops.** Every normalisation that
  goes beyond what the server itself does converts a real duplicate-URL
  finding into a false loop.

## fixture

Synthetic repo with: a self-redirect A → A; a two-hop cycle A → B → A; a
three-hop cycle; an 11-hop chain with no repeat; a 3xx with no `Location`; a
`/a` → `/a/` redirect that must not be called a loop.

CI asserts: loops raised for the first three with full cycles recorded; the
11-hop routed to topic 4; the missing-`Location` raised as its own finding;
the trailing-slash redirect not raised here.

## Cross-references

- topic 4 — chains and the 10-hop limit
- topic 6 — 302 where 301 belongs
- topic 7 — redirect target not 200
- topic 8, 11 — trailing slash and case variants, which normalisation must not
  swallow
- topic 68 — evidence rules
- topic 70 — middleware resolution
