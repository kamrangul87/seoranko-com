# gsc__google_chosen_canonical_mismatch

Status: READY
Topic: 55 of the issue register
Tier: B — connection-required
Shared facts: `_gsc_shared_facts.md`
Research title: gsc__google_chose_different_canonical (topic 55).
Research date: 2026-09-15

---

## what's actually wrong

The site declares one canonical URL; Google selected a different one.

## threshold

The URL Inspection API reports a Google-selected canonical differing from the
site's declared canonical, **after canonical normalisation** (B23 rules).

Related GSC states, and they are not the same finding:

| State | Source | Treatment |
|---|---|---|
| Duplicate, Google chose another canonical | B2 | **this finding** |
| Duplicate without user-selected canonical | B2 | no canonical declared → topic 13 |
| Alternate page with proper canonical | B2, B4 | **correct behaviour.** Never raise |
| Page with redirect | B2, B4 | correct if intentional |

The third row is the critical exclusion: "Alternate page with proper
canonical" means the site's declaration was honoured. It appears under
"Not indexed" and is not a defect (B4).

**Google's canonical choice is not a defect in itself.** A canonical is a
strong hint, not a command (canonical block, C6). The finding is that the
site's intent and Google's outcome diverge, which is worth knowing and usually
indicates a signal conflict elsewhere.

## detect

1. Read the declared canonical from the served response — HTML and `Link`
   header (topic 16).
2. Query the URL Inspection API for the Google-selected canonical (B14–B17).
3. Normalise both before comparing. Do **not** collapse trailing slash, path
   case, query or port (topic 5 rules) — those differences are the likely
   cause, not noise.
4. Differ → candidate. Record the crawl date (B5).

Because of B18, the API cannot be run across every URL daily. Prioritise
pages that matter to the user; state that coverage is partial.

## fix

**None applied directly.** Google chooses canonicals from many signals;
changing the declaration alone may not change the outcome, so there is no
transform with a reliable postcondition.

What the agent contributes is the **diagnosis of which conflicting signal is
likely responsible**, and every input is mechanical:

- duplicate URL forms serving 200 (topics 8–12)
- internal links pointing at the non-declared form (topic 42)
- the sitemap listing the non-declared form (topics 26, 27)
- an HTML/header canonical conflict (topic 16)
- multiple canonical declarations (topic 17)
- the declared canonical being non-200 or noindexed (topics 14, 15)

Fixing those is where the real work is, and each has its own dossier. This
topic's job is to point at them.

## postcondition

Not assertable in one pass. Google's canonical selection changes on its own
schedule, so the postcondition is **deferred**: re-query the API after the
contributing fix has been verified live, and record whether the selection
changed. That is a measurement, not a guarantee.

## verdict

`connection-required`, and `not_mechanically_fixable` for the mismatch itself.
`auto-detectable` for the mismatch and for the contributing-signal diagnosis.

Where no GSC connection exists: **silent.** Not a false negative, and not
reported as "no issues found".

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | State is "Alternate page with proper canonical" | the declaration was honoured (B4). Never raise |
| 2 | Compared without canonical normalisation | false differences. Normalise first (B23) |
| 3 | Normalisation collapsed slash, case, query or port | those differences are the cause. Never collapse |
| 4 | Reported as a current fault | historical (B5). State the crawl date |
| 5 | No canonical declared at all | topic 13, not this finding |
| 6 | No GSC connection | silent. Never report as clean |
| 7 | API state string used as sole evidence | labels may be coarse. Corroborate with the served response |
| 8 | Coverage partial due to the 2,000/day cap | state the partial coverage (B18) |

### Explicitly rejected

- **Treating Google's canonical choice as an error.** It is a hint, not a
  command.
- **Raising on "Alternate page with proper canonical."**
- **Claiming a fix will change Google's selection.** No reliable
  postcondition.
- **Raw URL string comparison.** B23.

## fixture

Declared `/page`, Google chose `/page/`; state "Alternate page with proper
canonical"; no canonical declared; declared canonical returning 404; a
mismatch where the sitemap lists the other form; no GSC connection.

CI asserts: raised with the sitemap conflict named for the first and fifth;
**suppressed** for the second; routed to topic 13 for the third; routed to
topic 14 for the fourth; silent for the sixth.

## Cross-references

- topics 8–12, 13–18, 26, 27, 42; topic 5 normalisation
