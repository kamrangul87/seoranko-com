# SEORANKO — Engineering Context

**Commit this to `docs/SEORANKO.md`. It is the canonical description of what this
product is and how it is built.**

For Claude Code: read this before proposing changes. Reference sections by number
(e.g. "per §3, Station 5"). If a request conflicts with this document, say so rather
than implementing it.

---

## 0. How to use this document

- **One numbered task from §10 per branch.** Do not implement multiple sections at once.
- **Do not rewrite working code to match this structure.** Wire what exists into it.
- **If a feature has no station (§3) and no source (§5), it does not get built.**
- Ask before adding a new database table, a new nav item, or a new external API.

---

## 1. What SEORANKO is

A system that gets a page ranking and keeps it there — and measures whether its own
actions worked.

Every competitor scores content and advises a human to act. SEORANKO performs the edit
and then observes the outcome. That closed loop is the entire product claim. Feature
breadth is not the differentiator and should not be treated as one.

**Stack:** Next.js 14, TypeScript, Tailwind, Supabase (`ddfboapzwclecbdjoqex`), Vercel.
**Pricing:** £29 / £79 / £149 per month.

---

## 2. The object on the line

Nothing runs without a **Page** record. If a feature can be used without one, it is not
part of the product and belongs behind a flag.

```
pages
  id
  stage              -- station 0-8 (§3)
  status             -- queued | in_progress | blocked | done
  opportunity_id     -- provenance from Discovery
  cluster_id
  primary_keyword
  secondary_keywords[]
  intent             -- informational | commercial | transactional | navigational
  winnability_score
  brief_json
  content
  rank_score, aeo_score, geo_score, eeat_score
  entity_coverage
  schema_json, faqs, internal_links
  url
  published_at
  current_rank
  last_action
```

Measurement operates on a finer unit — the **page–keyword pair** (§7).

---

## 3. The production line

Eight stations. Each has an input, an output, and a gate that can refuse to pass work
forward.

```
[0] DISCOVER → [1] KEYWORDS → [2] PLAN → [3] BRIEF → [4] WRITE
                                                          ↓
    [8] DEFEND ← [7] MONITOR ← [6] PUBLISH ← [5] QA ──────┘
             └──────────────────────────────→ back to [3]
```

The arrow from 8 back to 3 is the product. Everyone else stops at 6.

**[0] Discover** — scheduled. YouTube + Reddit + Google Trends + NewsAPI → `opportunities`.
Gate: no searchable demand, no Page. This is a feeder, not a screen users browse.

**[1] Keywords** — DataForSEO `keyword_suggestions` + `keyword_ideas`. Seed forced to
position 0, deduplicated. Gate: volume floor.

**[2] Plan** — semantic clustering → topical map → intent → winnability. One Page per
cluster.
**Critical gate:** if a page already targets this cluster, do **not** create a new Page —
route it to Station 3 as a *revision*. This prevents cannibalisation rather than
detecting it later.

**[3] Brief** — SERP intent match, competitor gap, entity requirements, topical authority
gap → `brief_json`. Claude API call 1. Gate: no brief, no writing, ever.
**All NLP features live here.** They are not tools; they are how this station writes the
specification.

**[4] Write** — Claude API call 2 plus images. Gate: draft must satisfy the brief's
required entities before advancing. Failures go back to 4, not forward to be patched.

**[5] QA** — Claude API call 3 (editorial) → AEO/GEO signals → EEAT → entity check → FAQ
generation → schema + BreadcrumbList → internal links → `sanitiseForTransport()`.
Gate: below threshold does not publish. A gate that never refuses is not a gate.

**[6] Publish** — live URL, `published_at`, keyword registered for tracking.
Gate: publishing without entering rank tracking means the page has fallen off the line.

**[7] Monitor** — daily SERP rank check, AI citation check, freshness clock, decay, intent
drift. Gate: flags Pages for Station 8.

**[8] Defend (Ranking Agent / RANKO)** — diagnose cause → act or propose → send back to
Station 3 as a revision brief → record what changed and what happened. Gate: does not act
on noise (§6.4).

---

## 4. Feature placement

**Stations** are steps. **Instruments** are what a station uses. **Reports** read the line
but never change it. Nothing is both a station and its own menu item — that is how the
current sprawl happened.

| Feature | Station | Type |
|---|---|---|
| Discovery Engine (YouTube/Reddit/Trends/News) | 0 | Station |
| DataForSEO keyword suggestions + ideas | 1 | Station |
| Topical Map Builder | 2 | Station |
| Semantic Similarity | 2 | Instrument |
| Winnability score | 2 | Instrument |
| Cannibalisation Detector | 2 gate | Instrument |
| Ranking Velocity | 2 / 7 | Derived (§5) |
| Content Brief Generator | 3 | Station |
| SERP Intent Matcher | 3 | Instrument |
| Competitor Content Gap | 3 | Instrument |
| Topical Authority Gap | 3 | Instrument |
| Entity Density Analyser | 3 + 5 | Instrument |
| Article generation (call 2) | 4 | Station |
| Image generation | 4 | Instrument |
| LSI Term Injector | 4 | Instrument |
| Editorial review (call 3) | 5 | Station |
| AEO signals (all 10 tools) | 5 | Instrument |
| GEO scoring | 5 | Instrument |
| EEAT Scorer | 5 gate | Instrument |
| Schema Auto-Generator + BreadcrumbList | 5 | Instrument |
| FAQ generator | 5 | Instrument |
| Internal Linking Intelligence | 5 | Instrument |
| GEO Site Auditor (8 signals) | 7 | Station |
| SERP rank tracking | 7 | Station |
| AI Citation Tracker (Perplexity) | 7 | Instrument |
| 90-day freshness automation | 7 | Instrument |
| Content Decay Predictor | 7 | Derived |
| Intent Drift Monitor | 7 | Instrument |
| Weekly Monday digest | 7 | Report |
| Ranking Agent auto re-optimise | 8 | Station |
| Content ROI Dashboard | — | Report |
| Internal Link Topology Visualiser | — | **Park** |
| Backlinks analysis | — | **Park** |
| Product title/description tools | — | **Park** (e-commerce tier) |

**Park** = code stays in the repo, hidden behind a flag, absent from nav and pricing.
Do not delete.

---

## 5. Sources and derivatives

Most of the feature list is not features. It is five data sources with several readings
taken off them. A reading cannot exist before its source, and does not get its own menu
item.

**Source 1 — Rank history** (daily DataForSEO SERP check)
→ current position, **velocity**, **decay**, drop trigger, winnability calibration

**Source 2 — SERP snapshot** (stored per check)
→ intent classification, competitor gap, SERP features, cannibalisation signal

**Source 3 — Content corpus** (user's published pages)
→ entity coverage, semantic similarity, clustering, topical authority gap, link graph

**Source 4 — Citation history** (Perplexity)
→ citation count over time, citability, AI-visibility half of the GEO score

**Source 5 — Change log** (every action, and why)
→ joined to Source 1 over time: change→outcome learning, confidence labels, marginal-ROI,
cross-user patterns

**Source 6 — Google ranking update calendar**
→ core update start/end dates and type, confound covariates for §7.3, confidence
adjustment for the agent, user-facing explanation of unexplained drops

**Endpoints (no scraping needed):**
```
https://status.search.google.com/incidents.json          -- full history, JSON
https://status.search.google.com/incidents.schema.json   -- schema
https://status.search.google.com/en/feed.atom            -- Atom feed for new incidents
https://status.search.google.com/products.json           -- product catalogue
```
Poll the feed daily; backfill history once from `incidents.json`. **All timestamps are
US/Pacific** — normalise before joining to your daily check dates or every window will be
off by up to a day.

**Store the type, not just the presence.** The history contains core updates, spam
updates, reviews updates, helpful content updates, Discover updates, page experience
updates, and separately "Ranking is experiencing an ongoing issue" entries — genuine
ranking faults at Google's end. Those last ones are data-quality flags: rank observations
during them are unreliable for everyone, not evidence about any page.

**Observed rollout durations (from the history):**
- Core updates typically run 12–26 days. March 2024 ran 45 days.
- Spam updates vary widely — under a day to 26 days.
- Roughly 4–8 announced updates a year.
- **Cumulatively this is 20–35% of all days**, depending on the year.

That last figure drives two design decisions (§6.4, §7.3) and it is not intuitive.

**Coverage gap — the dashboard is not the whole story.** `incidents.json` lists announced
*ranking* incidents only. Several changes that move traffic never appear there: the Site
Reputation Abuse policy actions (May and Nov 2024), the AI Overviews rollout (May 2024),
the explicit-fake-content update (July 2024), the desktop page experience rollout. Google
also ships unannounced smaller core updates continuously. So absence from the calendar is
not evidence that nothing changed — treat Source 6 as a high-precision, low-recall signal.
Never tell a user "no update was running, so this is your page's fault."

**Announcement lag.** Completion is sometimes confirmed well after it happens — the March
2024 core update finished on 19 April but was not announced complete until 26 April. Any
window keyed to the announced end date is systematically late by up to a week. Key
analysis windows to the recorded end timestamp, and re-run affected analyses when a
completion date is revised.

**Rollouts happen in stages**, so effects within a window are not uniform. Do not assume
a step change at the start date.

### Update type → agent response

The type matters more than the presence, because different updates operate at different
levels:

| Type | Level | Agent response |
|---|---|---|
| Core update | Site-wide quality | Raise confidence bar; page-level treatments may be futile — flag for site-level review |
| Spam / link spam | Site or link profile | Suppress content treatments; not a content-quality signal |
| Reviews / product reviews | **Page-level** | Treatments remain valid; prioritise review-content pages |
| Helpful content | Site-wide | Same as core. Folded into core from 2024 onward |
| Discover update | **Discover feed only, not Search** | **Ignore for ranking entirely.** A Discover-driven traffic drop is not a ranking problem, and treating it as one is a false positive by construction |
| Page experience / technical | Technical | Route to the site auditor, not to content treatments |
| "Ranking is experiencing an ongoing issue" | Google fault | Suppress fully; discard observations |

Google's own engineers have distinguished core-update effects from ranking-bug effects,
and have stated that core updates build on long-term data — which supports the longer
measurement windows in §7.4 rather than a 28-day readout.

Source 5 is the deepest dependency and needs weeks of data before it returns anything.
Start recording now even while the acting is crude.

### Navigation — six screens

```
Pipeline   -- every Page and the station it sits at. Main screen.
Discover   -- opportunities waiting to enter the line
Plan       -- clusters, topical map, gaps
Write      -- briefs and drafts in flight
Rankings   -- position, velocity, decay, citations, history  (Sources 1 + 4)
Settings
```

Velocity is a column in Rankings. It was never a screen.

### Build-order rule

Source before reading, always:

```
rank tracking → velocity → decay → drop trigger → winnability
```

Build a reading on an unreliable source and you will debug the reading for a week when
the fault was underneath it.

---

## 6. The scoring model

**Google's ranking function cannot be written.** It is learned, query-dependent and
non-stationary. Do not build anything that assumes a closed formula. What is measurable
is how rank *responds* to a change (§7).

Your own scores, however, are your constructions. **Fix the form by reasoning, fit the
coefficients from data. Never invent both.**

### 6.1 Dimensionless ratios

```
authority_ratio  = own_authority / median(top-10 authority)
content_gap      = 1 − (own_entity_coverage / median(top-10 entity_coverage))
intent_match     = cosine(page_intent_vector, SERP_intent_vector)   ∈ [0,1]
serp_volatility  = stdev(top-10 composition, trailing 30 days)
```

Dimensionless means comparable across sites, niches and time. Raw scores are not.

### 6.2 Winnability — a probability, not a score

```
z = β₀ + β₁·authority_ratio + β₂·content_gap + β₃·intent_match
        + β₄·serp_volatility − β₅·commercial_intensity

W = 1 / (1 + e^(−z))          ∈ (0,1)
```

Logistic because the outcome is binary (reaches top 10 or doesn't). `W` is checkable: if
100 pages score 0.7 and 30 succeed, the model is wrong and you will see it. A 0–100 score
can never be wrong, which is why it is worthless.

Betas start as declared priors, become fitted once ~200 units resolve. Store every
prediction so it can be scored later. Validate with a reliability plot.

### 6.3 CTR curve and expected value

```
CTR(p) ≈ a · p^(−b)              -- fit a, b from real Search Console data, per intent

EV(t,u) = P(effect | t,band) × [CTR(p′) − CTR(p)] × volume × value_per_visit − cost(t)
          where p′ = p + E[Δposition | t, band]   (from the gradient table, §7)
```

Allocation: rank all (unit, treatment) pairs by `EV / cost` descending, spend budget down
the list, **stop where EV ≤ 0**. Doing nothing is a valid output — that is RANKO's
restraint expressed as a number rather than a personality trait.

### 6.4 Velocity and decay — fixes a current bug

```
v = fitted slope of position on time over trailing window     (NOT last minus first)

decay_flag = (v > 0 sustained over k consecutive checks)
             AND (|v| > noise_threshold(band))
```

**Sign convention: negative Δposition is good** (15 → 12 is −3). Keep this everywhere.

**`noise_threshold` must scale with band.** Position 50 wobbles several places daily as
normal behaviour; position 3 does not. The current fixed drop-of-3 rule is roughly right
at the top and badly wrong at the bottom — estimate thresholds empirically as the stdev
of untreated units per band. This is a large share of the current false triggers.

**Action thresholds, per Google's own guidance.** Google's core update documentation
draws the line explicitly: a small drop (position 2 → 4) warrants no action, and it
explicitly advises against changing content that is already performing well. A large
drop (4 → 29) warrants deeper assessment. Use that as the default shape — the agent
should not touch a page that slipped two places, and the burden of proof rises the
better the page is already doing. These are defensible defaults from the search engine
itself rather than invented constants, and they should be stated as priors in the UI.

**Core update handling — do not suppress outright.** The obvious rule is "don't act
during a rollout, then wait a further week." Google's own guidance says exactly that. But
announced rollouts cover 20–35% of days, and the March 2024 core update alone ran 45
days — so "rollout plus a week" would have meant nearly two months of a paid product
doing nothing, and blanket suppression would idle the agent for roughly a quarter of the
year.

Use a graded response instead:

```
during an announced rollout:
  - raise the confidence bar: require a larger sustained move before acting
  - prefer additive treatments (T01 FAQ, T03 entity gap) over removals or rewrites
  - never act on a page that was performing well before the rollout began
  - label every action taken during the window; it is a covariate later (§7.3)
during a "Ranking is experiencing an ongoing issue" incident:
  - suppress fully. That is a fault at Google's end, not a signal.
```

Tell the user which state they are in and why. "We're holding off on aggressive changes
until the May core update finishes rolling out" is a better product experience than
silence, and it is also correct.

### 6.5 The composite RANK score

The form is fine; the weights are guesses. Once outcomes exist, regress sub-scores
against actual position change and normalise the fitted coefficients into weights.

Expect some sub-scores to come out near zero — those features are not earning their place.
Expect weights to differ by intent and band; one global RANK score is probably wrong.
Refit quarterly. Hold out a test set or you are measuring your own reflection.

### 6.6 Guard against

- **Fake precision.** Never report 73.6. Bands, or a number with an interval.
- **Borrowed constants.** No coefficient from an industry blog post. Fit it or declare it
  a prior.
- **Unfalsifiable scores.** If no observation could prove it wrong, it measures nothing.

---

## 7. The experiment engine

The innovation: SEO runs on folklore because nobody can both make a change and measure
its effect. SEORANKO can. Every action becomes a controlled experiment.

### 7.1 Unit and treatment

Unit of analysis is the **page–keyword pair**, banded (1-3 / 4-10 / 11-20 / 21-50 / 51+).
Effects are reported per band; pooling bands produces a meaningless average.

A treatment is **one atomic named change**:

| ID | Treatment | Mechanism tested |
|---|---|---|
| T01 | Add structured FAQ block | Question coverage |
| T02 | Answer-first rewrite of opening | Answer proximity |
| T03 | Fill entity coverage gap | Topical completeness |
| T04 | Inject schema | Machine readability |
| T05 | Freshness refresh, no substantive change | Date signal alone (**placebo**) |
| T06 | Add N internal links pointing in | Internal authority |
| T07 | Restructure headings to SERP questions | Query-section matching |
| T08 | Rewrite title for intent match | Relevance and CTR |
| T09 | Expand length to competitor median | Depth |
| T10 | Fill competitor subtopic gap | Coverage breadth |

T05 is deliberately near-null. If it moves rankings, that is a finding; if it doesn't, it
proves the other effects aren't merely "Google noticed the page changed."

### 7.2 Assignment — staggered waves, not held-back controls

Holding half of a customer's pages back is unsellable. Use a **stepped wedge**: every
eligible unit eventually receives every treatment it qualifies for; what is randomised is
*when*. Untreated waves serve as controls during the overlap.

Honest to sell ("we roll out in waves so we can measure"), and clean causally, because
wave order is unrelated to how a page would have performed anyway.

**Measurement starts at `indexed_at`, not `applied_at`** — counting from the edit mixes in
crawl latency that varies by site.

### 7.3 The confound that will ruin this

**Regression to the mean.** Pages get treated *because* they dropped, and dropped pages
partly recover on their own. Treat dropped pages, measure recovery, and everything looks
effective — including nonsense.

Controls must come from the **same trigger condition**: units that also dropped and also
qualified, but whose wave has not come up. Comparing treated-dropped pages against healthy
untreated pages produces confident, entirely false results.

Also handle: core updates (**see below — do not exclude**), site-wide changes (cluster SEs
by domain), multiple treatments (28-day washout, one live treatment per unit), sibling
cannibalisation (exclude units whose cluster changed mid-window).

**Core updates: control for them, do not exclude them.** The instinct is to throw out any
measurement window overlapping an announced update. With rollouts covering 20–35% of days
and post-windows running 28 to 180 days, almost every window overlaps something — that
rule would discard most of the dataset and bias what remained toward unusually quiet
periods.

The stepped wedge already handles this, and this is the strongest argument for that
design: treated and not-yet-treated units live through the same update at the same time,
so a difference-in-differences estimate nets the update out automatically. What you add is
bookkeeping, not exclusion:

- record `update_overlap` per unit-window: which updates, which type, how many days
- include update type as a period effect in the model
- run the analysis twice — all windows, and clean windows only — and report both. If the
  estimates diverge sharply, that itself is a finding about update sensitivity.

Exclude only the "Ranking is experiencing an ongoing issue" incidents, where the
observations are measuring a fault rather than a ranking.

### 7.4 Measurement

Difference-in-differences:

```
effect = (post_treated − pre_treated) − (post_control − pre_control)
```

Pre-period 14 days before `indexed_at`; post measured at 7/14/21/28 days.
Outcomes: Δposition (primary), reached top 10 (binary), **Δcitation rate** (§7.5).

**28 days is too short for some treatments — correct this.** Google states that some
changes take effect within days, but that confirming a site as a whole now produces
helpful content can take several months, and may require waiting for the next core
update. So technical treatments (T04 schema, T08 title) plausibly resolve inside 28 days,
while substantive content treatments (T03 entity gap, T09 depth, T10 coverage) may not.
Keep measuring to 90 and 180 days for the content treatments, and expect the 28-day
readout on those to understate the effect. A treatment that shows null at 28 days is not
yet a treatment that does nothing.

**The site-level tension, stated honestly.** Google frames quality assessment at the level
of the whole site, not the individual page, and explicitly warns against "quick fix"
changes made because something was heard to be bad for SEO. A library of atomic page-level
treatments is exactly the pattern that warning describes. Two implications: expect several
treatments to return genuine nulls, and treat that as a finding worth publishing rather
than a failure. And consider adding site-level treatments — pruning unhelpful sections,
improving coverage across a cluster — as a separate treatment class with its own longer
measurement window. The point of the engine is to find out which framing is right, which
is more than anyone selling optimisation scores can currently say.

Statistical hygiene: cluster SEs by domain (50 pages on one site is nearer n=1 than n=50);
pre-register hypothesis and analysis; minimum ~100 units per treatment per band before
reporting; Benjamini–Hochberg correction across the ~50 comparisons; report effect size
with CI, never a bare p-value.

### 7.5 The open question nobody has tested

Everyone assumes what makes Google rank a page also makes an LLM cite it. Nobody has
checked. The Perplexity tracker is the instrument.

Run every treatment against both outcomes, correlate the two effect vectors across
treatments. All three possible findings are publishable — they move together, they
diverge, or some treatments help both and some only one.

**One confound specific to this analysis.** Google has confirmed that AI Overviews are
affected by core updates. So rank and AI-citation outcomes share a common cause: a core
update can move both at once, producing a correlation that has nothing to do with your
treatments. If you report "ranking treatments also improve citation" without controlling
for this, the finding is an artefact.

Two protections: include update periods as a shared period effect for both outcomes, and
report the correlation computed on clean windows separately. This is the single most
likely way for the headline finding to be wrong, so pre-register the handling before you
collect the data — it is also the first thing a reviewer or a sceptical journalist will
ask about.

### 7.6 Station 8 becomes

```
flagged unit
  → check washout (28 days)
  → determine eligible treatments
  → rank by expected effect (early: hypothesis strength; later: EV from §6.3)
  → assign to wave
  → apply ONE treatment; record treatment_id + timestamp
  → wait for reindex; stamp indexed_at
  → observe 28 days
  → write to effects
```

Treatment selection starts rule-based and becomes evidence-ranked as the effects table
fills. That transition is the actual intelligence in the product.

### 7.7 Tables

```
treatments   (id, name, hypothesis, applies_when, implementation, reversible)
units        (id, page_id, keyword, domain, baseline_position, intent, band)
assignments  (unit_id, experiment_id, wave, assigned_at, applied_at, indexed_at, arm)
observations (unit_id, date, position, serp_features, citation_count, source)
effects      (experiment_id, band, window_days, estimate, ci_low, ci_high,
              n_treated, n_control, method, computed_at)
```

### 7.8 What is required before launch

Almost none of the above. Analysis can be done later; **recording cannot be done
retroactively**. Four things only:

1. `treatment_id` stamped on every Ranking Agent action
2. `applied_at` and `indexed_at` timestamps
3. 28-day washout enforced — one live treatment per unit, no exceptions
4. Daily observations stored per unit, never overwritten

**One change at a time, always recorded.** Everything else in §7 is recoverable later.
That is not.

---

## 8. Standing conventions

These are established and should not be changed without discussion:

- `maxDuration = 120` on all improve/generation API routes
- Streaming via `.messages.stream()` for Improve buttons
- Sequential image generation, 1.5s delays, 3-retry logic
- `sanitiseForTransport()` (`src/lib/sanitise-text.ts`) for Unicode stripping
- Shared `aeo-signals.ts` for all AEO tools
- `normalizeUrl()` applied before **every** Supabase read/write involving URLs — prevents
  duplicate www/non-www rows and false "not ranking" results
- Env var is `DATAFORSEO_EMAIL`, not `DATAFORSEO_LOGIN`
- Model assignment: Haiku for mechanical tasks, Sonnet for anything requiring judgement
- Core pipeline lives in `src/lib/article-master.ts`
- Image generation default: Pollinations.ai; Replicate Flux as premium option
- **Never touch API calls or `.env` files during styling work**
- Deploy sequence after every change:
  `git add . → git commit → git checkout main → git pull origin main → git merge [branch] --no-edit → git push origin main`

---

## 9. Governing rules

1. **Every new feature must name its station (§3).** "It would be useful" is not a station.
2. **A station passes work forward, never sideways.** No feature reaches into another
   station's data to do that station's job.
3. **A derived reading never gets its own menu item, and is never built before its source
   is reliable (§5).**
4. **One atomic change per treatment, always recorded (§7.8).**
5. **No rewrites.** Wire existing code into the line.

---

## 10. Work queue

Ordered by dependency. One item per branch, merged before the next.

### Immediate — Ranking Agent reliability

The Ranking Agent is the only launch blocker. It is also the source under five derived
features (§5), so this is not one fix.

1. **Instrument before touching logic.** Add a `rank_checks` log capturing per check:
   keyword, location and device sent, raw rank returned, matched URL, stored canonical
   URL, whether the trigger fired, action taken.
2. **Establish ground truth.** 10–20 keywords on one real site, mixed positions, manually
   checked in incognito at UK locale. Compare against what the agent returns.
3. **Data-in check.** Disagreement with ground truth means the DataForSEO request is wrong
   — locale, device, or engine parameters. Nothing downstream matters until this is right.
4. **Matching check.** Null ranks for pages you know rank = matching failure. Verify
   `normalizeUrl()` is applied to *both* sides of the comparison.
5. **Trigger fix.** Replace last-minus-first with a fitted slope; make the threshold band-
   dependent (§6.4). Require two consecutive checks before firing.
6. **Action check.** Force one re-optimise: confirm content changed, deployed, and the
   rank history chart shows before and after honestly.

Then let it run untouched for seven days and read the logs on day eight.

### While the seven days of logs accumulate

7. Create `pages` table with `stage`. Nothing else changes.
8. Make the existing keyword → cluster → brief → article → publish flow stamp the stage.
9. Add `treatment_id`, `applied_at`, `indexed_at`, and the washout check (§7.8).
10. Fix the sign convention and band definitions everywhere.

### After launch-blocker is cleared

11. Wire Station 7 → 8 properly.
12. Wire Station 8 → 3 — a re-optimise produces a revision brief, not a direct content
    patch. This closes the loop.
13. Collapse nav to the six screens (§5). Velocity and decay become columns in Rankings.
14. Hide everything marked **Park** behind a flag.
15. Wire Station 0 → 1 so Discovery stops being a dead end.
16. Move NLP features into Station 3 as brief inputs; remove from nav.

### Once data supports it

17. Fit the CTR curve from Search Console data.
18. Fit winnability betas; publish the reliability plot.
19. Refit RANK score weights from outcomes.
20. Switch Station 8 from rule-based to EV-ranked treatment selection.

Items 1–6 are the current task. Do not start 11 or later until the seven-day log review
is done.
