# performance__missing_cache_control

Status: READY — reframed by P24
Topic: 53 of the issue register
Tier: A-minus
Shared facts: `_performance_adjacent_shared_facts.md`
Research title: perf__caching_headers_on_static_assets (topic 53).
Research date: 2026-09-15

---

## what's actually wrong

Less than the topic title implies, and not what most advice says.

## the reframing, stated first

**Google states the Web Rendering Service's resource-cache lifetime is
unaffected by HTTP caching directives** (P24). WRS caches JS and CSS
aggressively and may hold them up to 30 days regardless of what
`Cache-Control` says.

So the common claim — that setting `Cache-Control` on static assets controls
how long Google holds them — is **wrong**, and any finding built on it is
unfounded. The reliable mechanism for getting updated resources picked up is
content fingerprinting in the filename (P25).

`Cache-Control` still matters for ordinary Googlebot HTTP fetching (P22, P23)
and for real users. But it is not the lever on WRS.

## threshold

| Condition | Source | Severity |
|---|---|---|
| static asset served with no `Cache-Control`, no `ETag` and no `Last-Modified` | P22 | low — no conditional-request mechanism available at all |
| asset has `ETag` or `Last-Modified` but no `Cache-Control` | P22 | **none.** Conditional requests work |
| fingerprinted asset (content hash in filename) served with a short `max-age` | P23, P25 | low — `max-age` should reflect the expected unchanged lifetime, and a fingerprinted file never changes |
| non-fingerprinted JS/CSS with a long `max-age` | P23 | moderate — updates will not be seen by browsers for that period |
| resource URL changes on every build without content changing | P26 | moderate — unnecessary cache-busting consumes crawl resources |
| JS/CSS required for rendering is robots-blocked | P27 | topic 21, not this finding |

The fifth row is the one worth having and is rarely checked: build tooling
that re-hashes unchanged files creates new URLs each deploy, which P26
explicitly advises against.

## detect

1. Collect same-origin static asset URLs referenced by the served HTML.
2. Fetch each; record `Cache-Control`, `ETag`, `Last-Modified`.
3. Detect fingerprinting by filename pattern — a content-hash segment.
4. To detect row five, compare asset URLs across two deploys and check whether
   a changed URL corresponds to changed content. **This requires two
   observations over time**, so it is not available on a first crawl. Record
   that explicitly rather than reporting a false negative.

## fix

- **fingerprinted asset with short `max-age`** → set a long `max-age` with
  `immutable`. Deterministic: a content-hashed filename cannot change content.
- **non-fingerprinted JS/CSS with long `max-age`** → `human-review`. The
  correct answer is usually to add fingerprinting, which is a build-config
  change, not a header change.
- **no conditional-request mechanism at all** → enabling `ETag` is usually a
  platform setting rather than a repo change. Report.
- **URL churn without content change** → build-config problem. Report with
  the evidence from both deploys.

## postcondition

Live: the asset's response headers carry the intended `Cache-Control` value.
Asserted against the live response, not against `next.config`.

That distinction matters here more than anywhere: a headers block in
`vercel.json` or `next.config` is an intention, not a served header.

## idempotent?

Yes.

## risk / blast radius

Header rules are matched by pattern and typically cover **whole directories**.
A long `immutable` `max-age` applied to a non-fingerprinted file makes stale
content unfixable for that period without renaming the file — the highest-cost
error in this topic.

## rollback

Revert. Note that browsers already holding a long-`max-age` response will
continue to do so; rollback does not reach them. Same irreversibility class as
the 301 in topic 6.

## verdict

`auto-fixable` only for lengthening `max-age` on a demonstrably fingerprinted
asset.

`human-review` for everything else.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | A claim that `Cache-Control` controls WRS resource caching | **wrong** (P24). Remove the claim |
| 2 | A claim that `Cache-Control` controls Googlebot re-crawl frequency | not supported (P22, P23) |
| 3 | Asset has `ETag` or `Last-Modified` | conditional requests work. Never raise for absent `Cache-Control` alone |
| 4 | Fingerprinting assumed from a filename that merely contains digits | require a real content-hash pattern; a wrong assumption leads to an `immutable` header on a mutable file |
| 5 | Asset is third-party | no repo transform. Report only |
| 6 | Postcondition asserted against config rather than the served header | invalid. Assert the live response |
| 7 | URL churn reported from a single crawl | needs two observations. State the limitation |
| 8 | A performance metric improvement is claimed | not assertable |

### Explicitly rejected

- **Claiming caching headers control WRS resource lifetime.** P24.
- **Claiming `Cache-Control` affects crawl scheduling.**
- **Applying `immutable` to a non-fingerprinted asset.** Highest-cost error
  here.
- **Asserting the postcondition against `next.config` or `vercel.json`.**
- **Any metric claim.**

## fixture

A fingerprinted asset with `max-age=60`; an asset with `ETag` and no
`Cache-Control`; a non-fingerprinted `main.js` with `max-age=31536000`; an
asset named `logo2024.png` (digits, not a hash); a third-party script; an
asset with no `Cache-Control`, `ETag` or `Last-Modified`.

CI asserts: auto-fix for the first; **nothing** for the second; `human-review`
for the third; no fingerprinting assumed for the fourth; report-only for the
fifth; low severity for the sixth. Postcondition asserted against served
headers in every case.

## Cross-references

- topic 21 (P27, robots-blocked resources); topic 6 (irreversibility class);
  topic 61; topic 70
