# canonical__cross_domain_unrelated

Status: READY
Topic: 18 of the issue register
Tier: A
Shared facts: `_canonical_shared_facts.md` (C13–C16)
Research title: cross_domain_target (topic 18).
Research date: 2026-09-15

---

## what's actually wrong

A page's canonical points at a URL on a different host or domain.

## threshold

**Cross-domain canonical is not itself a defect.** RFC 6596 permits a target
on another host, and Google documents support for it (C13). Flagging every
cross-domain canonical as invalid would be wrong.

The finding is a cross-domain canonical that **fails its documented
conditions** (C14):

- content is not substantially duplicate or equivalent
- the mapping is not one-to-one — many pages pointing at one target on the
  other domain, typically its homepage
- the target is not crawlable, indexable or healthy

Where those cannot be established, the verdict is `human-review` rather than a
finding. Ownership of the other domain is not something the crawler can
determine.

Two further documented points:

- for an actual domain migration, Google prefers permanent redirects over
  cross-domain canonical (C15)
- Google's current troubleshooting guidance does not recommend canonical tags
  for syndicated content, because partner pages are often too different (C16)

## detect

1. Extract the canonical; compare host against the source host.
2. Different host → cross-domain. Fetch the target.
3. Check: target status, its directives, content similarity to the source, and
   how many source URLs point at this single target.
4. Many-to-one mapping is the strongest mechanical signal of misuse.

## fix

None applied automatically. The agent reports the failed condition and the
evidence.

Where the pattern is a migration (many pages, one-to-one, whole site), the
proposal is permanent redirects instead (C15) — proposed, not applied, since
it is a site-wide change.

## postcondition

Where a fix is applied: the canonical target returns 200, is indexable, and
the mapping is one-to-one.

## idempotent?

n/a — no automatic transform.

## risk / blast radius

Removing or repointing a cross-domain canonical changes which domain Google
consolidates onto. Getting it wrong affects an entire property, and the other
domain may not be under the user's control at all.

## rollback

Revert. Note that consolidation decisions Google has already made do not
revert with the commit.

## verdict

`human-review`, always. Ownership and content equivalence cannot be
established mechanically, and the blast radius spans two properties.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Cross-domain canonical with equivalent content and one-to-one mapping | valid configuration. Never raise |
| 2 | The other domain is not reachable from the crawler | unknown, not invalid. Human-review, state the limitation |
| 3 | Both hosts are the same property (www/non-www, or a subdomain of the same site) | topic 10, not this finding |
| 4 | Content similarity cannot be computed (target blocked, JS-rendered, auth-gated) | `indeterminate` |
| 5 | Syndicated content arrangement | C16 applies; report, do not propose a transform |
| 6 | Target is non-200 or noindexed | topics 14 and 15 first |

### Explicitly rejected

- **Flagging all cross-domain canonicals as errors.** Explicitly permitted by
  spec and by Google.
- **Inferring domain ownership.** Not mechanically knowable.
- **Auto-applying redirects for a suspected migration.** Site-wide, spans two
  properties.
- **Claiming signal or equity transfer between domains.** Not Google's
  vocabulary.

## fixture

Cross-domain canonical with equivalent content, one-to-one; many pages
pointing at one cross-domain homepage; cross-domain target returning 404;
www-to-bare-domain canonical; an unreachable target.

CI asserts: suppressed for the first; raised for the second; routed to topic
14 for the third; routed to topic 10 for the fourth; `indeterminate` for the
fifth.

## Cross-references

- topics 10, 14, 15; topic 12 for content-similarity comparison
