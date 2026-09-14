# Topic 1 implementation — stage report

Built from committed dossiers. Scope is stages 1–3 plus the 410-slice
fixture only. No language model on any runtime path. No customer-repo writes.

## Stage 1 — fetch layer (topic 68)

**Built:** `src/lib/fix-strategies/fetch/`
- `fetchUrl` — no redirect follow; returns status + headers + body or a
  classified network failure (timeout / connection-reset / dns-failure /
  network-error)
- `parseRetryAfter` — delta-seconds and HTTP-date; malformed → absent
- `fetchWithEvidence` — cache-bypassing re-fetch; unstable statuses suppress
- `FETCH_EVIDENCE_CONFIG` — single object for fallback delay, max attempts,
  max honoured Retry-After, timeout (product decisions, not sourced)

**Tests assert:** status classification; Retry-After forms; malformed ≠ zero;
410 accepted on one observation; 404 confirmed on matching re-fetch; status
flip → unstable; 429/503 → non-actionable after honouring Retry-After.

**Dossier notes:**
- Task Stage 1 said “re-fetch before any finding.” Topic 68 says 410 is
  sufficient on one observation. **Implemented per topic 68** (and Stage 3’s
  “no further evidence required” for 410). Flagging the conflict.
- Fallback interval / max attempts / max Retry-After remain product decisions
  as the dossier left them open.

## Stage 2 — site model (topic 70)

**Built:** `src/lib/fix-strategies/site-model/`
- `resolvePath` → `static-route` | `dynamic-route` | `no-route` |
  `indeterminate` + route file
- strips `(group)`, ignores `@slot`, most-specific-first
- `[...slug]` does not match parent root; `[[...slug]]` does
- any `middleware` rewrite → `indeterminate` (conservative)
- `declaresNoindex` — page metadata, layout chain, `generateMetadata`

**Tests assert:** groups, slots, param, catch-all trap, optional catch-all
root match, specificity, middleware indeterminate, layout cascade, conditional
`generateMetadata` → indeterminate.

**Dossier notes:**
- Middleware matcher precision is still the open question in the dossier.
  Current behaviour: **any rewrite ⇒ all paths indeterminate**. Finer static
  matcher parsing was not specified tightly enough to implement safely.

## Stage 3 — topic 1, 410 branch only

**Built:** `src/lib/fix-strategies/topic-1/`
- extract `<a href>`, scheme filter, internal filter
- `detectGoneAnchors` — only raises on stable 410
- `removeAnchorByHref` — fixture-only HTML transform
- `verifyAnchorAbsent` — separate module; does not import the fixer

**Tests assert:** mailto/`#` skipped; one 410 finding; healthy 200 suppressed;
fix removes href; verifier passes on fixed HTML and fails on original;
verifier source has no fixer import.

## Stage 4 — fixture / CI

**Built:** `src/lib/fix-strategies/__fixtures__/topic-1-410/`
- source page with four anchors: 410, mailto, `#`, healthy 200
- in-process fetch surface (no customer repo)

**CI asserts:** one finding raised; three suppressed; fix applied;
postcondition passes against the served (fixed) HTML.

## Not in this task (original Stage 1–4)

404 branch (git history / successor similarity), soft-404 discriminator
wiring into Fix Agent, and customer-repo writes.

## Follow-up — 404 branch + Autodun middleware (2026-09-14)

**Autodun middleware answer:** real Autodun middleware has no `rewrite()` —
only `next()`, auth challenge, or header injection. Closed topic 70 open
question: key off rewrite calls, not middleware file presence.

**404 branch shipped** under `src/lib/fix-strategies/topic-1/`:
- `git-route-history.ts` — `git log --diff-filter=D` evidence
- `successor-similarity.ts` — path + content Jaccard, product floor
- `decide-404.ts` — remove / proposed-301 / ambiguous / recreate-scaffold
- GSC impressions accepted but never gate
- Fixture exercises all four 404 outcomes plus 410
