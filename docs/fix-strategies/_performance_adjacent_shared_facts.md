# Shared facts — performance-adjacent block (topics 49–54)

Research date: 2026-09-15

## Tier A-minus: what this block may and may not claim

Every dossier in this block has a deterministic transform and an assertable
served-HTML postcondition. **None of them may assert that LCP, CLS or INP
improved.** Those are field metrics measured on real users' devices across a
28-day window; a repo change cannot be verified against them by this product.

The postcondition is always the markup or header state, never the metric.
Wording that implies a metric win is a rejected framing throughout the block.

## primary source

- WHATWG HTML Standard, the `img` element —
  https://html.spec.whatwg.org/multipage/embedded-content.html#the-img-element
- web.dev, Optimize CLS — https://web.dev/articles/optimize-cls
- web.dev, Browser-level image lazy loading —
  https://web.dev/articles/browser-level-image-lazy-loading
- web.dev, Optimize LCP — https://web.dev/articles/optimize-lcp
- MDN, `font-display` —
  https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display
- Google, Crawling December: HTTP caching —
  https://developers.google.com/search/blog/2024/12/crawling-december-caching
- Google, Crawling December: rendering-resource caching —
  https://developers.google.com/search/blog/2024/12/crawling-december-resources

## Verified facts — img dimensions

| # | Fact | Status |
|---|---|---|
| P1 | `<img>` supports unitless `width` and `height` dimension attributes | verified |
| P2 | Modern browsers derive a preferred aspect ratio from width ÷ height **before downloading the image**, reserving layout space | verified |
| P3 | Values should match the source image's intrinsic ratio | verified |
| P4 | CSS may change rendered dimensions while the HTML attributes continue supplying the intrinsic ratio (`max-width: 100%; height: auto`) | verified |
| P5 | `srcset` candidates should normally share that ratio | verified |
| P6 | **Incorrect dimensions can still cause a shift** when the actual image loads | verified |

P6 is why blindly adding attributes is not safe: wrong values are not neutral.

## Verified facts — lazy loading and LCP

| # | Fact | Status |
|---|---|---|
| P7 | **"Never lazy-load your LCP image"** | verified |
| P8 | Omitting `loading` already gives normal eager behaviour | verified |
| P9 | `loading="eager"` prevents tooling from applying lazy loading but **does not itself increase priority** | verified |
| P10 | `fetchpriority="high"` raises priority; reserve it for likely LCP images, generally **no more than one or two** | verified |
| P11 | The LCP URL should be discoverable directly in the initial HTML | verified |
| P12 | **Preload only when the resource is late-discovered**, such as a CSS background image | verified |
| P13 | Use `loading="lazy"` for below-the-fold images | verified |

P12 is the constraint most advice gets wrong: preload is not a general LCP
improvement, it is a remedy for late discovery.

## Verified facts — font-display

| # | Fact | Status |
|---|---|---|
| P14 | `auto` — browser-selected strategy | verified |
| P15 | `block` — short invisible-text period, then unlimited swap period | verified |
| P16 | `swap` — extremely short block period, then unlimited swap period | verified |
| P17 | `fallback` — extremely short block period, then short swap period | verified |
| P18 | `optional` — extremely short block period and **no** swap period | verified |
| P19 | `swap` improves text visibility but **can cause layout movement** where font metrics differ | verified |
| P20 | `optional` minimises late swapping but may leave the fallback font in use | verified |
| P21 | Matching fallback metrics — e.g. `size-adjust` — is needed to address font-related CLS reliably | verified |

**Not adopted: numeric timings.** MDN describes "short" and "extremely short"
periods. Figures such as 3 s block and 100 ms are third-party measurements of
particular browser implementations, not spec values, and must not appear as
thresholds.

## Verified facts — caching

| # | Fact | Status |
|---|---|---|
| P22 | Googlebot supports `ETag`/`If-None-Match`, `Last-Modified`/`If-Modified-Since`, `304 Not Modified`, and optional `Cache-Control: max-age` | verified |
| P23 | Google recommends setting `max-age` to the expected unchanged lifetime | verified |
| P24 | **The Web Rendering Service caches JS and CSS aggressively, and Google states its resource-cache lifetime is unaffected by HTTP caching directives** — resources may be retained up to 30 days | verified |
| P25 | Therefore content fingerprinting in the filename is the reliable update mechanism (`main.2bb85551.js`) | verified |
| P26 | Avoid changing resource URLs when content has not changed — unnecessary cache-busting consumes crawl resources | verified |
| P27 | CSS and JS required for rendering must remain crawlable; caching headers do not override robots.txt blocking | verified (see topic 21) |

**P24 is the governing fact for topic 53** and it inverts the usual advice:
setting `Cache-Control` on static assets does **not** control how long WRS
holds them. Any dossier claiming that caching headers fix stale rendered
resources is wrong.

## Not adopted across the whole block

- **Any claim that a fix improves LCP, CLS or INP.** Field metrics; not
  assertable from a repo change.
- **font-display numeric timings.** Not spec values.
- **"WRS uses your HTTP caching headers for subresources."** Contradicted by
  P24.
- **"`Cache-Control` controls Googlebot re-crawl frequency."** Not supported;
  P22 and P23 describe conditional-request support, not scheduling.
- **Preload as a general LCP improvement.** P12 scopes it to late discovery.
