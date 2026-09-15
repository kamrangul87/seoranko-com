# indexability__nofollow_on_internal_links

Status: READY — verdict is a documented refusal
Topic: 23 of the issue register
Tier: C
Shared facts: `_robots_shared_facts.md`; link-attribute facts below
Research title: links__nofollow_on_internal_links (topic 23).
Research date: 2026-09-15

---

## what's actually wrong

Nothing provable. This dossier exists to record why.

The topic as originally framed — "`nofollow` on internal links that should
pass signals" — assumes a mechanism the sources do not support.

## primary source

- Google, Evolving nofollow — new ways to identify the nature of links
  (September 2019) — announcement of `sponsored` and `ugc`
- Google, Qualify your outbound links to Google —
  https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links

### Verified facts

| Fact | Status |
|---|---|
| Since 10 Sept 2019, `nofollow`, `sponsored` and `ugc` are **hints**, not directives, for ranking | verified |
| Since 1 Mar 2020, they are hints for crawling and indexing too | verified |
| The attributes describe the **nature of the link**, not the state of the destination | verified |
| Publishers were explicitly told they do not need to update existing `nofollow` links | verified |
| `nofollow` remains the catch-all where `sponsored` and `ugc` do not apply | verified |
| Multiple values may be combined space-separated | verified |
| Paid or monetised links must be qualified with `sponsored` or `nofollow`; leaving them unmarked, or mislabelling them `ugc`, risks a link-scheme violation | verified |

## why there is no threshold

Three reasons, each sufficient on its own:

1. **"Should pass signals" is not a mechanical property.** Nothing in the
   response or the repo distinguishes an internal link that ought to pass
   signals from one deliberately qualified.
2. **The attribute is a hint.** Google may crawl and use a nofollowed link
   anyway. So its presence does not prove the link is excluded from anything,
   and its removal does not prove anything is gained.
3. **Google publishes no harm claim.** There is no documented consequence to
   measure, so there is no postcondition to assert. Under the hard filter,
   that alone disqualifies it.

Removing `nofollow` from internal links would also be a change with no finding
behind it — the same reason adding canonicals site-wide was rejected in topic
13.

## what IS mechanically checkable, and belongs here

Two narrow, sourced findings — both about link *qualification*, not about
signal flow:

### 23a — unqualified paid or sponsored link

**threshold:** a link the site itself identifies as paid, affiliate or
sponsored (via its own markup, a known affiliate domain pattern, or a
disclosed partner list) carries neither `sponsored` nor `nofollow`.

Sourced: unmarked paid links risk a link-scheme violation.

**verdict:** `human-review`. Whether a link is paid is knowledge the agent
does not have; it can only flag candidates. Never auto-add `sponsored` to a
link whose commercial nature is inferred.

### 23b — `ugc` on a paid link

**threshold:** a link carries `ugc` and is also identifiable as paid.

Sourced: mislabelling a paid link as `ugc` carries the same risk as leaving it
unmarked.

**verdict:** `human-review`.

## verdict

`not_mechanically_fixable` as originally framed. No threshold, no
postcondition, no documented harm.

23a and 23b are `human-review` report-only, and only where the commercial
nature of the link is established by the site rather than guessed.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | Internal link carries `nofollow` | not a finding. It is a hint and describes the link, not the destination |
| 2 | Commercial nature of a link is inferred rather than stated | never raise. Flagging an ordinary link as paid is worse than missing one |
| 3 | `nofollow` combined with `sponsored` | correct, backward-compatible usage |
| 4 | Link is to a dead destination | topic 1. `nofollow` never suppresses that finding |

### Explicitly rejected

- **Removing `nofollow` from internal links.** No finding behind it.
- **Treating `nofollow` as a guard for any other topic.** Rejected three times
  already in topics 1 and 5 — the attribute says nothing about whether the
  destination resolves.
- **Inferring that a link is paid from its destination domain alone.**
- **Any claim about signal or equity flow through internal links.** Not
  Google's vocabulary, no published mechanism.

## fixture

Internal link with `nofollow`; a site-declared affiliate link with no
qualification; a site-declared affiliate link marked `ugc`; a link with
`nofollow sponsored`; a nofollowed link to a 404.

CI asserts: nothing raised for the first and fourth; 23a for the second; 23b
for the third; topic 1 raised for the fifth regardless of the attribute.

## Cross-references

- topic 1 — `nofollow` rejected as a guard there
- topic 5 — and there
- topic 66 — off-page, also out of scope
