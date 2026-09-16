# sitemap__urls_return_4xx

Status: READY
Topic: 26 of the issue register
Tier: A
Shared facts: `_sitemap_shared_facts.md`
Research title: urls_not_indexable (topic 26) — broader than 4xx alone.
Research date: 2026-09-15

---

## what's actually wrong

A sitemap lists URLs that cannot be indexed, so the site asks Google to
prioritise pages it also tells Google to ignore.

## threshold

Google's instruction is to include the URLs you want in search results (S14),
and where several URLs lead to the same content, only the preferred one (S15).

| Listed URL's state | Treatment |
|---|---|
| confirmed 4xx (topic 68) | remove from sitemap |
| 5xx stable across the re-fetch pair (`stableAcrossRefetch`) | human-review — do not remove on a transient flip; topic 3 owns the longer `persistent-5xx` window |
| redirects | replace with the final 200 URL |
| repo-declared `noindex` (topic 70) | remove — direct contradiction with S14 |
| 200 with injected `noindex` | topic 2a. The page is gone; remove |
| canonicalises to a different URL | **human-review** — the declared canonical may itself be wrong, so replacing the sitemap `loc` with it would propagate a bad target (S15 still informs the report, not an auto-replace) |
| 200, indexable, self-canonical | correct. Not a finding |

Note S17: these entries do not invalidate the XML. They create conflicting
signals. And S16: sitemap inclusion is only a weak canonicalization hint, so
the claim is about coherence, not about lost ranking.

## detect

1. Parse the sitemap; collect every `loc`.
2. Fetch each, without following redirects.
3. Classify using the existing detectors — topic 68 for 4xx confirmation,
   topic 68 re-fetch pair for `stableAcrossRefetch` 5xx (topic 3 owns the
   longer `persistent-5xx` observation window), topic 2a for injected
   `noindex`, topic 70 for declared `noindex`, and the page's canonical for
   S15 (report / human-review only).
4. Re-fetch before raising.

## fix

Remove or replace the entry.

**This is the strongest auto-fix candidate in the sitemap block:** removing a
confirmed 404 from a sitemap touches one file, changes no served page, is
trivially reversible, and has a clean postcondition. No intent is involved —
Google's instruction is explicit.

Replacing a redirecting URL with its final target is equally deterministic
where the chain resolves to a single 200 in one hop.

## postcondition

Live sitemap: every `loc` returns 200, carries no `noindex`, and is
self-canonical.

## idempotent?

Yes.

## risk / blast radius

One file — or the sitemap generator where it is built at build time. Removing
a URL from a sitemap does not deindex it; it only stops advertising it. Low
blast radius by design.

## verdict

`auto-fixable` for: removing confirmed 4xx entries, removing repo-declared
`noindex` entries, and replacing a single-hop redirect with its target.

`human-review` for canonicalises-elsewhere (the canonical may itself be wrong,
so auto-replacing the sitemap entry would propagate it) and for 5xx that is
`stableAcrossRefetch` (stable across the topic-68 re-fetch pair — not the same
as topic 3's windowed `persistent-5xx`).

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | 4xx observed once | re-fetch first (topic 68) |
| 2 | 5xx is transient | topic 3. Never remove |
| 3 | `noindex` is injected, not declared | topic 2a — the destination is gone, not deliberately excluded |
| 4 | Entry redirects to a chain, not a single hop | resolve via topic 4 first |
| 5 | Sitemap is generated at build time | fix the generator, not the output |
| 6 | URL is a non-HTML resource returning 200 | valid entry. Never raise |
| 7 | Removing the entry is proposed as a way to deindex | it is not. Removal only stops advertising the URL |

### Explicitly rejected

- **Removing an entry to achieve deindexing.** Sitemap removal does not
  deindex; `noindex` does. Conflating them would produce a fix whose
  postcondition cannot be met.
- **Removing entries on a single observation.**
- **Editing generated sitemap output.**

## fixture

Sitemap listing: a confirmed 404; a transient 5xx; a single-hop redirect; a
repo-declared `noindex` page; a page with injected `noindex`; a page
canonicalising elsewhere; a healthy self-canonical 200; a valid PDF.

CI asserts: auto-fix removal for the first and fourth; routed to topic 3 for
the second; auto-fix replacement for the third; routed to topic 2a for the
fifth; human-review for the sixth; nothing for the seventh and eighth.

## Cross-references

- topics 2a, 3, 4, 68, 70 supply classification; topic 27 is the inverse
