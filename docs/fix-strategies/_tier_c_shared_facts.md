# Shared facts — Tier C block (topics 60–66)

Research date: 2026-09-15

## What a Tier C dossier is for

Not a threshold. A **documented refusal**: the sourced reason no deterministic
transform exists, so the agent can decline expertly instead of silently — or
worse, guess.

A Tier C verdict fails the hard filter for one of three distinct reasons, and
the dossier must say which:

1. **No published criterion.** Google gives editorial questions, not
   machine-checkable values (topics 60, 63, 64).
2. **Published criterion, unassertable postcondition.** The threshold exists
   but is a field metric measured on real users over time, so a repo change
   cannot be verified against it (topics 61, 62).
3. **Out of scope by product decision.** A transform might exist but not in a
   file this product can change (topic 66).

Reason 2 is the one most easily mistaken for reason 1. Core Web Vitals has
exact numbers. That is not the problem.

## primary source

- Google, Creating helpful, reliable, people-first content —
  https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google, Spam policies —
  https://developers.google.com/search/docs/essentials/spam-policies
- Google, Disavow links —
  https://support.google.com/webmasters/answer/2648487
- web.dev, Core Web Vitals workflows and tools —
  https://web.dev/articles/vitals-tools

## Verified facts — helpful content

| # | Fact | Status |
|---|---|---|
| T1 | Google provides **self-assessment questions, not machine-checkable thresholds** | verified |
| T2 | Areas covered: original reporting/research/analysis; substantial and complete treatment; added value beyond rewriting sources; accurate titles and headings; demonstrable first-hand experience or expertise; clear sourcing and authorship; no easily verified factual errors; a useful satisfying outcome; a clear site purpose and intended audience | verified |
| T3 | Warning signs: mass production across unrelated topics; extensive automation without added value; **writing to arbitrary word counts**; summarising others without insight; false freshness; content created primarily to attract search traffic | verified |
| T4 | These questions require editorial judgment and should support human review, not an automated helpful/unhelpful finding | verified |

T3 is worth noting against topic 60: Google names writing to arbitrary word
counts as a *warning sign*. A word-count threshold would therefore be both
unsourced and pointed the wrong way.

## Verified facts — E-E-A-T and raters

| # | Fact | Status |
|---|---|---|
| T5 | **"E-E-A-T itself isn't a specific ranking factor."** Google's own wording | verified |
| T6 | Google uses a mix of ranking signals that may align with Experience, Expertise, Authoritativeness, Trustworthiness | verified |
| T7 | **Trust** is described as the most important element | verified |
| T8 | Strong E-E-A-T alignment receives greater attention for YMYL subjects | verified |
| T9 | Quality raters do **not** control individual rankings | verified |
| T10 | Rater ratings do **not** directly feed into ranking algorithms | verified |
| T11 | Raters evaluate whether ranking-system changes produce helpful results, using the Quality Rater Guidelines as an evaluation framework | verified |

## Verified facts — Core Web Vitals

| # | Fact | Status |
|---|---|---|
| T12 | CrUX is **real-user field data** from an eligible subset of Chrome users | verified |
| T13 | Assessment uses a **rolling 28-day window** | verified |
| T14 | Evaluated at the **75th percentile** | verified |
| T15 | Reported separately for mobile and desktop | verified |
| T16 | Requires sufficient traffic and sample data | verified |
| T17 | Good thresholds: **LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1** | verified |
| T18 | A page or origin passes when at least 75% of measured visits meet the good threshold for each metric | verified |
| T19 | Changes appear **gradually**, because older observations remain in the 28-day window | verified |
| T20 | Lighthouse results are **lab diagnostic simulations**, not CrUX field results | verified |
| T21 | **Missing CrUX data means insufficient eligible observations, not poor performance** | verified |
| T22 | CrUX does not represent every browser or every user | verified |

T21 is the guard most tools get wrong — they report "no data" as a failure.

## Verified facts — link spam and disavow

| # | Fact | Status |
|---|---|---|
| T23 | Link spam is links created to or from a site primarily to manipulate rankings | verified |
| T24 | Examples: buying or selling ranking links; goods or services exchanged for links; excessive reciprocal schemes; automated link creation; low-quality directory links; optimised forum-comment links; distributed widget or template/footer links; low-value content created primarily for linking signals | verified |
| T25 | Paid or sponsored links are permitted when qualified with `rel="sponsored"` or `nofollow`; user-generated links should generally use `ugc` or `nofollow` | verified |
| T26 | **Most sites do not need the disavow tool** | verified |
| T27 | Disavow only when **both** hold: a considerable number of spammy, artificial or low-quality backlinks exist, **and** they caused or are likely to cause a manual action | verified |
| T28 | Recommended sequence: attempt removal first; disavow only what cannot be removed; submit reconsideration after cleanup if a manual action exists | verified |
| T29 | Disavowing random links reported by an SEO tool is **not recommended**, and incorrect use can harm Search performance | verified |

## Not adopted across the whole block

- **Any "E-E-A-T score".** T5 — not a ranking factor. Presenting a score as a
  Google metric would be inventing a metric Google says does not exist.
- **Word-count thresholds for content quality.** T3 points the other way.
- **Treating missing CrUX data as poor performance.** T21.
- **Treating Lighthouse scores as Core Web Vitals assessment.** T20.
- **Autonomous backlink classification or disavowal.** T29.
- **"Keyword cannibalisation"** as a Google concept — see topic 65.
