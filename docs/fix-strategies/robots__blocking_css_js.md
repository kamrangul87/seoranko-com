# robots__blocking_css_js

Status: READY — report-only
Topic: 21 of the issue register
Tier: A (detect) / C (fix)
Shared facts: `_robots_shared_facts.md`
Research title: blocking_render_critical_resources (topic 21).
Research date: 2026-09-15

---

## what's actually wrong

`robots.txt` blocks CSS or JavaScript that an indexable page needs in order to
render.

## threshold

**Blocking a `.css` or `.js` path is not by itself a finding.** Google
recommends blocking resources only where their absence does not significantly
affect its understanding of the page (R28) — which means some blocking is
correct.

Three conditions, all required:

1. the resource is disallowed for Googlebot by the site's own `robots.txt`,
   evaluated per RFC 9309 matching rules (R14–R18)
2. the resource is **referenced by at least one indexable page** — a page
   returning 200, not `noindex`, not itself blocked
3. the resource is same-origin, so the site's `robots.txt` actually governs it

Condition 2 is what makes this mechanical. A blocked asset nothing indexable
references is dead weight, not a rendering problem.

**What cannot be proven mechanically:** whether the blocked resource
*materially* affects rendering. That requires judging the rendered result,
which is the assessment Google does not publish. So materiality is reported,
never asserted.

## detect

1. Parse `robots.txt`. Build the matcher per RFC 9309: longest match wins
   (R16), equal specificity favours `Allow` (R17), no match means allowed
   (R18), path matching case-sensitive (R15), user-agent matching
   case-insensitive (R14). Support `*` and `$` (R25).
2. For each indexable page, collect referenced same-origin `<link
   rel=stylesheet>` and `<script src>` URLs.
3. Evaluate each against the matcher for Googlebot.
4. Disallowed **and** referenced by an indexable page → report.

## fix

**None applied.** Unblocking a path changes what crawlers can fetch, and
`robots.txt` rules are sometimes deliberately protecting internal paths.
Opening one has security implications the agent cannot assess (R23 notwithstanding
— the fact that robots.txt is not real access control does not mean the owner
did not intend the rule).

The agent reports: the blocked resource, the rule that blocks it, and which
indexable pages reference it.

## postcondition

Where a human unblocks: the resource returns 200 and is allowed for Googlebot
by the live `robots.txt`.

## risk / blast radius

A `Disallow` pattern may cover far more than the one resource observed.
Removing it can expose an entire directory.

## verdict

`not_mechanically_fixable` for the fix. `auto-detectable` for the blocked
reference. Report with the rule and the referencing pages.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Resource is cross-origin | the site's robots.txt does not govern it. Never raise |
| 2 | Resource referenced only by non-indexable pages | not a rendering problem for Search |
| 3 | An `Allow` rule of equal or greater specificity overrides the `Disallow` | not blocked (R17). Never raise |
| 4 | Rule targets a user-agent other than Googlebot | evaluate per agent; do not assume `*` applies |
| 5 | robots.txt beyond 500 KiB | rules past the limit are ignored (R24). Do not evaluate them as active |
| 6 | Resource is analytics, ads, or third-party tracking | blocking it does not affect content understanding |
| 7 | Reference found only in post-hydration DOM | assess served HTML (topic 67) |

### Explicitly rejected

- **Flagging every blocked `.css` / `.js`.** R28 makes some blocking correct.
- **Auto-unblocking.** Security implications the agent cannot assess.
- **Asserting a rendering or ranking impact.** Materiality is not provable;
  R27 describes behaviour, not penalty.
- **"Layout penalties."** Not a documented concept.

## fixture

`robots.txt` blocking a CSS file referenced by an indexable page; blocking a
JS file referenced only by a `noindex` page; a `Disallow` with a more specific
`Allow`; a cross-origin script; a blocked analytics script; a rule scoped to a
non-Google user-agent.

CI asserts: reported for the first only; suppressed for all others, each with
the guard that suppressed it recorded.

## Cross-references

- topic 22 robots.txt validity — must parse before this can run
- topic 62 render-blocking scripts (different problem, same vocabulary)
- topic 67 pre-hydration
