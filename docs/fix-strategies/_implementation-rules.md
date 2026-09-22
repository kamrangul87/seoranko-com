# Fix-strategy implementation rules

Standing constraints for every topic implementation in this register.
These are not optional and are not overridden by dossier convenience.

Last updated: 2026-09-22

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
- **Customer-repo PRs are never merged by the agent or by the product.**
  SEORANKO (and any Cursor agent working in this repo) may open a PR on a
  customer repository (e.g. `autodun-ai`). A **human** merges it. The
  fix-flow stops after opening the PR; production verify / recrawl wait for
  a human-confirmed merge. This overrides any standing “always merge PRs”
  preference — that preference applies only to **this** product repo
  (`seoranko-com`), never to customer repos.
- **False precondition → stop.** If a prompt’s stated precondition is false
  (e.g. “PR X is merged” when GitHub still shows it open, or “deployed to
  production” when the live URL still lacks the change), **STOP and report
  the discrepancy**. Do not merge, deploy, or otherwise act to make the
  precondition true. Wait for the human.

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
5. **Merged to `main` (this product repo only).** Never leave a green
   `seoranko-com` PR open. Nothing is done until it is on `main`. This does
   **not** authorize merging a PR on a customer repository — see Constraints.
6. **Report:** what was built, what the tests assert, and anything in the
   dossier that turned out wrong or underspecified.

Step 5 is not optional for `seoranko-com`.
