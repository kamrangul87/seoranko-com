# Fix strategies

Build-time dossiers for SEORANKO’s Fix Agent. Each finding code has one
deterministic strategy, specified here next to the code that implements it.
Cursor reads these documents when implementing; CI tests against the fixtures
they name. **No language model reads these at runtime** — they are build-time
documents only.

## Hard filter

If `threshold` and `postcondition` cannot be filled with concrete
machine-checkable values, the finding is not auto-fixable yet. Leave the
fields empty and keep the stub status until research closes them.

## Guards matter most

`false-positive guards` and `Explicitly rejected as guards` are the most
important sections. A tool that fixes 40 things and wrongly touches one is
worse than a tool that fixes 15 and never gets it wrong.

## Sources

Every threshold must trace to a row in [`_sources.md`](./_sources.md). When a
cited source changes, that register shows which strategies are now suspect.

## Status

| Metric | Count |
|---|---|
| Topics in the register | 70 |
| Researched (full dossier in this repo) | 1 |
| Implemented | 1 |
| Proven live | 1 |

Topic 1 (`broken-internal-link__target_returns_4xx`) is researched and ready
for implementation. Topic 40 (`remove-dead-anchors`) is implemented and proven
live. Topics 43 and 44 have dossiers written outside this repo (stubs marked
accordingly). The rest are `NOT RESEARCHED` stubs.
