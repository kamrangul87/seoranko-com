# SEORANKO — Technical Overview for AI/Developer Onboarding

Built by directly reading the repository (`kamrangul87/seoranko-com`, `main` branch) and the live Supabase schema as of August 12, 2026 — not from summaries or memory. Use this to understand the actual implementation, not just what it's supposed to do.

---

## 1. Stack & Deployment

- **Framework:** Next.js 14 (App Router), TypeScript, Tailwind
- **Database/Auth/Storage:** Supabase (Postgres project `ddfboapzwclecbdjoqex`)
- **Hosting:** Vercel, Hobby plan — **important constraint:** Hobby plan cron jobs are capped at once-per-day; a sub-daily cron in `vercel.json` will silently fail every deployment (this happened for ~2 days on Aug 10-12, root cause was `/api/cron/verify-liveness` set to `*/5 * * * *`)
- **AI:** Anthropic Claude API directly (not via a provider abstraction yet) — `src/lib/model-router.ts` is the single source of truth for which model handles which task
- **Config file:** `vercel.json` at repo root — framework, cron schedules, function timeouts. Must match the Vercel dashboard's Framework Preset or Vercel throws a "Production Overrides" warning and can behave inconsistently

---

## 2. Model routing (`src/lib/model-router.ts`)

```
MODELS.SONNET = 'claude-sonnet-4-6'
MODELS.HAIKU  = 'claude-haiku-4-5-20251001'

SONNET (quality-critical, user-visible): articleWriting, articleImprovement,
  competitorAnalysis, humanizationRewrite, factVerification,
  auditFixGeneration, eeAtScoring, citationTesting, scoreImprovement,
  nlpExtraction

HAIKU (fast, mechanical, separate rate-limit bucket): keywordClassification,
  imagePromptGeneration, bannedWordDetection, platformDetection,
  keywordExtraction, keywordCluster, mergeArtifactRepair
```
Every new feature should route through this registry, not call the Anthropic SDK directly with a hardcoded model string.

---

## 3. The write pipeline — actual file-level flow

1. **`src/app/dashboard/write/page.tsx`** → UI, calls `POST /api/article-v2`
2. **`src/app/api/article-v2/route.ts`** — the real, live generation route (NOT `/api/article`, which is an older, largely dead route — do not add features there)
3. **`src/lib/article-master.ts`** — builds the actual prompt sent to Claude. Key internals:
   - `safeWordCount = Math.min(wordCount, 1800)`
   - Article structure (H2 section count, FAQ item count, per-section word budget) is **computed from `safeWordCount`**, not hardcoded — this was a real bug (4 separate hardcoded, contradicting counts) fixed Aug 10
   - Ends with a mandatory adversarial self-review instruction: re-check the draft for leaked meta-commentary, duplicate links, unsourced claims, before returning
   - The model is explicitly told **not** to write its own JSON-LD — schema is generated separately in code (see §5)
4. Inside `article-v2/route.ts`, in parallel (`Promise.all`):
   - Humanize pass (cheap/skip-if-already-good, not a full Sonnet rewrite)
   - `generateArticleImages()` (`src/lib/image-generator.ts`) — see §6
5. **Post-generation checks**, each a separate module:
   - `src/lib/fact-checker.ts` — flags unsourced statistics. `NAMED_SOURCE_RE` requires a real named organisation next to a reporting verb; bare hedge words ("roughly", "approximately") no longer count as sourcing alone. Rejects any auto-patch that changes sentence count (prevents orphaned fragments)
   - `src/lib/citation-link-validator.ts` — HTTP-checks every outbound `<a href>`, strips dead/unreachable ones as a blocking Quality Gate issue rather than shipping a fake-looking citation
   - `src/lib/merge-artifact-repair.ts` — mechanical detect-and-repair for truncation-style corruption (Haiku)
   - `src/lib/prose-linter.ts` — wraps `retext` (real npm library) for typo/repeated-word checks; replaced hand-rolled regex that repeatedly false-positived on domain names
   - `src/lib/article-quality-gate.ts` — aggregates everything into one score + pass/fail. `COPY_ERROR_PATTERNS` here masks domain-like tokens (`maskDomainLikeTokens`) before matching, since a bare regex on "period + short lowercase + period + capital" also matches TLDs like `.org` — a confirmed, fixed false-positive source
6. **Schema generation** — see §5, happens server-side after the hero image URL is known
7. Save to `articles` table (this didn't happen at all before Aug 9 — the live route had no insert; fixed in `c0cf56b`)

---

## 4. Internal linking (`src/lib/internal-link-engine.ts`)

- SEORANKO articles **never link to each other**. Every internal link comes from `internal_link_registry` — a table of the client's own external site pages, scoped by `user_id` + `brand`
- Composite relevance score = entity overlap + topic-cluster match + anchor naturalness, capped at 3 links/article
- If a brand has zero registry rows, zero links are added — this looked like a scoring bug once but was actually a data/account mismatch (registry rows tied to the wrong Supabase user)

---

## 5. Schema generation (`src/lib/schema-generator.ts`)

- Real, complete, code-generated JSON-LD — Article, FAQPage, BreadcrumbList, Organization
- `inLanguage` derived from `market` via `MARKET_LANGUAGE_TAGS` lookup (was never set before Aug 10)
- Publisher/organization URL derived from `brand` when it looks like a domain (contains dots), falling back to the passed `domain` field, never to SEORANKO's own domain
- `logoUrl` field exists and is wired through, sourced from the new `brand_settings` table (Settings UI) — was previously supported by the generator but nothing populated it, causing a permanent "Organization: logo missing" warning on every article
- OG/Twitter meta tags and `<link rel="canonical">` are separately injected — both were completely absent from every article until Aug 10 (`b04d2b3`, `eea8d3e`)

---

## 6. Image generation (`src/lib/image-generator.ts`)

- Provider chain: Gemini 2.0 Flash → Pexels/Unsplash → pollinations.ai (as a real, buffer-fetched provider now, not an unverified raw URL fallback — that was fixed)
- `generateArticleImages()` returns an `ArticleImageSet`; `injectImagesIntoArticle()` splices `<figure>` tags in relative to `<h1>`/`<h2>` positions
- **Known open bug (Aug 12, unconfirmed root cause):** `image_generation_logs` shows successful Pexels fetches, but the saved article can ship with zero `<figure>` tags — looks like an insertion/Promise.all issue, possibly related to the Aug 10 structural change to how H2 sections are generated. Under investigation.
- Gemini has repeatedly hit `RESOURCE_EXHAUSTED` (quota limit: 0) — needs billing enabled on the Google Cloud project, not just a rate-limit wait

---

## 7. Publishing (new, Aug 10-12, foundation only — not yet live-verified)

- **`src/lib/publisher-adapters/`** — `PublisherAdapter` interface + per-platform implementations (WordPress, Shopify, Webflow, GitHub, Universal Tag). Only GitHub has been tested against real credentials (autodun.com); the rest are built to documented API contracts but unverified live.
- **`liveness-state-machine.ts`** — models publish state as `CREATED → BUILD_PENDING → LIVE_UNVERIFIED → LIVE_VERIFIED` (+ `FAILED`), not a boolean. Only the HTTP verification loop can promote to `LIVE_VERIFIED`.
- **`liveness-verifier.ts`** + `/api/cron/verify-liveness` — the cron that broke deployment (see §1); now fixed to run once daily
- **`/api/publish/approve`** — Phase H structural gate: `/api/publish` refuses to call any adapter unless a human has approved via this route first. This is a deliberate launch-blocker safeguard against Google's scaled-content-abuse policy risk, given RANKO's ambition to auto-publish to client sites at volume
- **Distinct from `site-adapters/`** (older, pre-existing) — that one only patches pages that already exist (RANKO's auto-fix); `publisher-adapters/` is the newer, additive sibling that can originate new content

---

## 8. Database — 35 tables (confirmed live schema)

Key ones by function:
- **Content:** `articles`, `pages` (stage-tracking shadow record, stages 1-7, 6=Publish/7=Monitor), `clusters`, `topical_maps`, `cannibalization_results`
- **Publishing:** `connected_sites`, `site_connections`, `universal_tag_fixes`, `site_autofix_log`
- **Ranking:** `rank_history`, `rank_checks`, `rank_ground_truth`, `ranking_agent_articles`, `ranko_diagnoses`, `ranko_change_outcomes`, `ranko_winnability_cache`, `treatments`, `page_treatments`
- **Quality:** `quality_gate_history`, `score_history`, `image_generation_logs`
- **Brand/site config:** `brand_settings` (new Aug 10 — logo URL), `internal_link_registry`, `seo_sites`
- **GEO/AEO:** `ai_citation_tests`, `scheduled_citation_tests`, `entity_cache`, `serp_intent_cache`
- **Auth/usage:** `user_profiles`, `projects`, `saved_keywords`, `agent_logs`

**RLS:** The former 11 unprotected tables are covered by
`supabase/migrations/20260831130000_enable_rls_eleven_tables.sql` (applied on
hosted; verification notes in `docs/LIVE_SCHEMA_VERIFICATION_20260831.md`).

---

## 9. Dashboard pages (`src/app/dashboard/`)

`page.tsx` (home), `write`, `keywords`, `content`, `content-roi`, `improve`, `topical-map`, `rankings`, `ranking-agent`, `research`, `nlp`, `discovery`, `optimise`, `intelligence`, `performance`, `site-audit`, `install`, `extension`, `settings`

`topical-map/page.tsx` was fixed Aug 10 to load existing saved results on mount (via a new GET endpoint) — previously it only showed the empty state until a manual rebuild click, which looked like "no data" even when real clusters existed.

---

## 9b. Status update — Aug 15, 2026 (Quality Gate fix round)

A follow-up round targeted the recurring Quality Gate warnings (schema
completeness, dated claims, scannability, apostrophe false-positives).
Confirmed against a real generated article:

- **Fixed and verified:** images now insert correctly (hero + 3 content,
  real Supabase URLs); `Article.image` and `Organization.logo` both present
  in schema (logo falls back to Clearbit's logo API when no brand logo is
  set in Settings); straight quotes/apostrophes correctly downgraded to
  informational, not flagged as errors; a new dated-claim detector
  (`src/lib/dated-claim-detector.ts`, uses `chrono-node`) correctly blocks
  publish when a quantitative/policy claim is tied to a date with no named
  source nearby, and adds a visible "Last verified: [date]" line to
  published articles
- **Not yet working:** the paragraph splitter (`src/lib/paragraph-splitter.ts`)
  — a fresh article still showed 3 paragraphs with 6+ sentences and no
  breaks. Either not wired into the pipeline or silently failing.
- **Needs checking:** internal link registry brand matching — one test
  showed "no internal links registered for brand 'autodun.com'" when the
  registry may be keyed to "autodun" (no `.com`). Unconfirmed whether this
  is a genuine empty registry or a string-matching gap.

## 10. Standing architectural rules (learned the hard way, apply going forward)

1. **Global by default.** No hardcoded UK, no hardcoded 'autodun' brand fallback, anywhere. Market → location code, market → language tag, brand → domain — all should be explicit params or derived, never silently defaulted to one specific value.
2. **Mechanical fixes over prompt instructions.** Every fix that held on a second real test was a code-level check, a computed value, or a hard architectural change. Telling the model "be careful" or "don't do X" in a prompt has repeatedly failed to hold — see the word-count bug (4 separate prompt instructions, all ignored in favour of more detailed structural mandates) and the schema bug (model kept writing its own JSON-LD despite being told the format, until the fix was to generate schema in code instead).
3. **Verify against the real repo/deployed state, not a summary.** Multiple "fixes" this project were declared complete once already and turned out not to have actually landed (typo-detector regex, most notably — "fixed" twice before it actually stuck). Check `git log origin/main`, not a changelog someone wrote from memory.
4. **Domain names break naive period-based regex.** This has caused at least 3 separate false-positive bugs (typo detector, merge-artifact detector, twice). Any new text-pattern check involving periods should be tested against real citations (`gov.uk`, `energynetworks.org`, etc.) before shipping.
5. **Content-safety/quality gates are launch-priority, not v2.** Given RANKO's ambition to auto-publish to client sites at volume, human-review gates and volume throttles were built in from day one of the publishing feature (Phase H), not bolted on after.
