# redirect__302_where_301_correct

Status: READY
Topic: 6 of the issue register
Tier: A
Depends on: topic 68, topic 70
Research dates: 2026-09-14

---

## what's actually wrong

A permanent move is served with a temporary redirect status, so Google treats
the destination as a weak signal rather than a strong one.

## primary source

- Google, How HTTP status codes affect Google's crawlers —
  https://developers.google.com/crawling/docs/troubleshooting/http-status-codes
  (page last updated 2026-02-04)

### Verified facts

| Fact | Status |
|---|---|
| `301` — Google follows the redirect and uses it as a **strong** signal that the target should be processed | verified |
| `308` — equivalent to `301` | verified |
| `302` — Google follows it and uses it as a **weak** signal | verified |
| `307` — equivalent to `302` | verified |
| Google treats these codes the same way in mechanism, but they are semantically different; use the appropriate code so other clients benefit | verified |

This is the whole threshold, from a primary source, in Google's own wording:
strong signal versus weak signal. Not "302 hurts rankings" — no such claim is
made and none should be repeated.

## threshold

A redirect serves 302 or 307, **and** the move is permanent.

Permanence is the hard part. SEORANKO cannot read intent from a status code —
that is precisely what the status code was supposed to declare. Mechanical
evidence that a move is permanent:

- the origin route no longer exists in the repo (topic 70)
- the same 302 has been observed across separate crawls over time
- the redirect is declared statically in `next.config` / `vercel.json` rather
  than produced at runtime

Without at least one of these, the finding is not raised.

## detect

1. Record the status of each redirect hop (shared with topic 4).
2. Where the status is 302 or 307, gather the permanence evidence above.
3. Re-fetch per topic 68.

## fix

Change the declared status from 302/307 to 301/308 in the repo's redirect
config.

## postcondition

Live response for the origin URL returns 301 (or 308), asserted via a code
path separate from the executor.

## idempotent?

Yes.

## risk / blast radius

`next.config` / `vercel.json` — shared build config.

The asymmetry matters for autonomy: a wrongly-applied 301 is **cached by
browsers and hard to reverse**, whereas a 302 left in place merely produces a
weaker signal. The cost of a false positive here is much higher than the cost
of missing one.

## rollback

Revert commit. Note that browsers may have cached the 301; rollback does not
clear client caches.

## verdict

`human-review`. The permanence judgement is the site owner's, not the agent's,
and the failure is asymmetric — see blast radius. Present the evidence and the
proposed diff; do not apply automatically.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | The move is genuinely temporary — maintenance, seasonal, A/B test, geo routing | never raise. 302 is correct |
| 2 | Redirect is produced at runtime by middleware | resolve via topic 70; `indeterminate` if not statically resolvable |
| 3 | Origin route still exists in the repo | the move may not be permanent. Do not raise |
| 4 | Observed on a single crawl | insufficient. Needs repeat observation |
| 5 | Redirect target is not 200 | topic 7, not this finding |

### Explicitly rejected

- **Claiming 302 harms rankings.** Google says weak signal, not penalty.
- **Inferring permanence from the status code alone.** Circular — the status
  code is the thing being questioned.
- **Auto-applying the change.** A 301 is browser-cached and effectively
  irreversible for returning visitors.

## fixture

Synthetic repo with: a 302 whose origin route was deleted from the repo; a 302
whose origin route still exists; a 307 produced by middleware; a correct 301.

CI asserts: human-review with evidence for the first; suppressed for the
second; `indeterminate` for the third; nothing for the fourth.

## Cross-references

- topic 4 — chains, shares the hop-recording detect step
- topic 5 — loops
- topic 7 — redirect target not 200
- topic 70 — middleware resolution
