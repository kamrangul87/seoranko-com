# sitemap__xml_invalid

Status: READY
Topic: 25 of the issue register
Tier: A
Shared facts: `_sitemap_shared_facts.md`
Research date: 2026-09-15

---

## what's actually wrong

A fetched sitemap does not conform to the sitemaps.org protocol.

## threshold

Each condition is a separate finding with its own severity. All are hard
limits from the protocol or Google's documentation — no judgement involved.

| Condition | Source | Severity |
|---|---|---|
| missing or wrong `urlset` namespace | S2 | critical — may not parse |
| XML does not parse | S1 | critical |
| not UTF-8 | S1 | critical |
| a `url` entry with no `loc` | S2 | high |
| `loc` is relative or lacks a protocol | S3 | high — unusable entry |
| `loc` exceeds 2,048 characters | S3 | high |
| unescaped entities in a value | S1 | high |
| more than 50,000 URLs | S9 | high — entries beyond the limit not processed |
| exceeds 50 MB uncompressed | S10, S11 | high |
| gzipped file whose decompressed size exceeds 50 MB | S11 | high |
| sitemap index listing more than 50,000 sitemaps | S12 | high |
| `changefreq` or `priority` present | S7 | **informational only** — ignored by Google, not an error |
| `lastmod` present but bulk-identical across all entries | S8 | moderate — Google may stop trusting it |
| URLs outside the sitemap's host or directory scope | S5, S6 | moderate — unless cross-submission is established |

## detect

1. Fetch and decompress if gzipped. Record both compressed and decompressed
   sizes (S11).
2. Validate encoding, then parse XML.
3. Validate the namespace and required elements.
4. Per entry: `loc` present, absolute, protocol-qualified, under 2,048 chars.
5. Count entries; measure decompressed bytes.
6. Check `lastmod` distribution — identical values across every entry is the
   bulk-update pattern (S8).
7. Check host and directory scope against the sitemap's own location.

## fix

Deterministic for most conditions, because they are structural:

- missing namespace → add the correct one
- relative `loc` → make absolute
- unescaped entities → escape them
- `changefreq` / `priority` → removal is safe and changes nothing served
  (S7), so this is a cleanup, not a fix
- over 50,000 URLs or 50 MB → split into multiple sitemaps under an index.
  Deterministic but restructures the file
- entry with no `loc` → remove the entry

Not deterministic: which URLs belong in which split file; whether an
out-of-scope URL should be removed or the cross-submission established.

## postcondition

Live: the sitemap parses, validates against the protocol namespace, every
`loc` is absolute and under 2,048 characters, entry count is within 50,000 and
decompressed size within 50 MB.

## idempotent?

Yes.

## risk / blast radius

The sitemap file, or the `sitemap.ts` route that generates it. Where the
sitemap is generated programmatically, the fix belongs in the generator, not
the output — editing generated output is overwritten on next build.

## rollback

Revert.

## verdict

`auto-fixable` for: namespace, relative `loc`, entity escaping, removing
`changefreq`/`priority`, removing `loc`-less entries. All structural, all
verifiable.

`human-review` for splitting oversized sitemaps and for out-of-scope URLs.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | `changefreq` / `priority` present | ignored, not invalid (S7). Never raise as an error |
| 2 | Size measured compressed rather than decompressed | the 50 MB limit is on the decompressed file (S11) |
| 3 | Sitemap is generated at build time | fix the generator, never the output |
| 4 | Cross-host URLs with established cross-submission | valid (S6). Never raise |
| 5 | Sitemap index rather than a urlset | different schema. Validate against the index schema, not `urlset` |
| 6 | `lastmod` legitimately identical because all pages changed together | moderate at most; never auto-modify `lastmod` |

### Explicitly rejected

- **Treating `changefreq` or `priority` as errors.** Protocol-valid; Google
  ignores them.
- **Rewriting `lastmod` values.** Fabricating dates is worse than inaccurate
  ones, and S8 means Google stops trusting bulk changes.
- **Editing generated sitemap output.** Overwritten next build.

## fixture

Sitemap with a wrong namespace; with a relative `loc`; with a 2,100-character
`loc`; with 50,001 entries; gzipped to 10 MB but 60 MB decompressed; with
`changefreq` on every entry; with identical `lastmod` everywhere; a valid
sitemap index.

CI asserts: auto-fix for the first and second; raised for the third, fourth
and fifth; informational for the sixth; moderate for the seventh; nothing for
the eighth, validated against the index schema.

## Cross-references

- topics 24, 26, 27, 28
