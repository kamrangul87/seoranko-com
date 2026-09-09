# SEORANKO — Verification Matrix

A feature may be called **working** only when its Evidence column is satisfied.
Code existence and unit tests alone are **not** sufficient.

Last inventory pass: 2026-09-09 against `main` @ `f8221e2`.
CI: Test `34340761782` success; migrate `34340761756` success.
Update this file when evidence changes. Do not invent analytics numbers.

---

## Classification legend

| Tag | Meaning |
|---|---|
| proven live | Real credentials + stored DB / live URL evidence |
| implemented unproven | On `main`; not yet proven with live credentials |
| partial | Some paths correct; known honesty gaps |
| broken | Incorrect behavior confirmed |
| UI shell | Visible UI without durable backend evidence |
| not started | Absent |

---

## Product areas

### Audit / Index Diagnosis

| Item | Class | Evidence required before “working” | Current evidence |
|---|---|---|---|
| Fresh HTTP crawl + indexability chain | partial → target proven | Fresh run on a live site; `index_diagnosis_runs` row with non-empty `pages` | Code + unit tests; empty-restore fix on `main` (`385842c`); schema-validate on restore |
| Persist / restore | partial | Reload → usable diagnosis **or** auto re-crawl; never score/HTTP 0 stub; no stale Link Graph | `saved-validity` + `audit-saved-stale-link-graph` tests; UI clears Link Graph on `needsFreshCrawl` |
| Quality Gate scoring | implemented unproven | Stored issues array non-empty for a real page | Code path exists |
| Sitemap drift → Fix Agent | implemented unproven | Live drift → issue → (optional) GitHub sitemap write | Code + tests |

### Link Graph

| Item | Class | Evidence required | Current |
|---|---|---|---|
| L01–L32 analysis | implemented unproven | Run on fresh crawl HTML; persisted results | Code + unit tests |
| Run uses fresh crawl | partial | No stale Link Graph after empty restore | UI `forceFresh`; payload omits Link Graph when `needsFreshCrawl`; fixture added |
| Fix Agent bridges (dead link, href rewrite) | partial | Live GitHub write + verify | Dead-link proven; href rewrite unproven live |

### Fix Agent strategies

| Strategy | Class | Evidence required | Current |
|---|---|---|---|
| remove-dead-link | proven live | `fix_agent_attempts` verified + live HTML without dead href | Prod: verified intervention exists |
| meta-title / meta-description / missing-h1 / lang | implemented unproven | Live HTML assertion after deploy | Code verifies HTML; live GitHub proof pending (see verified-kinds probe) |
| schema-* | implemented unproven | Live JSON-LD type present | Code verifies schemasFound |
| image-alt / html-structure | implemented unproven | Live HTML assertion | Code path |
| rewrite-link-href | implemented unproven | Live href match | Unit + GitHub path; live pending |
| redirect-canonical | implemented unproven | Live redirect resolves | Dedicated live verify |
| sitemap-regenerate | implemented unproven | Live `/sitemap.xml` contains urlset | Code; deploy lag common |
| **llms-txt** | **partial** (fixed honesty; unproven live) | Fetch `{origin}/llms.txt` after deploy; must fail if missing | `verifyLlmsTxtLive` + HTML path returns `ok: false`; contract in `fix-agent-strategy-contract.ts` |
| **security-headers** | **partial** (fixed honesty; unproven live) | Live response header check; must fail if absent | `verifySecurityHeadersLive`; cannot rubber-stamp via HTML |

Strategy contracts (before/after extractors, assertions, failure/handoff):
`src/lib/fix-agent-strategy-contract.ts`.

### GitHub connector

| Item | Class | Evidence required | Current |
|---|---|---|---|
| Connect + encrypt + verify | proven live | Active `site_connections` + successful Fix Agent write | autodun Fix Agent history |
| Direct-push to default branch | proven live | Commit SHA on default branch | Used in prod loop |

### GSC OAuth + metric sync

| Item | Class | Evidence required | Current |
|---|---|---|---|
| OAuth connect + property bind | implemented unproven* | `gsc_connections` active + property_url | Schema + UI; *token validity reconfirmed on Sync |
| Daily `url_metrics_daily` sync | implemented unproven | Non-zero metric rows for connected property | Cron code |
| Baseline readiness | partial | Honest pass/fail rows in `baseline_readiness_checks` | Causal `invalid_baseline` shows honesty |

### GSC Index Insights

| Item | Class | Evidence required | Current |
|---|---|---|---|
| Schema + quota RPC | proven live (infra) | Migrations applied; concurrent reserve does not oversell | Migrate CI: concurrency totalReserved=5, oversold=false |
| First real inspection row | **not started (data)** | `gsc_url_inspections` count ≥ 1 from live API | **count = 0** (migrate CI 34340761756); probe skipped API write (no service-role in Actions) |
| UI Sync / cron write | implemented unproven | Sync or cron increases inspection count | Code + probe; **manual Sync required** |
| Post-fix recrawl delta | implemented unproven | Delta when `lastCrawlTime` < `verified_at` | Code; needs inspection + verified intervention |
| Ranking-cause claims | forbidden | Must never appear in UI | Tests ban phrases |

### Fix Agent live kinds (prod probe 34340761756)

| Kind | Status in prod | Notes |
|---|---|---|
| remove-dead-link | verified (n=1) | Proven live |
| llms-txt | pending_deploy (n=1) | Pre-honesty-fix row; new path cannot mark verified without live GET |
| (other kinds) | — | **action:** approve + live-verify ≥2 additional existing strategies |

### Intervention lifecycle

| Item | Class | Evidence required | Current |
|---|---|---|---|
| implemented → verified | proven live | `lifecycle_state=verified` + `verified_at` | **1** verified row in prod (last probe) |
| Index Insights read-only | proven live (code contract) | No causal/lifecycle writes from GSC scheduler | Code review + causal count unchanged after Index Insights probes |

### Causal analysis

| Item | Class | Evidence required | Current |
|---|---|---|---|
| Persist results incl. invalid/insufficient | proven live | `causal_results` with honest `validity_status` | **1** row, `invalid_baseline` |
| Valid lift claim | not started (data) | Ready baseline + windows + `valid` status | Not present |

### Publishing / CMS / billing / content

| Item | Class | Notes |
|---|---|---|
| GitHub publisher (articles) | implemented unproven | Deferred from beta primary journey |
| WP / Shopify / Webflow | implemented unproven | **Experimental** labels in Connect modal |
| Billing | implemented unproven | Not beta gate |
| Content / image tools | deferred | Experimental nav |

---

## Regression fixtures (Phase 2D) — merge-gated

Each fixture must fail if the bug returns **and** its path must appear in
`.github/workflows/test.yml` (push/PR to `main`). Enforced by
`src/lib/regression-fixtures-ci.contract.test.ts`.

| # | Bug class | Fixture | In Test workflow |
|---|---|---|---|
| 1 | Empty stored Audit restore | `index-diagnosis/` (saved-validity) | Yes |
| 2 | Stale Link Graph after invalid diagnosis | `audit-saved-stale-link-graph.test.ts` | Yes |
| 3 | Migration not applied | `audit-persist-migration-ci.contract.test.ts` | Yes |
| 4 | False verified llms/security | `fix-agent-live-verify.test.ts` | Yes |
| 5 | PR vs direct-write status | `fix-agent-summary.test.ts` + `finding-status.test.ts` | Yes |
| 6 | Subdomain connection mismatch | `link-graph/` + `site-connection-lookup.test.ts` | Yes |
| 7 | Canonical normalization | `gsc/index-insights.test.ts` | Yes |
| 8 | Domain period regex | `domain-period-regex.regression.test.ts` + `sentence-boundaries.test.ts` | Yes |
| 9 | Duplicate batch upserts | `gsc/dedupe-metrics.test.ts` | Yes |
| 10 | Low-volume discontinuity | `gsc/baseline-readiness.test.ts` | Yes |

Standalone test files not listed in Test.yml do **not** count as gated.

---

## Phase 4 — platform usage & first beta candidates

| Check | How | Status |
|---|---|---|
| GSC inspection quota vs soft cap (1950) | `scripts/beta-platform-usage-probe.mjs` in migrate CI | Wired — fill from next green migrate log |
| Supabase DB size + critical table rows | same probe | Wired |
| Vercel function minutes | same probe; needs `VERCEL_TOKEN` | Blocked until secret — reports Hobby 60s/daily-cron envelope until then |
| First beta candidates | `scripts/beta-candidates-probe.mjs` | Wired — do **not** assume autodun is the customer |

### Candidate policy (honest)

- **autodun.com** / **seoranko.com** = dogfood / first-party validation, not an external customer.
- True external beta = non-dogfood domain + active GitHub write + active GSC + owner consent + useful verified finding/fix or confirmed regression.
- Phase 4 is incomplete if we only treat dogfood as “customer beta” unless you explicitly accept dogfood-only.

Update after migrate CI candidates probe:

```
(recommendation from probe — fill after CI)
```

---

## Beta completion checklist (external-ready)

- [ ] New user: site + GitHub + GSC connected
- [ ] Fresh audit → non-placeholder findings + stored evidence
- [ ] Approve deterministic fix → `implemented` → live `verified`
- [ ] Google last recorded status visible when inspections exist (**blocked:** 0 inspection rows)
- [ ] “Awaiting Google recrawl” distinct from “Google disagrees”
- [x] Reload never restores empty stub data (code + fixtures)
- [x] All ten regression fixtures listed in merge-gating Test workflow (+ contract test)
- [ ] Migrations applied; CI + production deploy green
- [ ] Two additional GitHub strategies proven live beyond dead-link
- [ ] Platform usage probe reviewed (GSC / Supabase / Vercel)
- [ ] First beta candidate named from inventory (dogfood vs external) — not assumed
- [ ] VERIFICATION_MATRIX rows flipped with production IDs

### Exact manual action still required (Phase 2A)

With a valid GSC OAuth token on an active property:

1. Open **Audit** for a URL on that property.
2. Click **Sync Google’s last recorded view** (Index Insights).
3. Confirm `gsc_url_inspections` gains ≥1 row (migrate CI probe also attempts this).

Without that user interaction / valid token, Index Insights stays **implemented unproven** for data.

### Migration safety

Any new migration must be **additive/non-destructive by default**. Stop and ask before
`DROP` / destructive `ALTER` / truncate — production holds verified interventions and GSC history.
