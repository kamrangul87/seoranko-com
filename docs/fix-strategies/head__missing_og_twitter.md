# head__missing_og_twitter

Status: READY — Open Graph researched; Twitter Card portion NOT RESEARCHED
Topic: 32 of the issue register
Tier: A
Shared facts: `_head_shared_facts.md`
Research title: open_graph_and_twitter_tags_missing (topic 32).
Research date: 2026-09-15

---

## what's actually wrong

Open Graph properties required by the protocol are absent or incomplete.

## threshold

**Scope first: this is a social-preview finding, not an indexing one.** Missing
Open Graph metadata is not by itself a Google indexing failure (H23). The
dossier must not claim a Search consequence. The one Search-adjacent link is
that Google may use `og:title` as one of its title-link sources (H11).

The protocol requires four properties (H19):

| Condition | Source | Severity |
|---|---|---|
| any of `og:title`, `og:type`, `og:image`, `og:url` absent | H19 | high (social preview) |
| `og:image` present without `og:image:alt` | H21 | low — "should", not "must" |
| `og:url` present but not absolute | H19 | high — unusable as a graph identifier |
| `og:url` disagrees with the page's canonical | — | moderate. **See guard 4** |
| `og:description`, `og:site_name`, `og:locale` absent | H20 | **none.** Optional |
| duplicate `og:` property with conflicting values | H22 | moderate — first declaration wins, which is protocol-defined |

Twitter Card tags: no primary specification was verified in this research pass.
**Twitter/X card requirements are recorded as NOT RESEARCHED** and no
threshold is set for them. Consumers fall back to Open Graph in practice, but
that is not a sourced claim and is not encoded here.

## detect

1. Parse with a real parser; take `<head>` as the parser sees it (topic 29).
2. Collect all `meta property="og:*"` elements. Note these use `property`, not
   `name` — a detector looking only at `name` finds none of them.
3. Check the four required properties, `og:image:alt` presence, `og:url`
   absoluteness.
4. Where a property repeats, record the first value as effective (H22).

## fix

- **`og:url` relative** → make absolute. Deterministic.
- **`og:url` absent** → the page's own canonical URL is a defensible value,
  since both identify the preferred URL for the page. Deterministic where a
  canonical exists.
- **`og:type` absent** → `website` is the protocol's general default for a
  page. Low-risk, but it is a content decision for `article`-type pages, so
  propose rather than apply where the page is plausibly an article.
- **`og:title` absent** → scaffold from the page's `<title>`. Proposal, not a
  fix — it is content.
- **`og:image` absent** → **no fix.** Choosing an image is a content decision
  and there is no defensible mechanical source.
- **duplicate conflicting properties** → remove the later ones, since the
  first is authoritative by protocol (H22). Deterministic — and note this is
  the opposite of topic 31, where no such rule exists (H30).

## postcondition

Live: all four required `og:` properties present, `og:url` absolute, and no
conflicting duplicates of any `og:` property.

## idempotent?

Yes.

## risk / blast radius

Usually a shared layout or metadata helper, so a fix applies across the site.
An `og:image` set in a layout is a site-wide default and often intended.

## rollback

Revert.

## verdict

`auto-fixable` for: making `og:url` absolute, deriving `og:url` from an
existing canonical, and removing later conflicting duplicates.

`human-review` for `og:title`, `og:type` on article-like pages, and anything
requiring an image.

`not_mechanically_fixable` for `og:image` absence.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Only optional properties absent (`og:description`, `og:site_name`, `og:locale`) | optional (H20). Never raise |
| 2 | `og:image:alt` absent | "should" not "must" (H21). Low severity, never auto-fix |
| 3 | Detector searched `name=` instead of `property=` | detector is invalid; Open Graph uses `property` |
| 4 | `og:url` differs from the canonical deliberately | possible in syndication or campaign contexts. Moderate, human-review, never auto-rewrite |
| 5 | Any Search or ranking consequence claimed | not supported (H23) |
| 6 | Twitter Card tags absent | **NOT RESEARCHED.** No threshold. Do not raise |
| 7 | Page is `noindex` or non-200 | still may be shared socially — but deprioritise; never auto-fix |
| 8 | Tags moved out of `<head>` by implicit closing | topic 29 |

### Explicitly rejected

- **Claiming a Google indexing or ranking impact.** H23.
- **Setting `og:image` mechanically.** No defensible source for the choice.
- **Setting Twitter Card thresholds from this research pass.** Unsourced.
- **Applying H22's first-wins rule to HTML meta descriptions.** H30 — the
  rules are different and must not be shared.

## Open questions

1. Twitter/X Card specification — required properties, and whether `twitter:*`
   tags are still honoured or fall back to Open Graph. Needs its own research
   pass before any threshold is set.

## fixture

Page missing `og:image`; missing `og:url`; with a relative `og:url`; missing
only `og:description`; with two `og:title` values; with `og:image` and no
`og:image:alt`; with no `twitter:*` tags at all.

CI asserts: `not_mechanically_fixable` for the first; auto-fix from canonical
for the second; auto-fix for the third; nothing for the fourth; auto-fix
removing the later duplicate for the fifth; low severity for the sixth;
**nothing** for the seventh.

## Cross-references

- topics 29, 30, 31 (H22 vs H30); canonical block for `og:url` derivation
