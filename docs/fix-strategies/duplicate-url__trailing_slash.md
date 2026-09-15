# duplicate-url__trailing_slash

Status: READY
Topic: 8 of the issue register
Tier: A
Depends on: topics 68, 70
Research dates: 2026-09-14

**Template topic.** Topics 9–12 (http/https, www/non-www, case variants, query
parameters) reuse this structure; only the variant-generation step differs.
Each is researched and READY (2026-09-15).

---

## what's actually wrong

`/page` and `/page/` both return 200 with the same content, so the site serves
one piece of content at two distinct URLs.

## primary source

- Google Search Central, To slash or not to slash —
  https://developers.google.com/search/blog/2010/04/to-slash-or-not-to-slash
- Google, Specify a canonical URL —
  https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls

### Verified facts

| Fact | Status |
|---|---|
| Google treats each URL separately and equally, regardless of whether it has a trailing slash | verified |
| The site root is the exception: `https://example.com` and `https://example.com/` are equivalent | verified |
| Where both return 200 with the same content, Google clusters them as duplicates, chooses one canonical, and crawls the duplicates less often | verified |
| **Google has no preference** between the slash and non-slash form. The slash is conventional for directory-style URLs | verified |
| Google's recommended fix order: permanent redirect the duplicate to the preferred URL; use `rel="canonical"` only where redirecting is not possible | verified |
| The preferred URL should carry a self-referential canonical | verified |
| The preferred form should be used consistently in internal links and sitemaps | verified |

**Not adopted:** crawl-budget waste and link-equity splitting. Not Google's
wording, no published figures. The finding stands on duplication alone.

## threshold

Both `/page` and `/page/` return 200, and the responses are the same content.

Content sameness must be proven, not assumed — same normalised main content,
or an identical response body hash. Two forms serving genuinely different
content is not this finding.

**Excluded:** the site root. `https://example.com` and `https://example.com/`
are equivalent and must never be raised.

## detect

1. For each crawled 200 URL, generate the opposite trailing-slash form.
2. Fetch it. If it 3xx-redirects to the original, the site already normalises —
   no finding.
3. If it returns 200, compare content. Same content → candidate.
4. Re-fetch per topic 68 before raising.

## fix

**Preferred-form selection comes first, and the agent does not guess it.**
Derive it from the site's own signals, in this order:

1. an existing `rel="canonical"` on either variant
2. the form present in the sitemap
3. the form used by the majority of internal links
4. the repo's `trailingSlash` setting in `next.config`

If these conflict or are absent, the choice is `human-review`. Google has no
preference, so there is no default to fall back on.

**Then apply, in Google's stated order:**

- permanent redirect the non-preferred form to the preferred one. On Next.js
  this is normally the `trailingSlash` config, which normalises site-wide via
  redirect
- `rel="canonical"` only where both forms must keep returning 200

Both branches also require the preferred form to carry a self-referential
canonical.

## postcondition

Live response: the non-preferred form returns 301/308 to the preferred form,
which returns 200 in one hop and carries a self-referential canonical.
Asserted via a code path separate from the executor.

## idempotent?

Yes.

## risk / blast radius

`next.config` `trailingSlash` is **site-wide** — it changes the URL form of
every route at once, and every internal link and sitemap entry must match
afterwards or the site trades a duplicate problem for a redirect-hop problem
(topic 42).

## rollback

Revert commit. Note that a 301 may be browser-cached, as in topic 6.

## verdict

`human-review`. Site-wide blast radius, and the preferred-form choice is the
site owner's convention, not a mechanical fact.

`auto-fixable` only where the site's own signals unambiguously agree on the
preferred form and the change is a single `trailingSlash` setting.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | URL is the site root | never raise. The two forms are equivalent |
| 2 | The two forms serve different content | not a duplicate. Never raise |
| 3 | One form already redirects to the other | the site normalises. Never raise |
| 4 | Site's own signals conflict on the preferred form | human-review. Do not guess |
| 5 | A variant is produced by middleware | resolve via topic 70; `indeterminate` if not statically resolvable |
| 6 | Observed once only | re-fetch first (topic 68) |

### Explicitly rejected

- **Defaulting to slash or non-slash.** Google has no preference; picking one
  imposes a convention the site did not choose.
- **Applying `rel="canonical"` as the first resort.** Google's stated order
  puts the redirect first.
- **Fixing the duplicate without updating internal links and sitemap.** That
  converts topic 8 into topic 42.
- **Claiming crawl-budget or ranking harm.** Unsourced.

## fixture

Synthetic repo with: `/page` and `/page/` both 200 with identical content;
both 200 with different content; `/page/` already redirecting to `/page`; the
site root in both forms; a case where the sitemap and internal links disagree.

CI asserts: raised for the first; suppressed for the second, third and fourth;
human-review for the fifth.

## Cross-references

- topics 9–12 — same shape, reuse this structure
- topic 13–18 — canonical, which the fix depends on
- topic 27 — sitemap must list only the preferred form
- topic 42 — internal links must point at the preferred form
- topics 68, 70
