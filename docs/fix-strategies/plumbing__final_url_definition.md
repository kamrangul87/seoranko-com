# plumbing__final_url_definition

Status: SATISFIED BY EXISTING HELPERS (no separate topic-69 module)
Topic: 69 of the issue register
Tier: A
Blocks: 8–18 (comparison identity for duplicate-URL / canonical)

Research note (consolidation audit 2026-09-17): this dossier was never
researched as a standalone topic. The behaviour it would define is already
implemented by composing two shared helpers. Marked satisfied rather than left
open as NOT RESEARCHED.

---

## what's actually wrong

Topics that compare URLs after redirects need a single definition of the
**final URL** — the address used for identity / sameness after the redirect
chain stops — and a single comparison-normalise for visited-set membership.

## Definition (from shipped code)

| Concern | Helper | Behaviour |
|---|---|---|
| Walk redirects with `redirect: 'manual'` | `shared/hop-recording-fetch` → `recordRedirectHops` | Records every hop; stops on non-3xx, loop, missing `Location`, or max 10 hops |
| Typed chain for topics 4–7 | `redirect-chain/walk` → `walkRedirectChain` | Thin wrapper; exposes `finalUrl`, `finalStatus`, `finalBody`, `finalHeaders`, cycle |
| Comparison / visited-set key | `shared/url-normalize` → `normalizeFixStrategyUrl` (also as `normalizeHopUrl`) | Lowercase scheme/host; resolve relatives and `.`/`..`; **does not** collapse trailing slash, path case, query, or non-default port; strips fragment |

**Final URL** = `HopRecordingResult.finalUrl` / `ChainWalkResult.finalUrl`: the
URL of the terminal non-3xx response (or the last hop URL when stopped early).

**Final URL for comparison** = `normalizeFixStrategyUrl(finalUrl)`.

## What is NOT missing for 8–18

- Redirect identity for duplicate-URL and redirect topics uses this stack.
- Canonical target fetches that need the live destination use
  `recordRedirectHops` (topics 14, etc.).
- Trailing-slash / case / www / http distinctions remain **visible** after
  normalise (by design) so topics 8–11 can still classify those variants.

## Residual gaps (not blockers for closing the stub)

1. No single exported name like `resolveFinalUrl(url)` — callers compose
   `recordRedirectHops` / `walkRedirectChain` + `normalizeFixStrategyUrl`
   themselves. A thin facade would reduce drift but is optional.
2. `canonical-normalize` (`normalizeCanonicalForGscMatch`) is a **different**
   normalise for GSC matching (topics 55/58/59) and currently has **zero**
   production callers — unrelated to final-URL identity.
3. A few topics still do local `new URL(...).origin` / slash-strip compares
   (see consolidation audit §1) instead of always going through
   `normalizeFixStrategyUrl`.

## threshold / detect / fix

n/a — plumbing definition, not a user-facing defect topic.

## verdict

**Satisfied by existing helpers.** Do not implement a parallel topic-69
detector. Optional follow-up: add `resolveFinalUrl` as a named export that
documents this composition.

## Cross-references

- `shared/hop-recording-fetch.ts`, `shared/url-normalize.ts`,
  `redirect-chain/walk.ts`
- Topics 4–7, 8–18, 42, 48 (consumers of final / normalised URLs)
- Consolidation audit 2026-09-17
