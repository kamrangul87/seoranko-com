# Post-#208 locked routes inventory

Source: PR #208 (`0870edf`). Behaviour after the customer-reopen follow-up:
the 14 spend/write routes that the dashboard still calls for normal users
use session auth (`requireSignedInUser`), not `requireMasterUser`.

| Route | Old auth | New behaviour |
|-------|----------|---------------|

<!-- goneLegacy files on disk: 49 -->
| `/api/article` | none/user | 410 |
| `/api/article-v2` | none | 410 |
| `/api/article-competitor` | none | 410 |
| `/api/article-download` | none | 410 |
| `/api/article-fix-all` | user | 410 |
| `/api/article-improve` | user | 410 |
| `/api/article-improve-score` | none | 410 |
| `/api/article-quality-recheck` | user | 410 |
| `/api/articles/manage` | user | 410 |
| `/api/export-article` | user | 410 |
| `/api/fetch-article-content` | user | 410 |
| `/api/improve-article` | user | 410 |
| `/api/improve-article-stream` | none | 410 |
| `/api/humanize` | none | 410 |
| `/api/keywords` | master/user | 410 |
| `/api/keywords/expand` | user | 410 |
| `/api/keywords/build-page` | user | 410 |
| `/api/regenerate-images` | none | 410 |
| `/api/images` | user | 410 |
| `/api/serp-intent` | none | 410 |
| `/api/pipeline/write` | none | 410 |
| `/api/pipeline/search` | none | 410 |
| `/api/pipeline/classify` | none | 410 |
| `/api/pipeline/verify` | none | 410 |
| `/api/pipeline/audit` | none | 410 |
| `/api/nlp/analyse` | user | 410 |
| `/api/cluster` | master/user | 410 |
| `/api/cannibalization` | user | 410 |
| `/api/topical-map` | user | 410 |
| `/api/rank/check` | none | 410 |
| `/api/rank/checks-report` | user | 410 |
| `/api/rank/diagnose` | none | 410 |
| `/api/rank/ground-truth` | user | 410 |
| `/api/rank/track` | user | 410 |
| `/api/rank/velocity` | none | 410 |
| `/api/ranking-agent/autofix` | none | 410 |
| `/api/ranking-agent/check` | none | 410 |
| `/api/ranking-agent/debug` | none | 410 |
| `/api/ranking-agent/track` | none | 410 |
| `/api/ranko/apply-site-fix` | user | 410 |
| `/api/ranko/connect-site` | user | 410 |
| `/api/ranko/connect-wordpress` | user | 410 |
| `/api/ranko/detect-cms` | user | 410 |
| `/api/ranko/diagnose` | user | 410 |
| `/api/ranko/winnability` | none | 410 |
| `/api/check-citation` | none | 410 |
| `/api/publish` | none (already 410) | 410 |
| `/api/publish/approve` | none | 410 |
| `/api/publish/verify` | user | 410 |

| `/api/detect-platform` | none | session (was master in #208; reopened) |
| `/api/verify-install` | none | session (was master in #208; reopened) |
| `/api/install/github-pr` | none | session (was master in #208; reopened) |
| `/api/sites` | none | session (was master in #208; reopened) |
| `/api/robots-check` | none | session (was master in #208; reopened) |
| `/api/utils/extract-keyword` | none | session (was master in #208; reopened) |
| `/api/link-registry/verify` | none | session (was master in #208; reopened) |
| `/api/geo-audit` | optional/user | session (was master in #208; reopened) |
| `/api/fixes` POST | none | session (was master in #208; reopened; GET remains public) |
| `/api/site-audit/fix` | none | session (was master in #208; reopened) |
| `/api/site-audit/apply-fix` | none | session (was master in #208; reopened) |
| `/api/site-audit/citations` | none | session (was master in #208; reopened) |
| `/api/site-audit/drift` | none | session (was master in #208; reopened) |
| `/api/site-audit/generate-sitemap` | none | session (was master in #208; reopened) |

| `/api/cron/fix-agent-e2e` | cron | cron |
| `/api/cron/fix-failure-digest` | cron (open if unset) | cron |
| `/api/cron/gsc-sync` | cron | cron |
| `/api/cron/repair-articles` | cron | cron |
| `/api/cron/scheduled-recrawl` | cron | cron |
| `/api/cron/verify-link-registry` | cron | cron |
| `/api/cron/verify-liveness` | cron | cron |
| `/api/cron/verify-publications` | cron | cron |
| `/api/cron/weekly-jobs` | cron | cron |
| `/api/internal/heartbeat` | cron | cron |

**Counts:** 48 legacy 410 + 14 session (reopened from master) + 10 cron = 72.

Pre-existing master (not part of the #208 lock set; unchanged — Fix Agent
one-run flow is intentionally master-gated via `canRunFixAgent`; non-master
users keep per-finding fix + crawl/read findings):

| Route | Old auth | Behaviour |
|-------|----------|-----------|
| `/api/fix-strategies/runs` | master | master |
| `/api/fix-strategies/runs/[id]/tick` | master | master |

## Customer paths confirmed unchanged by #208

| Route | Auth |
|-------|------|
| `/api/webhooks/stripe` | Stripe signature only (no session) |
| `/api/billing/checkout`, `/portal`, `/subscription` | signed-in user |
| `/api/gsc/connect`, `/callback`, `/register`, `/properties`, `/inspections` | OAuth/session (not master/410) |
| `/api/auth/signout` | open |
| `/api/fix-strategies/findings`, `/findings/crawl`, `/findings/[id]`, `/findings/[id]/fix` | signed-in user |
| `/api/fix-strategies/runs/[id]` GET | signed-in user |

## UI `fetch('/api/...')` targets that return 401/403/410 for a normal user

**Intentional 410 (retired product surfaces still linked from old dashboard pages):**
article-*, articles/manage, export-article, improve-article*, humanize, keywords*,
cannibalization, topical-map, nlp/analyse, rank/*, ranko/*, serp-intent.

**Intentional master (admin / Fix Agent one-run):**
`/api/admin/*`, `/api/fix-strategies/runs`, `/api/fix-strategies/runs/[id]/tick`.

**Mistaken master in #208 → reopened to session in this follow-up (14):**
detect-platform, verify-install, install/github-pr, sites, robots-check,
utils/extract-keyword, link-registry/verify, geo-audit, fixes POST,
site-audit/{fix,apply-fix,citations,drift,generate-sitemap}.

