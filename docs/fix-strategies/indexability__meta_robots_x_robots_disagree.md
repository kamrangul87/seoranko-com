# indexability__meta_robots_x_robots_disagree

Status: READY
Topic: 20 of the issue register
Tier: A
Shared facts: `_robots_shared_facts.md`
Research title: meta_and_header_directives_disagree (topic 20).
Research date: 2026-09-15

---

## what's actually wrong

A page's robots meta tag and its `X-Robots-Tag` header declare different
rules.

## threshold

Both declarations present, and their expanded rule sets differ.

**This is not breakage.** Google resolves conflicting rules to the more
restrictive result (R6), so the outcome is defined. The finding is that the
site is declaring two different intentions, and the restrictive one wins —
which is often not what the author expected.

Severity follows the direction of the conflict:

| Meta | Header | Effective (R6) | Likely surprise |
|---|---|---|---|
| `index` | `noindex` | `noindex` | **high** — page silently excluded |
| `noindex` | `index` | `noindex` | low — matches the stricter intent |
| `follow` | `nofollow` | `nofollow` | moderate |
| identical after expansion | — | same | none. Redundant, not conflicting |

The high-surprise row is the real finding: a page whose HTML says index but
whose header excludes it.

## detect

1. Collect the meta tag (`robots` and `googlebot` variants) and every
   `X-Robots-Tag` header value.
2. Normalise: lowercase (R3), split comma-separated values (R5), expand `none`
   to `noindex, nofollow` (R7).
3. Compare expanded rule sets. Compute the effective result per R6.
4. Differ → finding, severity by the table.

`name="robots"` and `name="googlebot"` are different scopes (R2) — a
disagreement between them is deliberate targeting, not a conflict.

## fix

Remove the declaration that does not match intent, leaving one.

Intent is not mechanically knowable, so which one survives is proposed, not
chosen. The agent states the effective outcome so the decision is informed.

## postcondition

Live: one coherent directive set for the URL across meta and headers, with the
effective result unchanged from what the human approved.

## idempotent?

Yes.

## risk / blast radius

`X-Robots-Tag` is usually set in `next.config` headers or middleware, so it
may cover **many routes**. Resolve the rule's scope via topic 70 before
proposing removal — the same trap as topic 16.

## rollback

Revert.

## verdict

`human-review`. Intent decides which declaration survives, and the header's
blast radius is unknown until its matcher is resolved.

`auto-fixable` only for the redundant case — identical rule sets after
expansion, where removing the duplicate changes nothing served.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Rule sets identical after expansion and case-folding | redundant. Informational only |
| 2 | Disagreement is between `robots` and `googlebot` scopes | deliberate targeting (R2). Not a conflict |
| 3 | Header rule scope not statically resolvable | `indeterminate` (topic 70) |
| 4 | Non-HTML resource | header is the only mechanism (R4). No conflict possible |
| 5 | URL blocked by robots.txt | topic 23 first — neither directive is being read |
| 6 | Directive in `<body>` | still respected (R8). Not a placement defect |

### Explicitly rejected

- **Treating a conflict as broken.** R6 defines the resolution.
- **Assuming the meta tag wins.** Google documents no such precedence; the
  restrictive rule wins regardless of mechanism.
- **Removing a header rule without resolving its scope.**

## fixture

Meta `index` with header `noindex`; meta `noindex` with header `index`;
identical sets; `none` in one and `noindex, nofollow` in the other; a
`robots`/`googlebot` scope difference; a header rule covering many routes.

CI asserts: high-severity finding for the first; low for the second;
informational for the third and fourth; suppressed for the fifth;
`indeterminate` for the sixth.

## Cross-references

- topics 19, 23; topic 16 for the same header-scope trap; topic 70
