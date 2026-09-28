# SEORANKO positioning — single source of truth

## The claim

> Finds the technical problems that stop Google indexing your site properly,
> fixes them in your code, and proves the fix is live.

Every user-facing surface — homepage, signup, dashboard, upgrade prompts,
change-monitoring copy, shareable reports — derives from this. Don't write a
separate positioning statement anywhere; link back or quote this one.

## Rules — apply everywhere, not just the homepage

1. **Never claim rankings, traffic, position, visibility, or penalty
   avoidance.** Not "improve your ranking," not "boost visibility," not
   "avoid a penalty," not "drive traffic." SEORANKO finds and fixes
   *indexing and technical* problems. What Google's ranking algorithm then
   does with a technically-clean page is not something this product
   observes, controls, or predicts.
2. **Never predict the effect of a fix.** A fix is described by what
   changed (e.g. "robots.txt no longer disallows /blog"), never by what
   that change is expected to cause. See
   `docs/fix-strategies/OWNER_COPY_VERDICT_LIST.md` and
   `src/lib/fix-strategies/findings-ui/owner-copy.ts` — the same discipline
   already enforced there for per-finding copy applies to every other
   surface too.
3. **"In your code" is the honest scope.** Automated fixes commit to a
   GitHub-connected repository (`ConnectSiteModal` → GitHub App or PAT →
   PR). WordPress, Shopify, and Wix sites get the audit — findings,
   plain-English explanations, why-not-fixed reasons — but not an automated
   fix. Any surface describing what SEORANKO does for a non-GitHub site
   must say so; never imply the same "fixes it" claim for a platform the
   product can't write to.
4. **"Proves the fix is live" is the differentiator, and it means something
   specific: SEORANKO re-fetches the real, deployed response after a fix
   ships and asserts against *that* — not the repo diff, not a build log,
   not a config file.** A PR merging is not proof. A deploy succeeding is
   not proof. Only a verified live response is proof. This is what
   separates SEORANKO from a linter or a static audit tool, and it's the
   one claim allowed to be stated plainly and often.
5. **Topics 60–66 are documented refusals, not gaps.** See
   `docs/fix-strategies/_tier_c_shared_facts.md`. SEORANKO does not
   generate an E-E-A-T score, does not judge "keyword cannibalisation," and
   does not autonomously classify or disavow backlinks — not because these
   are unbuilt features, but because Google's own documentation says
   they're not machine-checkable, or not verifiable from a repo change, or
   both. When this comes up publicly, say what it is: a sourced decision
   not to guess, not an apology for a missing feature.

## Enforcement

`src/lib/fix-strategies/findings-ui/owner-copy.test.ts` scans homepage copy
(`src/app/page.tsx`'s exported `HOMEPAGE_COPY`) for the banned words in rule
1, case-insensitively, plus a same-purpose regex already covering the
findings verdict copy. A new banned term belongs in
`src/lib/copy-rules.ts`'s `BANNED_CLAIM_WORDS_RE` — one place, checked
everywhere that imports it.
