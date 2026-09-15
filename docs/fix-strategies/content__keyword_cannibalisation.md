# content__keyword_cannibalisation

Status: READY — documented refusal, and the term itself is rejected
Topic: 65 of the issue register
Tier: C — reason 1
Shared facts: `_tier_c_shared_facts.md`
Research title: content__keyword_cannibalisation (topic 65).
Research date: 2026-09-15

---

## why there is no threshold

**"Keyword cannibalisation" is not a Google concept.** No Google
documentation defines it, sets a threshold for it, or describes a consequence
for it. It is industry vocabulary, and this research pass found no primary
source behind it.

That alone disqualifies it: there is nothing to cite, so there is nothing to
threshold.

Underneath the term sit two things that **are** real, and both already have
dossiers:

| Real underlying condition | Where it lives |
|---|---|
| several URLs serving duplicate or near-duplicate content | topics 8–12 (URL duplication), 13–18 (canonical) |
| several distinct pages sharing identical titles or descriptions | topic 33 |

Google's guidance on the first is to consolidate by redirect or
canonicalization, and specifically **not** to generate artificial differences
(H28). That is the actual remedy, and it is mechanical.

## verdict

`not_mechanically_fixable` as framed. The term is not used in product output.

## what the product may report

Nothing under this name. The provable conditions are reported as themselves:
URL duplication, canonical conflicts, or duplicate metadata.

Where several of a site's own pages appear for the same query in GSC, that is
a measurement and may be reported as one — with the date range, and with no
claim that it is harmful (B22, B26).

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | The term "cannibalisation" used in output | no source. Use the provable finding's name |
| 2 | Harm claimed from multiple pages ranking for one query | unsourced |
| 3 | Content consolidation proposed | editorial, and topic 33's H28 says fix the URLs instead where they are duplicates |
| 4 | Pages sharing a topic treated as duplicates | topical overlap is not duplication |
| 5 | Artificial title differences proposed | **H28 explicitly rejects this** |
| 6 | GSC query-level overlap treated as a defect | measurement only |

### Explicitly rejected

- **The term itself in any user-facing output.**
- **Any harm claim.**
- **Generating artificial title or content differences.** H28.
- **Proposing page consolidation or deletion.** Editorial, irreversible, and
  unsourced.

## Cross-references

- topics 8–12, 13–18, 33 (H28), 60, 64
