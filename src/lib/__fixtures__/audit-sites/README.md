# Audit-site fixtures (permanent regression)

Four deliberately-broken static HTML sites used by `suite.test.ts` to prove
Index Diagnosis, Sitemap Generator, Fix Agent classification, and Link Graph
behave correctly on **any** site with these defect patterns — not just autodun.com.

| ID | Defects covered |
|----|-----------------|
| `canonical-and-redirects` | Self-canonical OK; directory→index.html OK; index.html→directory broken; L03/L04/L05 redirects |
| `broken-links-and-orphans` | 404 link, sitemap orphan (L21), depth>5 (L22), utm dedupe |
| `duplicate-content` | 3 near-identical blog posts flagged; `/unique.html` not over-flagged |
| `js-rendered-spa` | L00_JS_SUSPECTED; suppresses false L21/L23 |

## Run

```bash
npm test -- --run src/lib/__fixtures__/audit-sites/suite.test.ts
# or via the named script (also used in CI):
npm run test:fixtures
```

CI: `.github/workflows/test.yml` runs `npm test` on every push to `main`.
