# Fix-strategy implementation rules

Standing constraints for every topic implementation in this register.
These are not optional and are not overridden by dossier convenience.

Last updated: 2026-09-16

---

## Constraints

- **No language model in any runtime path.** Not for classifying, not for
  choosing a branch, not for authoring a fix. Detectors, routers, and fixers
  are deterministic code.
- **Verifier ≠ fixer.** The verifier must not import the fixer or share its
  code path. Keep them in separate modules.
- **Postconditions assert the live deployed response**, never repo or config
  state. A green repo check is not a postcondition.
- **No text matching on page content anywhere.** Structural signals only
  (status, headers, HTML tree via the shared parser, site-model / git
  evidence). Never match phrases in body copy.
- **Generated artefacts:** where an artefact is produced at build time, the
  fix targets the **generator**, never the emitted output. Use
  `generated-output-guard` before proposing an edit.

## Shared helpers — use, never reimplement

All under `src/lib/fix-strategies/shared/`:

| Helper | Role |
|---|---|
| `hop-recording-fetch` | Record redirect chains (`redirect: 'manual'`) |
| `url-normalize` | Comparison normalize; `preserveQueryAndFragment` for rewrites |
| `canonical-normalize` | GSC / canonical comparison normalize |
| `robots-txt-matcher` | robots.txt path allow/disallow |
| `repo-declared-noindex` | Topic 70 discriminator — repo declares `noindex`? |
| `generated-output-guard` | Generator vs artefact vs human-review |
| `html-parser` | Structural HTML (not regex on prose) |
| `response-signals` | `hasNoindexDirective`, canonical extract / self-canonical |

If a helper lacks something the topic needs, **extend the helper**. Never
copy a local variant into a topic folder.

## Product decisions

Any threshold not traceable to `docs/fix-strategies/_sources.md` belongs in
`src/lib/fix-strategies/product-decisions.ts`, with a comment stating it is
a **product decision, not a sourced threshold**. Unset knobs stay `null` and
are listed in `_open-questions.md` until set.

## Definition of done — every item required

1. **Detector, guards, fixer, verifier** (verifier separate from fixer).
2. **Fixture** covering the dossier's cases, including suppression cases.
3. **Tests and typecheck green** locally.
4. **CI green** on the PR.
5. **Merged to `main`.** Never leave a green PR open. Nothing is done until
   it is on `main`.
6. **Report:** what was built, what the tests assert, and anything in the
   dossier that turned out wrong or underspecified.

Step 5 is not optional.
