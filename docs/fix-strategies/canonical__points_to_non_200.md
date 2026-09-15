# canonical__points_to_non_200

Status: READY
Topic: 14 of the issue register
Tier: A
Shared facts: `_canonical_shared_facts.md` (C8, C10, C11, C17)
Research title: target_not_200 (topic 14).
Research date: 2026-09-15

---

## what's actually wrong

A page's canonical points at a URL that does not return 200.

## threshold

The declared canonical target returns a confirmed non-200 — 4xx, persistent
5xx, or a mechanically proven soft 404.

Google's guidance is direct: the target must exist and must not be a 404 or
soft 404 (C8). A canonical does not override the target's status (C10).

Confirmation rules are inherited, not re-invented: 4xx confirmed per topic 68,
5xx persistence per topic 3, soft 404 per topic 2a only.

**Also a finding:** the target itself redirects. Google advises pointing
directly at the final healthy URL (C17). That is a canonical chain, reported
separately from a dead target.

## detect

1. Extract the declared canonical (HTML and header).
2. Fetch the target without following redirects.
3. Classify: 200 → pass. 3xx → canonical chain. 4xx/5xx → dead target.
   200-with-injected-noindex → soft 404 (topic 2a).
4. Re-fetch per topic 68.

## fix

Repoint the canonical to the correct live URL, or remove it where the page
should carry a self-referential canonical instead.

For a chain, repoint to the chain's final 200 target.

## postcondition

Live: the canonical target returns 200 in zero redirects.

## idempotent?

Yes for removal or self-reference. No for repointing to another URL, which
breaks if that URL later moves.

## risk / blast radius

Page file. Layout-level declaration affects all children.

## rollback

Revert.

## verdict

`auto-fixable` where the fix is a self-referential canonical on a single page
file and the page's own URL returns 200.

`human-review` where repointing to a different URL, since which URL is
correct is intent.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Target observed non-200 once only | re-fetch first (topic 68) |
| 2 | Target 5xx is transient | availability problem (topic 3). Never raise here |
| 3 | Soft-404 target is 2b (unprovable) | report as potential. Never auto-fix |
| 4 | Target is cross-domain and unreachable from the crawler | topic 18. Do not treat as dead |
| 5 | Target is a non-HTML resource returning 200 | valid. Not a finding |
| 6 | `generateMetadata` sets it conditionally | `indeterminate` |

### Explicitly rejected

- **Repointing the canonical to the homepage.** Same error as topic 7 —
  creates a soft-404 pattern, and violates C4 (target must be duplicate or a
  superset).
- **Leaving the dead canonical and adding a second one.** Creates topic 17.

## fixture

Canonical to a confirmed 404; to a transient 5xx; to a 301; to a streamed soft
404; to a healthy 200; to a valid PDF.

CI asserts: raised for the first and fourth; routed to topic 3 for the second;
raised as a chain for the third; suppressed for the fifth and sixth.

## Cross-references

- topics 2a, 3, 68 supply confirmation; topic 15 noindexed target;
  topic 18 cross-domain
