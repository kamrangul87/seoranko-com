# Topics 46, 47, 48 — hreflang

Branch: `cursor/hreflang-46-48-922c`
Date: 2026-09-17

## Built

**ONE annotation collector** — `collectHreflangAnnotations` reads all three
methods Google supports equally (G1):

1. HTML `<link rel="alternate" hreflang>`
2. HTTP `Link` header
3. XML sitemap `xhtml:link` (via topic 24–28 `SitemapInspection` /
   extended `parseSitemapXml`)

**Dated ISO tables** (topic 47) — `hreflang-iso-tables.ts` with `verifiedOn`
on the snapshot and each Google exclusion. Undated → no finding. Not BCP 47.

| Topic | Key behaviour |
|---|---|
| 46 | Per-pair reciprocity. Hub pattern (G8) never raised. Method divergence (G4). Body → topic 29. |
| 47 | ISO 639-1 + 3166-1 + 15924 − exclusions. `es-419`/`en-UK` fail; `zh-Hans-US` ok. `x-default` ok; absence not a defect. |
| 48 | Target health + G22 cross-locale canonical. `x-default`→redirecting homepage suppressed (G18). Locale removal = atomic human-review. |

## Tests assert

- Shared: one collector feeds all three; sitemap xhtml:link parsed
- 46: missing return; sitemap-only return suppressed; missing self; hub suppressed; conflicting return; cross-domain review; body → 29
- 47: US review; en-UK→en-GB; es-419 review; US-en invert; zh-Hans-US nothing; x-default ok; x-default-en strip; en-gb case; duplicate de review; no x-default nothing; undated tables suppress; BCP47 divergence proven
- 48: 404 atomic removal; relative absolutize; redirect repoint; repo noindex review; x-default redirect nothing; G22 review; robots review; sitemap-only healthy nothing

## Constraints checked

1. Per pair, not site-wide
2. Hub reciprocal clusters permitted
3. Not topic 34 BCP 47; dated ISO tables
4. x-default never flagged; absence not a defect
5. x-default redirecting homepage never raised
6. G22 reads each alternate's canonical; locale removal atomic / human-review
