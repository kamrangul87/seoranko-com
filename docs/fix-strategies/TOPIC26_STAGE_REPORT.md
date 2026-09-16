# Topic 26 Stage 2 report — sitemap entries that are not indexable

Date: 2026-09-16
Branch: `cursor/topic26-sitemap-indexable-922c`

## Product decisions set

In `src/lib/fix-strategies/product-decisions.ts` (and wired into
`FETCH_EVIDENCE_CONFIG`):

| Knob | Value | Why |
|---|---|---|
| `refetchFallbackIntervalMs` | 1_000 | Short confirming delay when Retry-After absent; matches prior fetch-layer ops default |
| `refetchMaxAttempts` | 2 | One confirming re-fetch (topic 68) without retry storms |
| `refetchMaxHonouredRetryAfterMs` | 60_000 | Caps crawl stalls on huge Retry-After; product choice, not sourced |

All other product-decision fields remain `null`.

## Built

`src/lib/fix-strategies/topic-26/`

- `parse-sitemap.ts` — extract / remove / replace `<url>` blocks by `<loc>`
  (per-block, never spans neighbours)
- `classify-signals.ts` — noindex + canonical via shared `parseHtml` + headers;
  PDF via content-type
- `detect.ts` — classifies each loc using:
  - `recordRedirectHops` (shared)
  - `fetchWithEvidence` (topic 68)
  - `normalizeFixStrategyUrl` (shared)
  - `checkRepoDeclaredNoindex` + `resolvePath` (shared / site-model)
  - `resolveFixTarget` (shared) for generator vs artefact
- `fix-sitemap-entry.ts` — auto-remove / auto-replace plan; generator
  targeted when `isGenerated`
- `verify-live-sitemap.ts` — live sitemap postcondition; **does not import
  the fixer**

Shared helper extension: `recordRedirectHops` now returns `finalBody` /
`finalHeaders` so classification does not need a second fetch for 200s.

## Tests assert

`topic-26.test.ts` fixture set from the dossier:

| Loc | Verdict |
|---|---|
| confirmed 404 | `auto-remove-confirmed-4xx` |
| transient 5xx | `route-topic-3-transient-5xx` |
| single-hop 301 | `auto-replace-single-hop-redirect` → final 200 |
| repo-declared noindex | `auto-remove-repo-noindex` |
| injected noindex | `auto-remove-injected-noindex` (topic 2a cause) |
| canonical elsewhere | `human-review-canonical-elsewhere` |
| healthy 200 | ok (nothing) |
| PDF 200 | ok (nothing) |
| generated sitemap | `fix-generator` / `app/sitemap.ts`; `nextSitemapXml` null |

Also: verifier source has no fixer import; live verify passes on a clean
sitemap of only healthy locs.

## Dossier notes (wrong / underspecified)

1. **Threshold table vs verdict on canonicalises-elsewhere:** the threshold
   table says “replace with the canonical target”; the verdict (and Stage 2
   brief) say `human-review`. **Implemented human-review** per verdict /
   Stage 2.
2. **Injected noindex:** dossier says remove and route to topic 2a. Stage 2
   CI says “routed to topic 2a”. Implemented as
   `auto-remove-injected-noindex` — still removes, cause tagged for topic 2a.
3. **Persistent vs transient 5xx:** topic 68’s `fetchWithEvidence` treats
   matching 5xx pairs as `non-actionable` rather than stable evidence.
   Topic 26 therefore inspects attempt statuses directly: all attempts 5xx →
   `human-review-persistent-5xx`; status flip → `route-topic-3-transient-5xx`.
4. **`persistent5xxObservationWindowMs`** remains unset — persistence here
   means “confirmed across the topic-68 re-fetch pair”, not a long window.
