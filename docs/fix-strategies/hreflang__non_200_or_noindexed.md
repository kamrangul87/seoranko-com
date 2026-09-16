# hreflang__non_200_or_noindexed

Status: READY
Topic: 48 of the issue register
Tier: A
Shared facts: `_hreflang_shared_facts.md`
Research title: hreflang__target_not_indexable (topic 48).
Research date: 2026-09-15

---

## what's actually wrong

An hreflang annotation points at a URL that cannot serve as a localized
alternate — it errors, redirects unexpectedly, is blocked from crawling, or is
`noindex`.

## threshold

The declared alternate target fails to be a healthy indexable page.

Confirmation rules are inherited, never reinvented:

| Target state | Classifier | Severity |
|---|---|---|
| confirmed 4xx | topic 68 | high |
| persistent 5xx | topic 3 | high |
| redirects | topics 4, 7 | moderate — annotation should name the final URL |
| repo-declared `noindex` | topic 70 | high — contradicts the cluster |
| 200 with injected `noindex` | topic 2a | high — the page is gone |
| disallowed for Googlebot in robots.txt | topic 21 matcher | high — the annotation cannot be read |
| relative rather than fully qualified | G3 | high — unusable |
| 200, indexable, self-canonical | — | correct |

**One additional condition specific to this topic**, and it is the one most
often missed:

| Condition | Source | Severity |
|---|---|---|
| the alternate canonicalises to a **different language's** page | G22 | high |

G22 is explicit: canonicalizing every translation to one language can defeat
the cluster. So a localized page whose canonical points at the primary-language
version is a real defect even though every URL returns 200 and the annotations
are perfectly reciprocal. Nothing else in the block catches this.

## detect

1. Collect alternates from all three methods (G1).
2. Validate each target is fully qualified (G3).
3. Fetch each without following redirects; classify via the inherited
   detectors.
4. Evaluate each against the robots.txt matcher for Googlebot (topic 21).
5. **Read each alternate's own canonical.** Self-canonical or canonical within
   its own locale → correct. Canonical pointing at another locale's page →
   G22 finding.
6. Re-fetch per topic 68.

## fix

- **relative URL** → make absolute. Deterministic.
- **target redirects, single hop to a healthy 200** → repoint the annotation
  at the final URL. Deterministic.
- **target confirmed 4xx** → remove that locale from the cluster, and remove
  the reciprocal annotations on the other members. **Both sides**, or topic 46
  fires on the remnant.
- **target repo-declared `noindex`** → `human-review`. Either the page should
  be indexable or it should leave the cluster; that is intent.
- **robots-disallowed target** → `human-review`. Same reasoning as topic 21 —
  unblocking has implications the agent cannot assess.
- **cross-locale canonical (G22)** → `human-review`. Making a translation
  self-canonical changes what Google indexes, which is a deliberate decision.

## postcondition

Live: every alternate target in the served response is fully qualified,
returns 200 in zero redirects, is allowed for Googlebot, carries no `noindex`,
and canonicalises within its own locale.

## idempotent?

Yes for absolutisation and removal. No for repointing.

## risk / blast radius

Removing a locale from a cluster touches **every member of the cluster**, not
one page. A partial removal creates the topic 46 defect, so the fix is
inherently multi-file and must be applied atomically.

## rollback

Revert. Confirm the cluster is reciprocal again after rollback.

## verdict

`auto-fixable` for absolutising a relative alternate and repointing a
single-hop redirect.

`human-review` for removing a locale from a cluster (multi-file, atomic), for
`noindex` and robots-disallowed targets, and for cross-locale canonicals.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Target observed non-200 once | re-fetch first (topic 68) |
| 2 | 5xx transient | topic 3. Never raise here |
| 3 | Target is cross-domain and unreachable from the crawler | unknown, not broken (G3 permits cross-domain). State the limitation |
| 4 | `noindex` is injected, not declared | topic 2a — the page is gone, not excluded |
| 5 | `x-default` target is a redirecting or dynamically localized homepage | **explicitly permitted** (G18). Never raise |
| 6 | Alternate canonicalises to itself | correct. Never raise |
| 7 | Locale removal applied to one page only | creates topic 46. Must be atomic across the cluster |
| 8 | Annotation is in the sitemap only | still valid (G1). Assess it |
| 9 | Target disallowed for a non-Googlebot agent | evaluate for Googlebot specifically |

### Explicitly rejected

- **Flagging an `x-default` pointing at a redirecting homepage.** G18 permits
  exactly that. Likely the most common false positive in this topic.
- **Removing one side of a cluster edge.** Creates a worse defect.
- **Auto-changing a localized page's canonical.** G22 identifies the problem;
  the resolution is a decision about what gets indexed.
- **Auto-editing robots.txt to unblock an alternate.** Topic 22 blast radius.

## fixture

Alternate returning confirmed 404; a relative alternate URL; an alternate
redirecting once to 200; an alternate with repo-declared `noindex`; an
`x-default` pointing at a redirecting homepage; an alternate canonicalising to
the English version; an alternate disallowed for Googlebot; an alternate
declared only in the sitemap and healthy.

CI asserts: `human-review` atomic removal for the first; auto-fix for the
second and third; `human-review` for the fourth, sixth and seventh;
**nothing** for the fifth and eighth.

## Cross-references

- topics 46, 47; topics 2a, 3, 4, 7, 21, 68, 70 supply classification;
  topics 13–18 for the G22 canonical interaction
