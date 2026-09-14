# redirect__target_not_200

Status: READY
Topic: 7 of the issue register
Tier: A
Depends on: topics 68, 70, and the terminal classification from topics 2, 3
Research dates: 2026-09-14

---

## what's actually wrong

A redirect resolves to a terminal response that is not an indexable 200, so
the redirect sends users and crawlers to an error or an excluded page.

## primary source

- Google, How HTTP status codes affect Google's crawlers —
  https://developers.google.com/crawling/docs/troubleshooting/http-status-codes
- Google, Redirects and Google Search —
  https://developers.google.com/search/docs/crawling-indexing/301-redirects
- Google, Page indexing report —
  https://support.google.com/webmasters/answer/7440203
- Google, Block indexing with noindex —
  https://developers.google.com/search/docs/crawling-indexing/block-indexing

### Verified facts

| Fact | Status |
|---|---|
| Content received from the redirecting URL is ignored; the final target URL's content is processed instead | verified |
| Search Console states the redirecting URL will not be indexed, and the target may or may not be, depending on Google's assessment of the target | verified |
| A terminal 4xx: content ignored, not indexed, and an already-indexed URL is removed over time | verified |
| A terminal 5xx or 429: content ignored, crawling slows, an indexed URL is preserved then eventually dropped if failures persist | verified |
| A terminal 200 carrying `noindex`: the target is excluded from results | verified |
| Loops, excessive chains and malformed targets are reported as Redirect error in Search Console | verified |

**Google publishes no single statement covering every redirect-to-error
combination.** The threshold below is a composition of the documented redirect
behaviour and the documented behaviour of each terminal status.

**Not adopted:** "the chain is wasted", percentage claims about signal or
equity transfer, and "useless for ranking". None of this is Google's wording
and none of it is sourced. It is also wrong for temporary redirects, where the
source URL may continue to be shown.

## threshold

Follow the chain, then **classify the terminal response independently**.

Raise `redirect-target-error` when the terminal URL is:

- a confirmed 4xx (confirmed per topic 68 — re-fetched)
- a persistent 5xx (persistent per topic 3 — not transient)
- a 200 carrying `noindex` that the repo does not declare (topic 70)
- a mechanically proven soft 404 (topic 2a only — never 2b)

Do not raise on a terminal 200 that the repo declares `noindex` for. That is a
deliberate exclusion, and redirecting to it may be intentional.

## detect

1. Follow the chain, recording each hop (shared with topics 4 and 5).
2. Stop at the terminal non-3xx response, a loop, or 10 hops.
3. Classify the terminal response by the rules above, reusing the existing
   detectors rather than reimplementing them.
4. Re-fetch per topic 68 before raising.

## fix

Two branches, decided by evidence — the same decision the topic 41 tree makes:

- **Repoint the redirect** to a live equivalent, where exactly one successor
  clears the similarity floor.
- **Remove the redirect**, letting the origin URL return its honest status,
  where the destination is genuinely gone and no successor exists. A 404 is a
  correct answer; a redirect to a 404 is not.

Recreating the destination is scaffold-only, as elsewhere.

## postcondition

Live response for the origin URL either resolves to a 200 in one hop, or
returns the honest terminal status directly with no redirect. Asserted via a
code path separate from the executor.

## idempotent?

**No** for the repoint branch — breaks if the new target later moves. Yes for
the removal branch.

## risk / blast radius

`next.config` / `vercel.json` — shared build config.

## rollback

Revert commit. For the repoint branch, confirm no chain or loop was
introduced.

## verdict

`human-review` by default. Both branches touch shared build config, and
choosing between repoint and remove is the same intent question as topic 41.

`auto-fixable` only in the removal case where the redirect is a plain static
rule, the terminal URL is a confirmed 4xx on re-fetch, and no successor
candidate clears the floor.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Terminal 200 carries `noindex` and the repo declares it | deliberate exclusion. Never raise |
| 2 | Terminal 5xx is transient, not persistent | availability problem (topic 3). Never raise here |
| 3 | Terminal condition is a 2b soft 404 (error-like content, no provable signature) | report as potential only. Never auto-fix |
| 4 | Redirect is temporary (302/307) to a target that is temporarily unavailable | may be deliberate. Human-review, state the reason |
| 5 | A hop is produced by middleware | resolve via topic 70; `indeterminate` if not statically resolvable |
| 6 | Terminal observed once only | re-fetch first (topic 68) |
| 7 | Chain loops or exceeds 10 hops before reaching a terminal | topics 5 and 4, not this finding |

### Explicitly rejected

- **Claiming lost ranking signal or equity.** Not Google's vocabulary, no
  published figures.
- **Treating redirect-to-404 as automatically worse than a plain 404.** Both
  end in a 4xx; the finding is that a rule exists pointing at nothing, not
  that Google punishes the chain.
- **Auto-repointing to the homepage.** A deleted page redirected to a generic
  homepage is a classic soft-404 cause, not a fix.

## fixture

Synthetic repo with: a redirect to a confirmed 404; a redirect to a 200 with
repo-declared `noindex`; a redirect to a 200 with injected `noindex` (streamed
soft 404); a redirect to a transient 5xx; a 302 to a temporarily unavailable
target; a redirect to a healthy 200.

CI asserts: raised for the first and third; suppressed for the second and
sixth; routed to topic 3 for the fourth; human-review for the fifth.

## Cross-references

- topic 2 — terminal soft-404 classification, 2a only
- topic 3 — terminal 5xx persistence
- topics 4, 5 — chain and loop handling, shared detect step
- topic 6 — 302 where 301 belongs
- topic 41 — the repoint / remove / recreate decision
- topics 68, 70
