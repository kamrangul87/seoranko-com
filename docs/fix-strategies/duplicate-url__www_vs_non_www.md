# duplicate-url__www_vs_non_www

Status: READY
Topic: 10 of the issue register
Tier: A
Template: topic 8
Research dates: 2026-09-15

---

## what's actually wrong

`www.example.com` and `example.com` both return 200 with the same content.

## primary source

- Google, Canonicalization and how to specify a canonical URL —
  https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Google, Redirects and Google Search —
  https://developers.google.com/search/docs/crawling-indexing/301-redirects

### Verified facts

| Fact | Status |
|---|---|
| Google publishes **no inherent preference** between the www and bare-domain forms | verified |
| Google's guidance: pick one URL as canonical and redirect traffic from the others to it | verified |
| The GSC Preferred Domain setting was retired; Google relies on the site's own signals | verified |
| Mixed signals leave the choice to Google | verified |

**Not adopted:** link-equity splitting. Unsourced.

## threshold

Both host forms return 200 with the same content.

**No documented preference exists**, so the preferred host must be derived
from the site's own signals — the same rule as topic 8, and the opposite of
topic 9.

## detect

1. For each crawled 200 URL, fetch the opposite host form.
2. Redirects to the original → site normalises, no finding.
3. Returns 200 with same content → candidate.
4. Re-fetch per topic 68.

## fix

Derive the preferred host, in this order:

1. existing `rel="canonical"` on either form
2. the host in the sitemap
3. the host used by the majority of internal links
4. any existing redirect rule

Signals agree → permanent redirect the other host to it.
Signals conflict or are absent → `human-review`. There is no default.

## postcondition

Live: the non-preferred host returns 301/308 to the preferred host, which
returns 200 in one hop with a self-referential canonical.

## idempotent?

Yes.

## risk / blast radius

Site-wide, and often **outside the repo** — host redirects are frequently DNS
or platform configuration rather than a file. Where no repo transform exists,
the verdict is report-only regardless of evidence quality.

## rollback

Revert where the rule is in the repo. Where it is platform configuration,
rollback is manual — state this in the finding.

## verdict

`human-review`. The host choice is the site owner's convention, and the fix
may live outside the repo entirely.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | The two hosts serve different content or different sites | not a duplicate |
| 2 | One host already redirects to the other | site normalises. Never raise |
| 3 | Site signals conflict on the preferred host | human-review. Do not guess |
| 4 | The redirect cannot be expressed in the repo | report-only; no transform exists |
| 5 | One host is a genuinely separate property (a distinct app on a subdomain) | not this finding |

### Explicitly rejected

- **Defaulting to bare domain or to www.** Google has no preference.
- **`robots.txt` or `noindex` on the non-preferred host.** Not a
  canonicalization fix.

## fixture

Both hosts 200 identical; one already redirecting; conflicting sitemap and
internal-link signals; a subdomain serving a different app.

CI asserts: human-review with derived preference for the first; suppressed for
the second and fourth; human-review with conflict stated for the third.

## Cross-references

- topics 8 (template), 9, 11, 12; topics 13–18; topic 27; topic 42
