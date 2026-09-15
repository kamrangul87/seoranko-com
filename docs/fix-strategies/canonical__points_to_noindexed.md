# canonical__points_to_noindexed

Status: READY
Topic: 15 of the issue register
Tier: A
Shared facts: `_canonical_shared_facts.md` (C9, C10, C11)
Research title: target_noindexed (topic 15).
Research date: 2026-09-15

---

## what's actually wrong

A page's canonical points at a URL that carries `noindex` — the site
simultaneously asks Google to consolidate onto a page and to exclude that
page.

## threshold

The canonical target returns 200 and declares `noindex`, where the
declaration is genuine rather than injected.

**The discriminator from topic 70 is mandatory here.** A target returning 200
with `noindex` is either:

- a deliberately excluded page — **this finding**, a contradictory
  configuration
- a streamed not-found render — **topic 14**, a dead target

The repo-declared-`noindex` check separates them. Without it this topic cannot
be distinguished from topic 14 on a Next.js site.

Google's guidance: the target must not contain `noindex` (C9), and the
canonical does not override it (C10).

## detect

1. Extract the declared canonical.
2. Fetch the target. If 200, check for `noindex` in the meta robots tag and
   the `X-Robots-Tag` header.
3. Run the topic 70 declaration check on the target's route.
   - repo declares it → this finding
   - repo does not → topic 14 (dead target)
   - conditional `generateMetadata` → `indeterminate`

## fix

Two branches, and the choice is intent:

- the target should be indexable → remove `noindex` from the target
- the target is correctly excluded → the canonical is wrong; repoint it or
  make it self-referential

The agent does not choose. Both are proposed with the contradiction stated.

## postcondition

Live: either the canonical target returns 200 without `noindex`, or the source
page's canonical no longer points at a `noindex` URL.

## idempotent?

Yes.

## risk / blast radius

Two files potentially — the source page's canonical and the target's metadata.
Removing `noindex` from a page makes it indexable, which is a visibility
change, not just a technical fix.

## rollback

Revert.

## verdict

`human-review`, always. Whether the target should be indexed is a
business decision. Removing a `noindex` the owner deliberately set is worse
than leaving the contradiction in place.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | The `noindex` is injected, not repo-declared | topic 14, not this finding |
| 2 | `noindex` comes from a `layout.tsx` above the target | report the cascade source, not the page |
| 3 | Target's `generateMetadata` sets robots conditionally | `indeterminate` |
| 4 | `X-Robots-Tag` header disagrees with the meta tag | topic 20 first; resolve that before this |
| 5 | Target is cross-domain | topic 18; the crawler may not see its real directives |

### Explicitly rejected

- **Auto-removing `noindex` from the target.** A deliberate exclusion is a
  business decision. This is the single highest-risk auto-fix in the canonical
  block and it is not taken.
- **Auto-repointing the canonical.** Which of the two intentions is correct is
  unknowable mechanically.

## fixture

Canonical to a repo-declared noindex page; to a page with injected noindex; to
a page noindexed via layout cascade; to a page with conflicting header and
meta; to a healthy indexable page.

CI asserts: human-review for the first; routed to topic 14 for the second;
cascade source reported for the third; routed to topic 20 for the fourth;
suppressed for the fifth.

## Cross-references

- topic 14 dead target; topic 20 directive conflict; topic 70 discriminator
