# redirect__chains

Status: READY
Topic: 4 of the issue register
Tier: A
Depends on: topic 68 (re-fetch rule), topic 70 (site model)
Research dates: 2026-09-14

---

## what's actually wrong

A URL redirects to another URL which itself redirects, so reaching the final
destination takes more than one hop.

## primary source

- Google, How HTTP status codes affect Google's crawlers —
  https://developers.google.com/crawling/docs/troubleshooting/http-status-codes
  (page last updated 2026-02-04)

### Verified facts

| Fact | Status |
|---|---|
| Google's crawlers follow **up to 10 redirect hops** by default | verified |
| Googlebot generally follows 10 hops for general web content; specific products' crawlers may differ | verified |
| **Google Inspection Tools does not follow redirects at all** | verified |
| Content received from a redirecting URL is ignored; only the final target URL's content is processed | verified |
| Search Console generates error messages for failed redirections (3xx) | verified |

## threshold

Severity bands use Google's own soft numbers from N15
(`_internal_links_shared_facts.md`) plus the hard abandon limit:

| Chain length (hops) | Severity | Basis |
|---|---|---|
| 1 | none | direct redirect; not this finding |
| 2–3 | moderate | within Google's "ideally no more than 3" (N15) |
| 4 | high | beyond ideal, approaching "fewer than 5" (N15) |
| 5–10 | high | outside the soft advice; still followed up to 10 |
| more than 10 | **hard failure** | Google abandons the chain; destination never reached |

Google follows chains of 2 or more hops, so lengths ≤10 are not breakage —
they are avoidable indirection. Report quality findings below the hard
failure, and never claim a ranking effect.

The 10-hop number is Google's hard limit, not a target. Do not present 9 hops
as acceptable, and do not treat 2–10 as one undifferentiated band.

## detect

1. Fetch the URL without following redirects. Record each hop's status and
   `Location` header in order.
2. Continue until a non-3xx response, a repeat URL (loop — topic 5), or 10
   hops.
3. Record: chain length, each intermediate status, the final status.
4. Re-fetch per topic 68 before raising.

## fix

Rewrite the originating redirect to point directly at the final 200 target,
collapsing the chain to one hop.

Where the chain originates from internal links rather than server redirects,
the correct fix is topic 42 — update the links, not the redirects.

## postcondition

Asserted on the live response, via a code path separate from the executor: the
original URL returns a single 3xx whose `Location` target returns 200 in one
hop.

## idempotent?

**No.** If the final target later moves, the collapsed redirect breaks. The
fix must re-verify the target resolves at the time of application, and a
self-redirect guard must run (topic 5).

## risk / blast radius

`next.config` / `vercel.json` — shared build config, affects all routes.
Lower autonomy cap than a single-file edit.

## rollback

Revert commit. Confirm no new chain or loop was introduced.

## verdict

`human-review` by default. Build-config blast radius, not idempotent, and
collapsing a chain can change behaviour if an intermediate hop was doing
something deliberate (locale detection, A/B split).

`auto-fixable` only where every hop is a plain static redirect in the repo's
own config and the final target returns 200 on re-fetch.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | An intermediate hop performs work — locale routing, auth, A/B split | never collapse. Human-review |
| 2 | A hop is produced by middleware rather than static config | resolve via topic 70; `indeterminate` if not statically resolvable |
| 3 | Final target does not return 200 | this is topic 7, not this finding |
| 4 | Chain revisits a URL already seen | this is topic 5 (loop), not this finding |
| 5 | Chain observed once only | re-fetch first (topic 68) |
| 6 | Redirect is external (different host) | out of scope; no repo transform exists |

### Explicitly rejected

- **Treating any chain as breakage.** Google follows up to 10 hops. A 2-hop
  chain is indirection, not failure.
- **Claiming a ranking effect from chain length.** No source.

## fixture

Synthetic repo with: a 3-hop chain ending at 200; a 2-hop chain where the
middle hop is middleware; an 11-hop chain; a 1-hop redirect to 200; a chain
ending at 404.

CI asserts: hard failure raised for the 11-hop; moderate quality finding for
the 3-hop (N15 ideal band); high quality finding for a 4–5 hop chain;
`indeterminate` for the middleware chain; nothing for the 1-hop; the
404-ending chain routed to topic 7.

## Cross-references

- topic 5 — loops and self-redirects
- topic 6 — 302 where 301 belongs
- topic 7 — redirect target not 200
- topic 42 — internal links pointing at redirects (same N15 bands on the link)
- N15 in `_internal_links_shared_facts.md` — soft ≤3 / &lt;5 guidance
- topic 68 — evidence rules
- topic 70 — middleware resolution
