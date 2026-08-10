// src/lib/publisher-adapters/github-publisher.ts
// Creates a brand-new content file via the GitHub Contents API and triggers
// a rebuild — genuinely testable in this environment (the user has real
// GitHub + Vercel credentials for autodun.com), unlike the WordPress/
// Shopify/Webflow publishers in this same PR, which are built to their
// documented API shape but unverified against a live account.
//
// Deliberately NOT reusing site-adapters/github-adapter.ts's
// commitFileChange — that function's branch/PR logic exists specifically
// for *editing* a page that already has real visitors, where a direct
// commit is the risky path. Creating a brand-new file has no existing
// content to protect, so this always commits straight to the target
// branch — there's nothing to review-gate that Phase H's human-approval
// gate (enforced one layer up, before publish() is ever called) doesn't
// already cover.
//
// Three distinct states after a commit, per the phase spec: "commit
// accepted" (this file, publish()) → "deployment ready" (Vercel's own
// build, which this file has no visibility into) → "URL returns 200 with
// expected content" (Phase B, a separate provider-agnostic module). This
// file only ever produces PUBLISH_SUCCEEDED_DEFERRED — never claims
// LIVE_UNVERIFIED or LIVE_VERIFIED on its own.

import type {
  PublisherAdapter, PublisherCredentials, PublishArticleInput, PublishResult,
  LivenessCheckResult,
} from './types'

const GH = 'https://api.github.com'

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/
const BRANCH_RE = /^[a-zA-Z0-9._/-]{1,255}$/
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function validate(creds: PublisherCredentials, slug: string): string | null {
  if (!creds.owner || !OWNER_RE.test(creds.owner)) return 'Invalid GitHub owner/organisation name.'
  if (!creds.repo || !REPO_RE.test(creds.repo)) return 'Invalid repository name.'
  const branch = creds.branch || 'main'
  if (!BRANCH_RE.test(branch)) return 'Invalid branch name.'
  if (!creds.accessToken) return 'A GitHub access token is required.'
  if (!SLUG_RE.test(slug)) return `Slug "${slug}" isn't a safe path segment (lowercase letters, digits, hyphens only).`
  return null
}

// {slug} is the only placeholder — kept simple deliberately; extend if a
// real deployment needs more (e.g. {year}/{month}).
function fillTemplate(template: string, slug: string): string {
  return template.replace(/\{slug\}/g, slug).replace(/^\/+/, '')
}

async function triggerDeployHook(creds: PublisherCredentials): Promise<{ fired: boolean; detail: string }> {
  // Per-site hook (creds.deployHookUrl, stored in site_connections.credentials
  // alongside the other per-platform secrets) is the real, multi-tenant
  // mechanism and always takes priority. VERCEL_DEPLOY_HOOK_DEFAULT is a
  // deliberately brand-agnostic single-site fallback for convenience during
  // early testing (e.g. one connected test site with nothing yet stored in
  // its credentials JSONB) — NOT a substitute for per-site config once more
  // than one site is connected. This intentionally does not fall back to
  // site-audit/fix/route.ts's separate VERCEL_DEPLOY_HOOK_AUTODUN, which is
  // that other feature's own env var, not a shared default for this one.
  const hookUrl = creds.deployHookUrl || process.env.VERCEL_DEPLOY_HOOK_DEFAULT
  if (!hookUrl) {
    return { fired: false, detail: 'No deploy hook configured for this site — commit made, but nothing will trigger a rebuild automatically. Configure one in Settings, or rely on the repo\'s own CI.' }
  }
  try {
    const res = await fetch(hookUrl, { method: 'POST', signal: AbortSignal.timeout(10000) })
    return res.ok
      ? { fired: true, detail: 'Deploy hook triggered.' }
      : { fired: false, detail: `Deploy hook responded HTTP ${res.status} — commit is in, but the rebuild trigger may not have registered.` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { fired: false, detail: `Deploy hook request failed: ${message} — commit is in regardless.` }
  }
}

export const githubPublisher: PublisherAdapter = {
  platform: 'github',

  async publish(article: PublishArticleInput, creds: PublisherCredentials): Promise<PublishResult> {
    const invalid = validate(creds, article.slug)
    if (invalid) {
      return {
        platform: 'github', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true, error: invalid,
      }
    }

    const branch = creds.branch || 'main'
    const contentPathTemplate = creds.contentPathTemplate || 'content/blog/{slug}.html'
    const urlPathTemplate = creds.urlPathTemplate || '/{slug}'
    const path = fillTemplate(contentPathTemplate, article.slug)
    const urlPath = fillTemplate(urlPathTemplate, article.slug)
    const liveUrl = `${creds.siteUrl.replace(/\/$/, '')}/${urlPath}`

    // Refuse to silently overwrite an existing file at this path — a slug
    // collision is a real publish-planning bug, not something to paper over.
    const existsRes = await fetch(
      `${GH}/repos/${creds.owner}/${creds.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
      { headers: ghHeaders(creds.accessToken!), signal: AbortSignal.timeout(15000) },
    ).catch(() => null)
    if (existsRes && existsRes.ok) {
      return {
        platform: 'github', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: `${path} already exists on branch "${branch}" — refusing to overwrite. Choose a different slug or delete the existing file first.`,
      }
    }

    const commitRes = await fetch(`${GH}/repos/${creds.owner}/${creds.repo}/contents/${path}`, {
      method: 'PUT',
      headers: ghHeaders(creds.accessToken!),
      // sha intentionally omitted — its absence is what makes this a CREATE
      // rather than an update against the Contents API.
      body: JSON.stringify({
        message: `SEORANKO: publish "${article.title}"`,
        content: Buffer.from(article.bodyHtml, 'utf-8').toString('base64'),
        branch,
      }),
      signal: AbortSignal.timeout(20000),
    }).catch((err) => {
      throw new Error(`GitHub commit request failed: ${err instanceof Error ? err.message : String(err)}`)
    })

    if (!commitRes.ok) {
      const err = await commitRes.json().catch(() => ({}))
      return {
        platform: 'github', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: err.message || `GitHub commit failed (HTTP ${commitRes.status}).`,
      }
    }

    const { fired, detail: hookDetail } = await triggerDeployHook(creds)

    return {
      platform: 'github',
      platformPostId: path,
      liveUrl,
      status: 'BUILD_PENDING',
      isLiveImmediately: false,
      requiresSeparateVerification: true,
      detail: `Committed ${path} to ${creds.owner}/${creds.repo}@${branch}. ${fired ? 'Rebuild triggered.' : hookDetail}`,
    }
  },

  async checkLiveness(): Promise<LivenessCheckResult> {
    // GitHub/Vercel gives no direct "is the build done" signal without a
    // separate Vercel API token this adapter doesn't have — honestly
    // defer to Phase B's HTTP verification loop against the live URL
    // rather than guessing.
    return {
      state: 'BUILD_PENDING',
      detail: 'GitHub publisher has no direct build-status signal — rely on the HTTP verification loop against the live URL.',
    }
  },
}
