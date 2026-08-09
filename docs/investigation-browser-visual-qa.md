# Investigation: browser-based visual QA after publish

Status: **investigation only — no implementation in this doc or its PR.** Scoped per the Content-Quality Architecture Upgrade brief (PR9): every check across the other 8 PRs in that batch operates on the HTML/JSON-LD string level. Nothing ever looks at the actual rendered page the way a real visitor or Google would. This document assesses whether a [browser-use](https://github.com/browser-use/browser-use)-style agent step — one that opens the real published page and visually confirms it — is feasible to add, and what it would take.

## Blocking finding: there is no live page to visit yet

The premise ("after an article's final URL is live, opens the real page") assumes a publish step that doesn't exist in this codebase today. Confirmed by reading the actual save/export/CMS code, not inferring from naming:

- `article-v2/route.ts` saves generated content to the `articles` table with `status: 'draft'` **hardcoded, unconditionally, on every save** — there is no code path anywhere in this repo that ever writes `status: 'published'`.
- There is no public-facing Next.js route for an article. No `src/app/**/[slug]/page.tsx`, no `src/app/blog/` directory (despite `middleware.ts` listing `/blog` in `PUBLIC_PATHS` — a reserved, dead path, not a live route), no `generateMetadata()` anywhere that would serve a saved article by its `article_url`.
- `article-download/route.ts` and `export-article/route.ts` are pure browser-download endpoints (`Content-Disposition: attachment`) — they return an HTML/ZIP file to the requester's browser, never `fetch()` anywhere outbound.
- `wordpress-connector.ts` and the `site-adapters/*` (WordPress, Shopify, Webflow, GitHub) integrations only **patch pages that already exist** on a site the user has separately connected under Settings (the `connected_sites` table) — they locate an existing post by URL and append a JSON-LD script or byline paragraph. They never originate a new publicly-reachable URL for SEORANKO-generated content.

**Conclusion: publishing is entirely the end user's manual responsibility today** — download the HTML/ZIP and paste it into their own site (WordPress or otherwise), at which point it becomes reachable at a URL SEORANKO has no record of and no way to re-derive reliably (the export's `README.txt` literally instructs manual upload). The one path where SEORANKO does touch a live URL is the "connected site" patch flow, which operates on pre-existing pages, not ones it generated.

This doesn't kill the idea, but it changes what "after publish" has to mean before any browser-QA step can run against a real URL. Two honest options:

1. **Scope it to the connected-sites patch flow.** `apply-site-fix`/`apply_fix` already writes changes to a real, externally-hosted page the user has registered. A visual QA pass could run *after that specific action* — the one place in the current codebase where SEORANKO's own code causes a real URL's content to change. This is buildable today without any other new infrastructure.
2. **Treat it as blocked on a real publish feature.** If the actual goal is QA-ing SEORANKO's own generated articles (not just connected-site patches), that requires building a public article-serving route or a genuine publish integration first — a materially larger, separate piece of work than this investigation, and arguably higher-priority than the QA step itself, since right now nothing SEORANKO generates is ever live at a SEORANKO-known URL to check.

Everything below assumes option 1 (the connected-sites patch flow) as the nearest-term buildable target, since it's the only one with a real URL today.

## Cost per check

No hard numbers exist without building and metering it, but a reasoned estimate:

A useful pass needs roughly 4-6 discrete checks against the rendered page: no stray instructional/meta text visible in the body, all `<img>` elements actually loaded (not broken icons), internal/external links resolve on click, JSON-LD present in the real page source, OG tags produce a sane-looking link preview. A browser-use-style agent typically spends one LLM call (with a screenshot and/or DOM snapshot as input) per meaningful action or check — so this is roughly 4-8 vision-capable LLM calls per article, not one.

Two real cost components, both currently unaddressed:

- **Model cost.** Each call carries a screenshot (non-trivial input tokens — full-page or viewport screenshots run from roughly 1,000 to a few thousand tokens depending on resolution and how many are needed to cover a long article) plus a compact instruction/response. Rough order of magnitude per full article pass: low tens of cents on a frontier model, closer to single-digit cents on a cheaper/vision-capable smaller model — this needs an actual pilot run to pin down, not a guess dressed up as a number.
- **Browser compute.** Headless Chromium doesn't run cleanly inside a standard Vercel serverless function the way the rest of this pipeline does (this repo's existing API routes are all plain `fetch`/DB calls with `maxDuration = 300`, no browser dependency anywhere) — it needs either a packaged headless-Chromium layer (e.g. `@sparticuz/chromium` for serverless) or a separate always-on worker/hosted browser service (e.g. Browserless, or a queue consumer outside Vercel's function model entirely). This is new infrastructure, not a library import.

Net: this is not free, and not trivial to bound precisely without a pilot. It should be metered from the first real run (log cost per check alongside the result) rather than estimated once and assumed stable — vision-input pricing and screenshot-count-per-article will both drift as the check logic matures.

## Sync-in-Write-flow vs. async-after-publish

Sync (inside `article-v2/route.ts`'s existing generation request) is the wrong shape, independent of the missing-live-URL problem:

- The route already does real work end-to-end per request — angle generation, streamed article writing, humanization, fact-sourcing, image generation, Quality Gate — inside a `maxDuration = 300` (5-minute) Vercel function budget. Adding browser launch + navigation + multiple vision LLM round-trips on top risks that budget on an already time-pressured path.
- More fundamentally: at the point this route runs, there is nothing to visit. The page (per the finding above) isn't live yet, however "live" ends up being defined.

Async-after-the-triggering-action is the only shape that makes sense, and cleanly matches how this codebase already treats non-critical follow-up work — the exact fire-and-forget pattern already used for the usage-counter update and (from this same PR batch) the IndexNow ping: don't block or fail the primary response, log the outcome, let it fail open. Concretely: a queued job (this repo already has two cron jobs configured in `vercel.json`, so a polling worker isn't a new pattern) that picks up "site was just patched via apply-site-fix" events and runs the browser check against the real resulting URL, independent of the request/response cycle that triggered the patch.

## How failures surface into Quality Gate

Quality Gate (`runQualityGate` in `article-quality-gate.ts`) runs synchronously, before save, against the HTML string — it has no concept of "after" anything today, and a browser check by definition can only run after content is live somewhere. Two structurally sound options, both consistent with patterns already in this codebase:

- **Reuse the `extraIssues` mechanism** (added in this same PR batch, for citation-link validation): if a way is found to re-run or re-score an already-saved article, browser-QA findings could be converted to `QualityIssue`s (`category: 'visual-qa'`, severity based on finding type) and merged the same way. This only works if there's a re-scoring path, which doesn't exist today (`runQualityGate` runs once, at save time, and nothing calls it again afterward for a given article).
- **A parallel, separate status field** (more realistic given the above): a new `visual_qa_status`/`visual_qa_issues` column on `articles` (or on `connected_sites`/whatever table the patch-flow action is tracked in), populated by the async worker, surfaced in the dashboard next to the existing Quality Gate panel rather than merged into its score. This avoids pretending the two checks are the same kind of thing (one is a pre-save string check the user can act on immediately; the other is a post-action check on external, possibly-cached content that could pass or fail independent of anything in the original generation).

The second option is the honest fit for what's actually being checked and doesn't require inventing a re-scoring architecture Quality Gate wasn't built for.

## Recommendation

Don't build this next. Two structural prerequisites are missing — a real "this URL is now live" event to trigger on, and headless-browser infrastructure this pipeline doesn't currently have — and the nearest real trigger point (the connected-sites patch flow) is a narrower slice of the product than "QA every generated article," which is what the original ask implied. Worth revisiting once either a genuine publish feature exists or the connected-sites patch flow sees enough real usage to justify metering and building against it specifically. If picked up, start with a single pilot check (e.g. just "does the JSON-LD in the live page source match what was generated") against the connected-sites flow, meter its real cost and false-positive rate, and expand from there — not all 5 checks at once.
