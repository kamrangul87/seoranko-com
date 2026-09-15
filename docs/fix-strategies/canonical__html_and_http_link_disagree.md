# canonical__html_and_http_link_disagree

Status: READY
Topic: 16 of the issue register
Tier: A
Shared facts: `_canonical_shared_facts.md` (C7, C11, C12)
Research title: html_and_header_disagree (topic 16).
Research date: 2026-09-15

---

## what's actually wrong

A page declares one canonical in HTML and a different one by HTTP `Link`
header.

## threshold

Both declaration methods are present **and** their normalised targets differ.

Google documents the header as an alternative method and states that using
both HTML and headers is error-prone (C7). Where declarations conflict, the
likely outcome is that Google ignores them (C12, scoped) and selects a URL by
its own signals (C11).

Same normalised target in both → redundant configuration, not a conflict.
Report as informational; do not auto-fix.

Normalisation for comparison follows the topic 5 rules: resolve relative to
absolute, lowercase scheme and host, resolve dot segments. Do **not** collapse
trailing slash, path case, query or port — those differences are real
conflicts, not artefacts.

## detect

1. Extract `link[rel=canonical]` from `<head>` and any `Link: <…>;
   rel="canonical"` header.
2. Normalise both per above.
3. Differ → conflict. Same → redundant.

## fix

Remove one declaration, keeping the one that matches the site's other signals
— sitemap, internal links, and the preferred form from topics 8–12.

For HTML pages, prefer keeping the HTML declaration and removing the header:
the header method is documented for non-HTML files (C7).

## postcondition

Live: exactly one canonical declaration reachable for that URL, across HTML
and headers combined.

## idempotent?

Yes.

## risk / blast radius

The header is usually set in `next.config` headers or middleware, which means
it may apply to **many routes at once**. Removing it fixes one page and
changes every other page the rule covers. Establish the rule's scope before
proposing removal.

## rollback

Revert.

## verdict

`human-review`. The header's blast radius is unknown until its matcher is
resolved, and which declaration is correct is intent.

`auto-fixable` only where the header rule demonstrably applies to this single
route and the HTML declaration matches the site's other signals.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Targets are identical after normalisation | redundant, not conflicting. Informational |
| 2 | Over-normalisation collapses a genuine difference | never normalise slash, case, query or port |
| 3 | Header rule scope not statically resolvable | `indeterminate` (topic 70) |
| 4 | Resource is non-HTML | the header is the correct method. Not a finding |
| 5 | Either target is non-200 or noindexed | topics 14 and 15 first |
| 6 | Multiple canonicals within the HTML itself | topic 17, not this finding |

### Explicitly rejected

- **Removing the header rule without resolving its scope.** Could strip
  canonicals from every route it covers.
- **Assuming the HTML declaration is authoritative.** Google documents no
  precedence between the two methods.

## fixture

HTML and header with different targets; identical targets; header-only on a
PDF; a header rule covering many routes; HTML target 404.

CI asserts: raised for the first; informational for the second; suppressed for
the third; `indeterminate` for the fourth; routed to topic 14 for the fifth.

## Cross-references

- topic 17 multiple tags; topics 14, 15; topic 5 normalisation rules; topic 70
