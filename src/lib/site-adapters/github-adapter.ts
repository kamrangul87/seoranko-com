/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/site-adapters/github-adapter.ts
// Credentials: { siteUrl, owner, repo, branch, accessToken }
//   accessToken — fine-grained GitHub PAT scoped to this one repo with
//                 Contents: Read & Write (and Pull requests: Read & Write for
//                 the review-required path).
//
// SAFETY: this adapter commits to a real repository that a real site builds
// from. Two rules keep it from breaking a live site:
//   1. Only file types where raw HTML is valid are editable. Appending markup
//      to a .tsx/.jsx component produces a syntax error and fails the build.
//   2. A file is only matched when the URL path maps to it convincingly —
//      a loose fuzzy match could commit into an unrelated file.

import {
  CMSAdapter, SiteCredentials, PageContent, FixApplyResult,
  alreadyHasSchemaType, schemaScriptTag
} from './types'
import { mergeNextConfigRedirect } from '../fix-agent-redirect'

const GH = 'https://api.github.com'

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  }
}

// owner/repo/branch are interpolated into API URLs — validate their shape.
const OWNER_RE  = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/
const REPO_RE   = /^[a-zA-Z0-9._-]{1,100}$/
const BRANCH_RE = /^[a-zA-Z0-9._\/-]{1,255}$/

function validCreds(creds: SiteCredentials): string | null {
  if (!creds.owner || !OWNER_RE.test(creds.owner)) return 'Invalid GitHub owner/organisation name.'
  if (!creds.repo || !REPO_RE.test(creds.repo)) return 'Invalid repository name.'
  const branch = creds.branch || 'main'
  if (!BRANCH_RE.test(branch)) return 'Invalid branch name.'
  if (!creds.accessToken) return 'A GitHub access token is required.'
  return null
}

/**
 * File types where inserting raw HTML is valid.
 *  html/htm — always fine
 *  md/mdx   — HTML passes through in virtually every static-site pipeline
 * Component sources (tsx/jsx/vue/svelte/astro) are deliberately excluded:
 * concatenating HTML into them is a build-breaking syntax error.
 */
const HTML_SAFE = /\.(html?|md|mdx)$/i
const COMPONENT_SOURCE = /\.(tsx|jsx|ts|js|vue|svelte|astro)$/i

interface GHFile { path: string; sha: string }

async function getRepoTree(creds: SiteCredentials): Promise<GHFile[]> {
  const branch = creds.branch || 'main'
  const res = await fetch(
    `${GH}/repos/${creds.owner}/${creds.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: ghHeaders(creds.accessToken!), signal: AbortSignal.timeout(20000) }
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data.tree || [])
    .filter((f: any) => f.type === 'blob')
    .map((f: any) => ({ path: f.path, sha: f.sha }))
}

/** URL path segments, e.g. https://x.com/blog/mot-2026/ -> ['blog','mot-2026'] */
function urlSegments(url: string): string[] {
  return url
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/[?#].*$/, '')
    .split('/')
    .filter(Boolean)
    .map(s => s.replace(/\.html?$/i, ''))
}

/**
 * Map a live URL to its source file. Scored rather than fuzzy-substring:
 * a wrong match here means committing into an unrelated file.
 *
 * Supports:
 * - /blog/slug → …/blog/slug.html or …/blog/slug.md
 * - /contact → …/contact/index.html (directory index)
 * - / → shallowest index.html / index.md
 */
export function findBestGithubSourceMatch(
  files: Array<{ path: string }>,
  url: string,
): { path: string } | null {
  const segs = urlSegments(url)
  const editable = files.filter((f) => HTML_SAFE.test(f.path))
  if (editable.length === 0) return null

  // Prefer public/ assets when both public/foo.html and content/foo.html exist
  // (Vite/static sites serve from public/).
  const preferPublic = (a: string, b: string) => {
    const ap = a.startsWith('public/') ? 1 : 0
    const bp = b.startsWith('public/') ? 1 : 0
    return bp - ap
  }

  if (segs.length === 0) {
    const indexes = editable
      .filter((f) => /(^|\/)index\.(html?|md|mdx)$/i.test(f.path))
      .sort((a, b) => {
        const depth = a.path.split('/').length - b.path.split('/').length
        if (depth !== 0) return depth
        return preferPublic(a.path, b.path)
      })
    // Prefer root index.html / public/index.html over nested marketing indexes.
    const rootish = indexes.find(
      (f) =>
        /^index\.(html?|md|mdx)$/i.test(f.path) ||
        /^public\/index\.(html?|md|mdx)$/i.test(f.path),
    )
    return rootish ?? indexes[0] ?? null
  }

  const slug = segs[segs.length - 1].toLowerCase()
  const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, '')

  const scored = editable
    .map((f) => {
      const parts = f.path.split('/')
      const base = parts[parts.length - 1]!.replace(/\.(html?|md|mdx)$/i, '')
      const parent = parts.length >= 2 ? parts[parts.length - 2]! : ''
      const dir = parts.slice(0, -1)
      let score = 0

      if (base.toLowerCase() === slug) score += 100
      else if (norm(base) === norm(slug)) score += 80
      else if (/^index$/i.test(base) && parent.toLowerCase() === slug) score += 95
      else if (/^index$/i.test(base) && norm(parent) === norm(slug)) score += 75
      else return { f, score: 0 }

      for (const seg of segs.slice(0, -1)) {
        if (dir.some((d) => norm(d) === norm(seg))) score += 10
      }
      if (f.path.startsWith('public/')) score += 5
      score -= f.path.split('/').length
      return { f, score }
    })
    .filter((x) => x.score > 0)

  if (scored.length === 0) return null
  scored.sort((a, b) => b.score - a.score)
  return scored[0].f
}

function findBestMatch(files: GHFile[], url: string): GHFile | null {
  const hit = findBestGithubSourceMatch(files, url)
  if (!hit) return null
  return files.find((f) => f.path === hit.path) || null
}

async function getFileContent(
  creds: SiteCredentials,
  path: string
): Promise<{ content: string; sha: string } | null> {
  const branch = creds.branch || 'main'
  const res = await fetch(
    `${GH}/repos/${creds.owner}/${creds.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: ghHeaders(creds.accessToken!), signal: AbortSignal.timeout(20000) }
  )
  if (!res.ok) return null
  const data = await res.json()
  if (!data.content) return null
  return { content: Buffer.from(data.content, 'base64').toString('utf-8'), sha: data.sha }
}

async function commitFileChange(
  creds: SiteCredentials,
  path: string,
  newContent: string,
  currentSha: string,
  commitMessage: string,
  riskLevel: 'safe' | 'review-required',
  branchSuffix: string
): Promise<{ success: boolean; error?: string; prUrl?: string }> {

  const branch = creds.branch || 'main'
  const targetBranch = riskLevel === 'safe' ? branch : `seoranko-fix-${branchSuffix}`
  const headers = ghHeaders(creds.accessToken!)

  try {
    if (riskLevel !== 'safe') {
      const refRes = await fetch(
        `${GH}/repos/${creds.owner}/${creds.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
        { headers, signal: AbortSignal.timeout(15000) }
      )
      if (!refRes.ok) return { success: false, error: `Could not read branch "${branch}" (${refRes.status}).` }
      const refData = await refRes.json()

      const createRes = await fetch(`${GH}/repos/${creds.owner}/${creds.repo}/git/refs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ref: `refs/heads/${targetBranch}`, sha: refData.object.sha }),
        signal: AbortSignal.timeout(15000)
      })
      // The spec ignored this result; a failed branch create would then commit
      // straight to main, which is exactly what review-required must avoid.
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}))
        return { success: false, error: err.message || `Could not create review branch (${createRes.status}).` }
      }
    }

    const commitRes = await fetch(`${GH}/repos/${creds.owner}/${creds.repo}/contents/${path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(newContent, 'utf-8').toString('base64'),
        sha: currentSha,
        branch: targetBranch
      }),
      signal: AbortSignal.timeout(20000)
    })

    if (!commitRes.ok) {
      const err = await commitRes.json().catch(() => ({}))
      return { success: false, error: err.message || `GitHub commit failed (${commitRes.status})` }
    }

    if (riskLevel !== 'safe') {
      const prRes = await fetch(`${GH}/repos/${creds.owner}/${creds.repo}/pulls`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: commitMessage,
          head: targetBranch,
          base: branch,
          body: 'Opened automatically by RANKO. Review the change and merge to apply it to your live site.'
        }),
        signal: AbortSignal.timeout(15000)
      })
      if (!prRes.ok) {
        const err = await prRes.json().catch(() => ({}))
        return {
          success: false,
          error: `Change committed to branch "${targetBranch}" but the Pull Request could not be opened: ${err.message || prRes.status}. Open it manually on GitHub.`
        }
      }
      const prData = await prRes.json()
      return { success: true, prUrl: prData.html_url }
    }

    return { success: true }
  } catch {
    return { success: false, error: 'GitHub API request failed' }
  }
}

function guardEditable(path: string): string | null {
  if (COMPONENT_SOURCE.test(path)) {
    return `${path} is a component source file — RANKO won't insert raw HTML into it, as that would break your build. Add the fix to the template manually, or point this URL at an HTML/Markdown source.`
  }
  if (!HTML_SAFE.test(path)) {
    return `${path} isn't an HTML or Markdown file, so RANKO can't safely edit it.`
  }
  return null
}

export const githubAdapter: CMSAdapter = {
  platform: 'github',
  serverVerifiable: true,
  // Commits trigger a rebuild (Vercel/Pages/Netlify) that takes minutes, and
  // review-required fixes wait on a human merge.
  deferredVerification: true,

  async verifyConnection(creds) {
    const invalid = validCreds(creds)
    if (invalid) return { success: false, error: invalid }

    try {
      const res = await fetch(`${GH}/repos/${creds.owner}/${creds.repo}`, {
        headers: ghHeaders(creds.accessToken!),
        signal: AbortSignal.timeout(15000)
      })
      if (res.status === 401 || res.status === 403) {
        return { success: false, error: 'GitHub rejected that token — check it has Contents: Read & write on this repository.' }
      }
      if (res.status === 404) {
        return { success: false, error: `Repository ${creds.owner}/${creds.repo} not found, or the token can't see it.` }
      }
      if (!res.ok) return { success: false, error: `Could not access the repository (${res.status}).` }

      const data = await res.json()
      // A read-only token authenticates fine but can't apply anything.
      if (data.permissions && data.permissions.push === false) {
        return { success: false, error: `Connected to ${data.full_name}, but the token is read-only. It needs Contents: Read & write.` }
      }
      return { success: true, detail: `Connected to ${data.full_name} (default branch: ${data.default_branch}).` }
    } catch {
      return { success: false, error: 'Could not reach the GitHub API' }
    }
  },

  async findPageContent(creds, url): Promise<PageContent | null> {
    if (validCreds(creds)) return null

    const files = await getRepoTree(creds)
    const match = findBestMatch(files, url)
    if (!match) return null

    const fileData = await getFileContent(creds, match.path)
    if (!fileData) return null

    return {
      id: match.path,           // the file path IS the id for this adapter
      url,
      title: match.path.split('/').pop()!.replace(/\.(html?|md|mdx)$/i, ''),
      bodyHtml: fileData.content,
      hasSchema: fileData.content.includes('application/ld+json')
    }
  },

  async injectSchema(creds, page, schemaJsonLd): Promise<FixApplyResult> {
    const unsafe = guardEditable(page.id)
    if (unsafe) return { success: false, error: unsafe }

    // Re-read immediately before committing so the sha is current.
    const fileData = await getFileContent(creds, page.id)
    if (!fileData) return { success: false, error: 'Could not re-read the file before committing.' }

    if (alreadyHasSchemaType(fileData.content, schemaJsonLd)) {
      return { success: true, skipped: true }
    }

    const script = schemaScriptTag(schemaJsonLd)
    const newContent = fileData.content.includes('</body>')
      ? fileData.content.replace('</body>', `${script}</body>`)
      : fileData.content + script

    const result = await commitFileChange(
      creds, page.id, newContent, fileData.sha,
      `RANKO: add JSON-LD schema to ${page.id}`,
      'safe',
      String(fileData.sha).slice(0, 8)
    )

    if (!result.success) return { success: false, error: result.error }
    return {
      success: true,
      pending: true,
      detail: `Committed to ${creds.branch || 'main'}. It goes live once your site rebuilds.`
    }
  },

  async appendContent(creds, page, html, position): Promise<FixApplyResult> {
    const unsafe = guardEditable(page.id)
    if (unsafe) return { success: false, error: unsafe }

    const fileData = await getFileContent(creds, page.id)
    if (!fileData) return { success: false, error: 'Could not re-read the file before committing.' }

    if (fileData.content.includes('seoranko-added-byline')) {
      return { success: true, skipped: true }
    }

    const newContent = position === 'start' ? html + fileData.content : fileData.content + html

    // Visible content changes open a PR — Git's own review flow as RANKO's
    // "propose" step, rather than committing straight to the live branch.
    const result = await commitFileChange(
      creds, page.id, newContent, fileData.sha,
      `RANKO: content fix for ${page.id}`,
      'review-required',
      String(fileData.sha).slice(0, 8)
    )

    if (!result.success) return { success: false, error: result.error }
    return {
      success: true,
      pending: true,
      url: result.prUrl,
      detail: result.prUrl
        ? `Pull Request opened: ${result.prUrl} — merge it to apply the fix.`
        : 'Change committed to a review branch.'
    }
  },

  async rewritePageHtml(creds, page, newHtml, opts): Promise<FixApplyResult> {
    const unsafe = guardEditable(page.id)
    if (unsafe) return { success: false, error: unsafe }

    const fileData = await getFileContent(creds, page.id)
    if (!fileData) return { success: false, error: 'Could not re-read the file before committing.' }
    if (fileData.content === newHtml) return { success: true, skipped: true }

    const risk = opts?.riskLevel || 'safe'
    const result = await commitFileChange(
      creds,
      page.id,
      newHtml,
      fileData.sha,
      opts?.commitMessage || `SEORANKO Fix Agent: update ${page.id}`,
      risk,
      String(fileData.sha).slice(0, 8),
    )
    if (!result.success) return { success: false, error: result.error }
    return {
      success: true,
      pending: true,
      url: result.prUrl,
      detail: risk === 'safe'
        ? `Committed to ${creds.branch || 'main'}. Live after rebuild.`
        : (result.prUrl ? `PR opened: ${result.prUrl}` : 'Committed to review branch.'),
    }
  },

  async writeStaticFile(creds, relativePath, content, opts): Promise<FixApplyResult> {
    const invalid = validCreds(creds)
    if (invalid) return { success: false, error: invalid }

    let path = relativePath.replace(/^\/+/, '')
    if (!/^[a-zA-Z0-9._\/-]+$/.test(path) || path.includes('..')) {
      return { success: false, error: 'Invalid static file path.' }
    }

    // Vite / static sites serve from public/ — prefer that when it exists.
    if (!path.startsWith('public/') && /^(llms\.txt|robots\.txt)$/i.test(path)) {
      const tree = await getRepoTree(creds)
      if (tree.some((f) => f.path === `public/${path}` || f.path.startsWith('public/'))) {
        path = `public/${path}`
      }
    }

    const existing = await getFileContent(creds, path)
    const sha = existing?.sha || ''
    const branch = creds.branch || 'main'
    const headers = ghHeaders(creds.accessToken!)
    try {
      const commitRes = await fetch(`${GH}/repos/${creds.owner}/${creds.repo}/contents/${path}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: opts?.commitMessage || `SEORANKO Fix Agent: add ${path}`,
          content: Buffer.from(content, 'utf-8').toString('base64'),
          ...(sha ? { sha } : {}),
          branch,
        }),
        signal: AbortSignal.timeout(20000),
      })
      if (!commitRes.ok) {
        const err = await commitRes.json().catch(() => ({}))
        return { success: false, error: err.message || `GitHub write failed (${commitRes.status})` }
      }
      return {
        success: true,
        pending: true,
        detail: `Wrote ${path} on ${branch}. Live after rebuild.`,
      }
    } catch {
      return { success: false, error: 'GitHub static file write failed' }
    }
  },

  async mergeRedirectConfig(creds, fromUrl, toUrl, opts): Promise<FixApplyResult> {
    const invalid = validCreds(creds)
    if (invalid) return { success: false, error: invalid }

    const tree = await getRepoTree(creds)
    const configFile = tree.find((f) => /^next\.config\.(js|mjs|ts)$/i.test(f.path.split('/').pop() || ''))
    if (!configFile) {
      const created = mergeNextConfigRedirect('', fromUrl, toUrl)
      const path = 'next.config.js'
      const branch = creds.branch || 'main'
      const headers = ghHeaders(creds.accessToken!)
      try {
        const commitRes = await fetch(`${GH}/repos/${creds.owner}/${creds.repo}/contents/${path}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: opts?.commitMessage || `SEORANKO: redirect ${fromUrl} → ${toUrl}`,
            content: Buffer.from(created.content, 'utf-8').toString('base64'),
            branch,
          }),
          signal: AbortSignal.timeout(20000),
        })
        if (!commitRes.ok) {
          const err = await commitRes.json().catch(() => ({}))
          return { success: false, error: err.message || `Could not create ${path}` }
        }
        return { success: true, pending: true, detail: `Created ${path} with redirect. Live after rebuild.` }
      } catch {
        return { success: false, error: 'GitHub redirect config write failed' }
      }
    }

    const fileData = await getFileContent(creds, configFile.path)
    if (!fileData) return { success: false, error: `Could not read ${configFile.path}` }

    const merged = mergeNextConfigRedirect(fileData.content, fromUrl, toUrl)
    if (!merged.changed) {
      return { success: true, skipped: true, detail: merged.summary }
    }

    const result = await commitFileChange(
      creds,
      configFile.path,
      merged.content,
      fileData.sha,
      opts?.commitMessage || `SEORANKO: redirect ${fromUrl} → ${toUrl}`,
      'safe',
      String(fileData.sha).slice(0, 8),
    )
    if (!result.success) return { success: false, error: result.error }
    return { success: true, pending: true, detail: merged.summary + ' Live after rebuild.' }
  },
}
