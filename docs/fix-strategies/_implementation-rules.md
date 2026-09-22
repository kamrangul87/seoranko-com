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
- **Agent never merges customer-repo PRs.** A Cursor agent working during
  development must **never** merge a pull request on a customer repository
  (e.g. `autodun-ai`). Open the PR and stop. Standing “always merge PRs”
  preferences apply only to **this** product repo (`seoranko-com`).
- **Product auto-merge is opt-in and gated.** Default is OFF
  (`connected_sites.auto_merge_enabled = false`). The **product** (runtime
  fix-flow) may merge a customer PR **only when** all of the following hold:
  1. The connected site has `auto_merge_enabled = true` (Autodun is opted in).
  2. The finding verdict is **auto-fixable** (never human-review, never
     report-only).
  3. CI is green on the PR (real check-run / status evidence — zero checks
     is not green).
  4. Preview verifier passed against **real page content** (the auth-wall
     guard must confirm it is not a login / Vercel SSO interstitial).
  5. **Single-file blast radius** — the PR touches exactly one file, and that
     file is not site-wide config or a shared layout (`vercel.json`,
     `next.config.*`, `robots.txt`, sitemaps, `app/layout.*`, `middleware`,
     etc.). Those always stay human-review regardless of the setting.
  After an auto-merge: verify production. If production verify **fails**,
  automatically open a **revert PR** and flag for human attention — never
  leave a failed fix live. Every auto-merge writes
  `FIX_VERIFY_OUTCOME_RECORD.md` with `auto_merged: true`.
  Otherwise a **human** merges.
- **False precondition → stop.** If a prompt’s stated precondition is false
  (e.g. “PR X is merged” when GitHub still shows it open, or “deployed to
  production” when the live URL still lacks the change), **STOP and report
  the discrepancy**. Do not merge, deploy, or otherwise act to make the
  precondition true. Wait for the human (or for product auto-merge gates to
  hold on their own — the agent must never force them).

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
   `seoranko-com` PR open. Nothing is done until it is on `main`. The
   **agent** never merges customer-repo PRs; the **product** may only under
   the opt-in auto-merge gates in Constraints.
6. **Production deployment on `main` reaches Ready.** A green PR / green
   preview is **not** done. After merge, confirm the Vercel **Production**
   deploy for that commit is Ready. If Production fails (e.g. migrate step
   in `vercel-production-migrate.sh`), **stop and fix before anything else**
   — do not start new work on a brick main deploy.
7. **Report:** what was built, what the tests assert, and anything in the
   dossier that turned out wrong or underspecified.

Steps 5 and 6 are not optional for `seoranko-com`.
