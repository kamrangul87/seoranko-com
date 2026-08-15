# Claude Code Instructions for seoranko-com

## Git Workflow

**Use feature branches and pull requests. Do not commit directly to `main`.**

After every change:

1. Create or switch to a feature branch from `main`:
   ```
   git checkout main && git pull origin main
   git checkout -b <branch-name>
   ```
   Use a short, descriptive branch name (e.g. `fix/login-redirect`, `feat/keyword-export`).

2. Commit on that branch:
   ```
   git add .
   git commit -m 'message'
   git push -u origin <branch-name>
   ```

3. Open a pull request targeting `main`. Merge via the PR when the change is ready.

Never push commits straight to `main`. All work lands through a branch and PR so changes are reviewable and deploys stay predictable.

## Competitor & gap analysis

**Never copy competitor content or name third parties in user-facing UI.**

- Use SERP/citation data to find **gaps and angles** — then implement original content here.
- Do not paste competitor prose, structure, or branding into articles or UI.
- Anonymize domains in the product: show generic labels like "another site" or "an official source", not `gov.uk`, `zapmap.com`, etc.
- Internal analysis may use raw URLs; user-visible strings must go through `src/lib/competitor-privacy.ts`.
