/**
 * Registry of deterministic transforms that the one-run Fix Agent can commit.
 * Only findings with a registered (topicId, verdict) pair are selected.
 *
 * Each entry: apply function, target-file resolver (stored source_path from
 * resolveSourceFile), preview + production verifiers. No verifier → no
 * registration. No finding is auto-fixable without stored path + blob SHA.
 *
 * Topic 13 remains excluded: preferredForm is not present in the file to
 * locate (gate 2). Topic 22 text-plain and topic 28 stay excluded.
 */

import type { PersistedFindingRow } from '../crawl/constants'
import { applyTopic49AutoSetDimensions } from '../fix-flow/apply-topic-49'
import { canOfferFix } from '../buckets'
import type { FindingSurfaceClass } from '../types'
import { removeAnchorByHref } from '@/lib/fix-strategies/topic-1/fix-remove-anchor'
import { verifyAnchorAbsent } from '@/lib/fix-strategies/topic-1/verify-anchor-absent'
import { ensurePageSelfCanonical } from '@/lib/fix-strategies/topic-14/fix-repoint-canonical'
import { verifyLiveCanonicalTarget200 } from '@/lib/fix-strategies/topic-14/verify-live-target'
import {
  stripSpaShellCanonicalAndOgUrl,
  verifySpaShellStripLive,
} from '@/lib/fix-strategies/topic-14/spa-shell-canonical'
import { SPA_SHELL_PATHS } from './create-source'
import {
  addNavOrFooterLink,
  pickAnchorText,
} from '@/lib/fix-strategies/topic-43/fix-add-nav-link'
import {
  addRelatedArticlesBlock,
  type RelatedTarget,
} from '@/lib/fix-strategies/related-articles/fix-add-related'
import {
  collapseToSingleHeadCanonical,
  removeBodyCanonicalLinks,
} from '@/lib/fix-strategies/topic-17/fix-collapse-canonicals'
import { verifyLiveSingleHeadCanonical } from '@/lib/fix-strategies/topic-17/verify-live-single'
import { removeCrawlDelayLines } from '@/lib/fix-strategies/topic-22/fix-robots-txt'
import { verifyLiveRobotsTxt } from '@/lib/fix-strategies/topic-22/verify-live'
import {
  removeSitemapLoc,
  replaceSitemapLoc,
  extractSitemapLocs,
} from '@/lib/fix-strategies/topic-26/parse-sitemap'
import { rewriteAnchorHref } from '@/lib/fix-strategies/topic-42/fix-rewrite-href'
import { verifyLiveHrefRewritten } from '@/lib/fix-strategies/topic-42/verify-live-href'
import { unwrapOriginPrefixedHref } from '@/lib/fix-strategies/topic-74/fix-unwrap-href'
import { verifyLiveImgDimensions } from '@/lib/fix-strategies/topic-49/verify-live-dimensions'
import {
  evidenceCollapseTo,
  evidenceHref,
  evidenceRewrite,
  evidenceSelfCanonical,
  evidenceSitemapLoc,
} from './apply-evidence'

export type ApplyTransformResult =
  | { ok: true; path: string; newContent: string; updated: number; noop?: boolean }
  | { ok: false; error: string; path?: string }

export type ApplyTransformContext = {
  /** Current file content on the review branch (or base). */
  fileContent: string
  /** Repo-relative path already resolved. */
  path: string
  finding: PersistedFindingRow
  fetchImpl?: typeof fetch
}

export type TransformHandler = (
  ctx: ApplyTransformContext,
) => Promise<ApplyTransformResult>

export type VerifyContext = {
  finding: PersistedFindingRow
  /** Re-fetched response body (HTML, robots.txt, or sitemap XML). */
  body: string
  /** Absolute URL that was fetched. */
  liveUrl: string
  responseHeaders?: Headers
  fetchImpl?: typeof fetch
  /** Deploy SHA that produced `liveUrl` (item commit / merge SHA). */
  deploymentSha?: string | null
}

export type VerifyResult = { ok: boolean; detail: string }

export type TransformVerifier = (ctx: VerifyContext) => Promise<VerifyResult>

export type RegistryEntry = {
  topicId: string
  verdict: string
  handler: TransformHandler
  resolvePath: (finding: PersistedFindingRow) => string | null
  /**
   * Resolve the URL to re-fetch for preview/production verify.
   * Defaults to finding.pageUrl when omitted.
   */
  resolveVerifyUrl?: (
    finding: PersistedFindingRow,
    baseOriginOrPreview: string,
  ) => string | null
  previewVerifier: TransformVerifier
  productionVerifier: TransformVerifier
}

// ── Path helpers ──────────────────────────────────────────────────

/** Gate 2: only a stored resolveSourceFile result may supply the apply path. */
function storedSourcePath(finding: PersistedFindingRow): string | null {
  if (finding.sourcePath && finding.sourceBlobSha) return finding.sourcePath
  return null
}

function joinOrigin(base: string, absoluteOrPath: string): string {
  try {
    if (/^https?:\/\//i.test(absoluteOrPath)) {
      const u = new URL(absoluteOrPath)
      const b = new URL(base)
      return `${b.origin}${u.pathname}${u.search}`
    }
    return new URL(absoluteOrPath, base.endsWith('/') ? base : `${base}/`).toString()
  } catch {
    return base
  }
}

function originRobotsUrl(base: string): string {
  try {
    return `${new URL(base).origin}/robots.txt`
  } catch {
    return `${base.replace(/\/$/, '')}/robots.txt`
  }
}

function originSitemapUrl(base: string): string {
  try {
    return `${new URL(base).origin}/sitemap.xml`
  } catch {
    return `${base.replace(/\/$/, '')}/sitemap.xml`
  }
}

// ── Handlers ──────────────────────────────────────────────────────

const topic49Handler: TransformHandler = async (ctx) => {
  const pageUrl = ctx.finding.pageUrl || 'https://example.com/'
  const applied = await applyTopic49AutoSetDimensions(
    ctx.fileContent,
    pageUrl,
    ctx.fetchImpl,
  )
  if (!applied.updated) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return {
    ok: true,
    path: ctx.path,
    newContent: applied.html,
    updated: applied.updated,
  }
}

const fixturePatchHandler: TransformHandler = async (ctx) => {
  const marker = `<!-- data-seoranko-fix="${ctx.finding.id}" -->`
  if (ctx.fileContent.includes(marker)) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  const newContent = ctx.fileContent.includes('</body>')
    ? ctx.fileContent.replace('</body>', `${marker}\n</body>`)
    : `${ctx.fileContent}\n${marker}\n`
  return { ok: true, path: ctx.path, newContent, updated: 1 }
}

const topic1RemoveAnchor: TransformHandler = async (ctx) => {
  const href = evidenceHref(ctx.finding)
  if (!href) return { ok: false, error: 'Missing href evidence for topic 1' }
  const { html, removed } = removeAnchorByHref(ctx.fileContent, href)
  if (!removed) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: html, updated: removed }
}

const topic14RepointCanonical: TransformHandler = async (ctx) => {
  const href = evidenceSelfCanonical(ctx.finding)
  if (!href) return { ok: false, error: 'Missing self-canonical for topic 14' }
  // Never apply to layout.* — page override only (shared layout defaults).
  if (/\/layout\.(tsx|ts|jsx|js)$/i.test(ctx.path)) {
    return {
      ok: false,
      error:
        'Refusing to edit layout for topic 14 — resolve the page file and add a page-level self-canonical',
    }
  }
  // SPA shell must use auto-strip-spa-shell-canonical — never rewrite shell
  // canonical to a single page (would break every other route).
  if (
    (SPA_SHELL_PATHS as readonly string[]).includes(ctx.path) ||
    /(^|\/)index\.html$/i.test(ctx.path)
  ) {
    return {
      ok: false,
      error:
        'Refusing to edit SPA shell via auto-self-canonical — use auto-strip-spa-shell-canonical',
    }
  }
  const { content, updated } = ensurePageSelfCanonical(
    ctx.fileContent,
    ctx.path,
    href,
  )
  if (!updated) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: content, updated }
}

const topic14StripSpaShell: TransformHandler = async (ctx) => {
  if (
    !(SPA_SHELL_PATHS as readonly string[]).includes(ctx.path) &&
    !/(^|\/)index\.html$/i.test(ctx.path)
  ) {
    return {
      ok: false,
      error: `SPA shell strip only applies to index.html shell, not ${ctx.path}`,
    }
  }
  const { html, updated } = stripSpaShellCanonicalAndOgUrl(ctx.fileContent)
  if (!updated) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: html, updated }
}

const topic17Collapse: TransformHandler = async (ctx) => {
  const href = evidenceCollapseTo(ctx.finding)
  if (!href) return { ok: false, error: 'Missing collapseTo for topic 17' }
  const { html, removed } = collapseToSingleHeadCanonical(ctx.fileContent, href)
  if (!removed) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: html, updated: removed }
}

const topic17RemoveBody: TransformHandler = async (ctx) => {
  const { html, removed } = removeBodyCanonicalLinks(ctx.fileContent)
  if (!removed) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: html, updated: removed }
}

const topic22RemoveCrawlDelay: TransformHandler = async (ctx) => {
  const { body, removed } = removeCrawlDelayLines(ctx.fileContent)
  if (!removed) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: body, updated: removed }
}

const topic26RemoveLoc: TransformHandler = async (ctx) => {
  const spec = evidenceSitemapLoc(ctx.finding)
  if (!spec) return { ok: false, error: 'Missing loc for topic 26 remove' }
  const { xml, removed } = removeSitemapLoc(ctx.fileContent, spec.loc)
  if (!removed) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: xml, updated: removed }
}

const topic26ReplaceLoc: TransformHandler = async (ctx) => {
  const spec = evidenceSitemapLoc(ctx.finding)
  if (!spec?.replaceWith) {
    return { ok: false, error: 'Missing loc/replaceWith for topic 26 replace' }
  }
  const { xml, replaced } = replaceSitemapLoc(
    ctx.fileContent,
    spec.loc,
    spec.replaceWith,
  )
  if (!replaced) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: xml, updated: replaced }
}

const topic42RewriteHref: TransformHandler = async (ctx) => {
  const rw = evidenceRewrite(ctx.finding)
  if (!rw) return { ok: false, error: 'Missing href/rewriteHref for topic 42' }
  const { html, rewritten } = rewriteAnchorHref(
    ctx.fileContent,
    rw.fromHref,
    rw.toHref,
  )
  if (!rewritten) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: html, updated: rewritten }
}

const topic43AddNavLink: TransformHandler = async (ctx) => {
  const pageUrl = ctx.finding.pageUrl || ''
  let href = '/'
  try {
    href = new URL(pageUrl).pathname || '/'
  } catch {
    /* keep */
  }
  const ev = (ctx.finding.evidenceValues || {}) as Record<string, unknown>
  const anchor = pickAnchorText({
    pageTitle: typeof ev.anchorText === 'string' ? ev.anchorText : null,
    pageUrl,
  })
  const { html, updated } = addNavOrFooterLink(ctx.fileContent, {
    href,
    anchorText: anchor,
  })
  if (!updated) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: html, updated }
}

const verifyTopic43NavLink: TransformVerifier = async (ctx) => {
  const pageUrl = ctx.finding.pageUrl || ''
  let href = '/'
  try {
    href = new URL(pageUrl).pathname || '/'
  } catch {
    /* keep */
  }
  if (!ctx.body.includes(`href="${href}"`) && !ctx.body.includes(`href='${href}'`)) {
    return { ok: false, detail: `live HTML missing nav link to ${href}` }
  }
  return { ok: true, detail: `nav/footer link to ${href} present` }
}

const topicRelatedArticles: TransformHandler = async (ctx) => {
  const ev = (ctx.finding.evidenceValues || {}) as Record<string, unknown>
  const raw = ev.relatedTargets
  const targets: RelatedTarget[] = Array.isArray(raw)
    ? (raw as RelatedTarget[]).filter(
        (t) => t && typeof t.href === 'string' && typeof t.anchorText === 'string',
      )
    : []
  const { html, updated } = addRelatedArticlesBlock(ctx.fileContent, targets)
  if (!updated) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: html, updated }
}

const verifyRelatedArticles: TransformVerifier = async (ctx) => {
  if (!ctx.body.includes('data-seoranko-related-articles')) {
    return { ok: false, detail: 'Related articles block missing on live page' }
  }
  return { ok: true, detail: 'Related articles block present' }
}

const topic74UnwrapHref: TransformHandler = async (ctx) => {
  const rw = evidenceRewrite(ctx.finding)
  if (!rw) {
    return { ok: false, error: 'Missing href/rewriteHref for topic 74' }
  }
  const { html, rewritten } = unwrapOriginPrefixedHref(
    ctx.fileContent,
    rw.fromHref,
    rw.toHref,
  )
  if (!rewritten) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: html, updated: rewritten }
}

// ── Verifiers (re-fetch body already provided by tick) ────────────

const verifyFixture: TransformVerifier = async (ctx) => {
  const needle = `data-seoranko-fix="${ctx.finding.id}"`
  if (ctx.body.includes(needle) || ctx.body.includes('data-seoranko-fix')) {
    return { ok: true, detail: 'Fixture marker present in fetched body' }
  }
  return { ok: false, detail: 'Fixture marker missing in fetched body' }
}

const verifyTopic49: TransformVerifier = async (ctx) => {
  const fetchImpl = ctx.fetchImpl ?? fetch
  const v = await verifyLiveImgDimensions(ctx.body, ctx.liveUrl, fetchImpl, {
    deploymentSha: ctx.deploymentSha ?? null,
  })
  return {
    ok: v.ok,
    detail: v.ok
      ? `Topic 49 live verify OK: ${v.detail}`
      : `Topic 49 live verify FAILED: ${v.detail}`,
  }
}

const verifyTopic1: TransformVerifier = async (ctx) => {
  const href = evidenceHref(ctx.finding)
  if (!href) return { ok: false, detail: 'Missing href evidence' }
  return verifyAnchorAbsent(ctx.body, href)
}

const verifyTopic14: TransformVerifier = async (ctx) => {
  const headers = ctx.responseHeaders ?? new Headers({ 'content-type': 'text/html' })
  const pageUrl = ctx.finding.pageUrl || ctx.liveUrl
  const fetchImpl = ctx.fetchImpl ?? fetch
  const expected = evidenceSelfCanonical(ctx.finding)
  if (expected && !ctx.body.includes(expected)) {
    // Soft check: href attr present
    const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`rel=["']canonical["'][^>]*href=["']${escaped}["']|href=["']${escaped}["'][^>]*rel=["']canonical["']`, 'i').test(ctx.body)) {
      return { ok: false, detail: `live HTML missing self-canonical ${expected}` }
    }
  }
  return verifyLiveCanonicalTarget200(
    ctx.body,
    headers,
    pageUrl,
    headers.get('content-type'),
    { fetch: fetchImpl },
  )
}

const verifyTopic14SpaShellStrip: TransformVerifier = async (ctx) => {
  let homepage = 'https://example.com'
  try {
    homepage = new URL(ctx.finding.pageUrl || ctx.liveUrl).origin
  } catch {
    /* keep */
  }
  const ev = (ctx.finding.evidenceValues || {}) as Record<string, unknown>
  if (typeof ev.canonicalUrl === 'string' && ev.canonicalUrl) {
    try {
      homepage = new URL(ev.canonicalUrl).origin
    } catch {
      /* keep */
    }
  }
  const strip = verifySpaShellStripLive({
    rawHtml: ctx.body,
    homepageCanonical: homepage,
  })
  if (!strip.ok) return strip
  // SPA must still be the shell (not a static stub). Policy copy is client-rendered;
  // assert the shell root remains so we did not shadow /privacy with a stub.
  if (!/id=["']root["']/i.test(ctx.body) && !/<div\s+id=["']app["']/i.test(ctx.body)) {
    return {
      ok: false,
      detail: 'raw HTML missing SPA root — possible static stub shadowing the route',
    }
  }
  return { ok: true, detail: strip.detail }
}

const verifyTopic17: TransformVerifier = async (ctx) => {
  const headers = ctx.responseHeaders ?? new Headers({ 'content-type': 'text/html' })
  const pageUrl = ctx.finding.pageUrl || ctx.liveUrl
  return verifyLiveSingleHeadCanonical(
    ctx.body,
    headers,
    pageUrl,
    headers.get('content-type'),
  )
}

const verifyTopic22CrawlDelay: TransformVerifier = async (ctx) => {
  const fetchImpl = ctx.fetchImpl ?? fetch
  // Prefer a live re-fetch of /robots.txt when possible; fall back to body.
  const v = await verifyLiveRobotsTxt(ctx.liveUrl, fetchImpl)
  if (!v.ok) return v
  if (/^\s*crawl-delay\s*:/im.test(ctx.body)) {
    return { ok: false, detail: 'crawl-delay still present in fetched body' }
  }
  return { ok: true, detail: 'crawl-delay absent from live robots.txt' }
}

const verifyTopic26Remove: TransformVerifier = async (ctx) => {
  const spec = evidenceSitemapLoc(ctx.finding)
  if (!spec) return { ok: false, detail: 'Missing loc evidence' }
  const locs = extractSitemapLocs(ctx.body)
  if (locs.some((l) => l === spec.loc)) {
    return { ok: false, detail: `loc still present in live sitemap: ${spec.loc}` }
  }
  return { ok: true, detail: `loc absent from live sitemap: ${spec.loc}` }
}

const verifyTopic26Replace: TransformVerifier = async (ctx) => {
  const spec = evidenceSitemapLoc(ctx.finding)
  if (!spec?.replaceWith) return { ok: false, detail: 'Missing replaceWith' }
  const locs = extractSitemapLocs(ctx.body)
  if (locs.some((l) => l === spec.loc)) {
    return { ok: false, detail: `old loc still present: ${spec.loc}` }
  }
  if (!locs.some((l) => l === spec.replaceWith)) {
    return { ok: false, detail: `replacement loc missing: ${spec.replaceWith}` }
  }
  return {
    ok: true,
    detail: `live sitemap has ${spec.replaceWith} and not ${spec.loc}`,
  }
}

const verifyTopic42: TransformVerifier = async (ctx) => {
  const rw = evidenceRewrite(ctx.finding)
  if (!rw) return { ok: false, detail: 'Missing rewrite evidence' }
  const pageUrl = ctx.finding.pageUrl || ctx.liveUrl
  return verifyLiveHrefRewritten(
    ctx.body,
    pageUrl,
    rw.toHref,
    rw.fromHref,
    { fetch: ctx.fetchImpl ?? fetch },
  )
}

/** Topic 74 — only assert HTML rewrite; do not fetch the external destination. */
const verifyTopic74: TransformVerifier = async (ctx) => {
  const rw = evidenceRewrite(ctx.finding)
  if (!rw) return { ok: false, detail: 'Missing unwrap evidence' }
  const hasNew = ctx.body.includes(rw.toHref)
  const stillOld =
    ctx.body.includes(`"${rw.fromHref}"`) ||
    ctx.body.includes(`'${rw.fromHref}'`) ||
    ctx.body.includes(`\u201C${rw.fromHref}\u201D`)
  if (!hasNew) {
    return { ok: false, detail: `live HTML missing unwrapped href ${rw.toHref}` }
  }
  if (stillOld) {
    return {
      ok: false,
      detail: `live HTML still contains origin-prefixed href ${rw.fromHref}`,
    }
  }
  return { ok: true, detail: `unwrapped href present: ${rw.toHref}` }
}

// ── Registry ──────────────────────────────────────────────────────

const REGISTRY: RegistryEntry[] = [
  {
    topicId: '49',
    verdict: 'auto-set-dimensions',
    handler: topic49Handler,
    resolvePath: storedSourcePath,
    previewVerifier: verifyTopic49,
    productionVerifier: verifyTopic49,
  },
  {
    topicId: 'fixture',
    verdict: 'auto-fixture-patch',
    handler: fixturePatchHandler,
    resolvePath: storedSourcePath,
    previewVerifier: verifyFixture,
    productionVerifier: verifyFixture,
  },
  {
    topicId: '1',
    verdict: 'auto-fixable',
    handler: topic1RemoveAnchor,
    resolvePath: storedSourcePath,
    previewVerifier: verifyTopic1,
    productionVerifier: verifyTopic1,
  },
  {
    topicId: '14',
    verdict: 'auto-self-canonical',
    handler: topic14RepointCanonical,
    resolvePath: storedSourcePath,
    previewVerifier: verifyTopic14,
    productionVerifier: verifyTopic14,
  },
  {
    topicId: '14',
    verdict: 'auto-strip-spa-shell-canonical',
    handler: topic14StripSpaShell,
    resolvePath: storedSourcePath,
    previewVerifier: verifyTopic14SpaShellStrip,
    productionVerifier: verifyTopic14SpaShellStrip,
  },
  {
    topicId: '17',
    verdict: 'auto-collapse-redundant',
    handler: topic17Collapse,
    resolvePath: storedSourcePath,
    previewVerifier: verifyTopic17,
    productionVerifier: verifyTopic17,
  },
  {
    topicId: '17',
    verdict: 'auto-remove-body-misplaced',
    handler: topic17RemoveBody,
    resolvePath: storedSourcePath,
    previewVerifier: verifyTopic17,
    productionVerifier: verifyTopic17,
  },
  {
    topicId: '22',
    verdict: 'auto-remove-crawl-delay',
    handler: topic22RemoveCrawlDelay,
    resolvePath: storedSourcePath,
    resolveVerifyUrl: (_f, base) => originRobotsUrl(base),
    previewVerifier: verifyTopic22CrawlDelay,
    productionVerifier: verifyTopic22CrawlDelay,
  },
  {
    topicId: '26',
    verdict: 'auto-remove-confirmed-4xx',
    handler: topic26RemoveLoc,
    resolvePath: storedSourcePath,
    resolveVerifyUrl: (_f, base) => originSitemapUrl(base),
    previewVerifier: verifyTopic26Remove,
    productionVerifier: verifyTopic26Remove,
  },
  {
    topicId: '26',
    verdict: 'auto-remove-repo-noindex',
    handler: topic26RemoveLoc,
    resolvePath: storedSourcePath,
    resolveVerifyUrl: (_f, base) => originSitemapUrl(base),
    previewVerifier: verifyTopic26Remove,
    productionVerifier: verifyTopic26Remove,
  },
  {
    topicId: '26',
    verdict: 'auto-remove-injected-noindex',
    handler: topic26RemoveLoc,
    resolvePath: storedSourcePath,
    resolveVerifyUrl: (_f, base) => originSitemapUrl(base),
    previewVerifier: verifyTopic26Remove,
    productionVerifier: verifyTopic26Remove,
  },
  {
    topicId: '26',
    verdict: 'auto-replace-single-hop-redirect',
    handler: topic26ReplaceLoc,
    resolvePath: storedSourcePath,
    resolveVerifyUrl: (_f, base) => originSitemapUrl(base),
    previewVerifier: verifyTopic26Replace,
    productionVerifier: verifyTopic26Replace,
  },
  {
    topicId: '42',
    verdict: 'auto-rewrite',
    handler: topic42RewriteHref,
    resolvePath: storedSourcePath,
    previewVerifier: verifyTopic42,
    productionVerifier: verifyTopic42,
  },
  {
    topicId: '74',
    verdict: 'auto-unwrap-origin-prefix',
    handler: topic74UnwrapHref,
    resolvePath: storedSourcePath,
    previewVerifier: verifyTopic74,
    productionVerifier: verifyTopic74,
  },
  {
    topicId: '43',
    verdict: 'auto-add-nav-link',
    handler: topic43AddNavLink,
    resolvePath: storedSourcePath,
    previewVerifier: verifyTopic43NavLink,
    productionVerifier: verifyTopic43NavLink,
  },
  {
    topicId: 'related',
    verdict: 'auto-add-related-articles',
    handler: topicRelatedArticles,
    resolvePath: storedSourcePath,
    previewVerifier: verifyRelatedArticles,
    productionVerifier: verifyRelatedArticles,
  },
]

function findEntry(
  topicId: string,
  verdict: string,
): RegistryEntry | undefined {
  return REGISTRY.find((r) => r.topicId === topicId && r.verdict === verdict)
}

/** True when (topicId, verdict) has a registered transform + verifiers. */
export function isTransformRegistered(topicId: string, verdict: string): boolean {
  return !!findEntry(topicId, verdict)
}

export function listRegisteredTransforms(): Array<{
  topicId: string
  verdict: string
}> {
  return REGISTRY.map((r) => ({ topicId: r.topicId, verdict: r.verdict }))
}

export function isCommitableFinding(
  finding: Pick<
    PersistedFindingRow,
    | 'topicId'
    | 'verdict'
    | 'surfaceClass'
    | 'autoFixable'
    | 'reportOnly'
    | 'postFixStatus'
    | 'sourcePath'
    | 'sourceBlobSha'
  >,
  opts?: { paused?: boolean },
): boolean {
  if (finding.reportOnly) return false
  if (!finding.autoFixable) return false
  if (
    !canOfferFix(finding.surfaceClass as FindingSurfaceClass, {
      paused: opts?.paused === true,
    })
  ) {
    return false
  }
  if (finding.postFixStatus === 'verified') return false
  // Acceptance: never auto-fixable without stored resolved path + blob SHA.
  if (!finding.sourcePath || !finding.sourceBlobSha) return false
  return isTransformRegistered(finding.topicId, finding.verdict)
}

export function resolveTransformPath(finding: PersistedFindingRow): string | null {
  const entry = findEntry(finding.topicId, finding.verdict)
  return entry ? entry.resolvePath(finding) : null
}

export function resolveVerifyUrl(
  finding: PersistedFindingRow,
  baseOriginOrPreview: string,
): string | null {
  const entry = findEntry(finding.topicId, finding.verdict)
  if (!entry) return null
  if (entry.resolveVerifyUrl) {
    return entry.resolveVerifyUrl(finding, baseOriginOrPreview)
  }
  if (!finding.pageUrl) return baseOriginOrPreview
  return joinOrigin(baseOriginOrPreview, finding.pageUrl)
}

export async function applyRegisteredTransform(
  ctx: ApplyTransformContext,
): Promise<ApplyTransformResult> {
  const entry = findEntry(ctx.finding.topicId, ctx.finding.verdict)
  if (!entry) {
    return {
      ok: false,
      error: `No registered transform for topic ${ctx.finding.topicId} / ${ctx.finding.verdict}`,
    }
  }
  return entry.handler(ctx)
}

export async function verifyRegisteredTransform(
  ctx: VerifyContext & { stage: 'preview' | 'production' },
): Promise<VerifyResult> {
  const entry = findEntry(ctx.finding.topicId, ctx.finding.verdict)
  if (!entry) {
    return {
      ok: false,
      detail: `No verifier for ${ctx.finding.topicId}/${ctx.finding.verdict}`,
    }
  }
  const verifier =
    ctx.stage === 'preview' ? entry.previewVerifier : entry.productionVerifier
  return verifier(ctx)
}

/**
 * Order findings for apply: group by resolved path so same-file edits
 * run sequentially (each commit reads the prior branch tip).
 * Within a path, stable by topicId then finding id.
 */
export function orderFindingsForApply(
  findings: PersistedFindingRow[],
): PersistedFindingRow[] {
  return [...findings].sort((a, b) => {
    const pa = resolveTransformPath(a) || ''
    const pb = resolveTransformPath(b) || ''
    if (pa !== pb) return pa.localeCompare(pb)
    if (a.topicId !== b.topicId) return a.topicId.localeCompare(b.topicId)
    return a.id.localeCompare(b.id)
  })
}
