# content__off_page_backlinks_citations

Status: READY — documented refusal
Topic: 66 of the issue register
Tier: C — **reason 3** (out of scope by product decision)
Shared facts: `_tier_c_shared_facts.md`
Research title: content__off_page_backlinks (topic 66).
Research date: 2026-09-15

---

## why this is out of scope

**This is a scope boundary this product chose, not something Google
forbids.** The distinction matters and the dossier states it plainly.

The reason is structural: a fix would happen on someone else's website. There
is no file in the connected repo to change, no live response to assert
against, and no rollback. Every requirement in this product's doctrine fails
at once.

Google's own guidance reinforces why autonomous action would be wrong rather
than merely impossible:

- link spam is links created primarily to manipulate rankings (T23), with a
  published list of examples (T24)
- **most sites do not need the disavow tool** (T26)
- disavow only where a considerable number of spammy links exist **and** they
  caused or are likely to cause a manual action (T27)
- the sequence is removal first, disavow only what cannot be removed,
  reconsideration after cleanup (T28)
- **disavowing random links reported by an SEO tool is not recommended, and
  incorrect use can harm Search performance** (T29)

T29 is decisive. An autonomous backlink classifier acting on its own judgement
is precisely the thing Google warns against, and it can make things worse.

There is also no data: this product has no backlink API, which is a standing
decision. So even the reporting version has no input.

## verdict

`not_mechanically_fixable`. Permanently out of scope for the fix agent.

## what an honest future version would look like

If served at all, it is **reporting a gap and handing a human a task** —
never fixing. And that requires a backlink data source the product does not
have.

Two things in this area **are** in scope and already have dossiers, because
they are on-page:

| In scope | Where |
|---|---|
| a site's own **outbound** paid or sponsored links lacking `sponsored`/`nofollow` | topic 23a — sourced to T25 |
| a paid link mislabelled `ugc` | topic 23b |

Those are the site's own markup, in its own repo, with a live postcondition.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Backlinks classified as spam by the product | T29. Never |
| 2 | A disavow file generated or proposed | T26, T27, T29 |
| 3 | Outreach or link removal drafted | not a repo transform |
| 4 | Absence of backlinks reported as a defect | no source |
| 5 | Off-page framed as blocked by Google rather than by scope | state the real reason |
| 6 | The site's own outbound link qualification treated as off-page | topic 23 — that is on-page and in scope |

### Explicitly rejected

- **Autonomous backlink classification.** T29.
- **Generating disavow files.** T26, T27.
- **Link-building, outreach, or directory submission of any kind.**
- **Any "link equity" or PageRank framing.** Used and rejected five times
  across this register.
- **Implying Google prohibits this.** The boundary is this product's.

## Cross-references

- topic 23 (23a, 23b — the on-page counterpart); topics 60, 65
