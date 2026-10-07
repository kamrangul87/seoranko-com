/**
 * Registry of deterministic transforms that the one-run Fix Agent can commit.
 * Only findings with a registered (topicId, verdict) pair are selected.
 *
 * Each entry: apply function, target-file resolver, preview + production
 * verifiers (re-fetch deployed response and assert the specific change).
 * No verifier → no registration.
 */

import type { PersistedFindingRow } from '../crawl/constants'
import { applyTopic49AutoSetDimensions } from '../fix-flow/apply-topic-49'
import { canOfferFix } from '../buckets'
import type { FindingSurfaceClass } from '../types'
import { removeAnchorByHref } from '@/lib/fix-strategies/topic-1/fix-remove-anchor'
import { verifyAnchorAbsent } from '@/lib/fix-strategies/topic-1/verify-anchor-absent'
import { addHeadCanonical } from '@/lib/fix-strategies/topic-13/fix-add-canonical'
import { verifyLiveCanonicalPresent } from '@/lib/fix-strategies/topic-13/verify-live-canonical'
import { setHeadCanonicalHref } from '@/lib/fix-strategies/topic-14/fix-repoint-canonical'
import { verifyLiveCanonicalTarget200 } from '@/lib/fix-strategies/topic-14/verify-live-target'
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
import { verifyLiveImgDimensions } from '@/lib/fix-strategies/topic-49/verify-live-dimensions'
import {
  evidenceCollapseTo,
  evidenceHref,
  evidencePreferredCanonical,
  evidenceRewrite,
  evidenceSelfCanonical,
  evidenceSitemapLoc,
  isStaticHtmlPath,
  pathFromPageUrl,
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

function sitemapXmlPath(finding: PersistedFindingRow): string | null {
  const fromEv = finding.evidenceValues?.artefactPath
  if (typeof fromEv === 'string' && /sitemap.*\.xml$/i.test(fromEv)) {
    return fromEv.startsWith('public/') ? fromEv : `public/${fromEv.replace(/^\//, '')}`
  }
  // Hand-maintained static artefact only — never guess app/sitemap.ts.
  return 'public/sitemap.xml'
}

function htmlPath(finding: PersistedFindingRow): string | null {
  const p = pathFromPageUrl(finding.pageUrl)
  return isStaticHtmlPath(p) ? p : null
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
  if (ctx.fileContent.includes('data-seoranko-fix')) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  const marker = `<!-- data-seoranko-fix="${ctx.finding.id}" -->`
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

const topic13AddCanonical: TransformHandler = async (ctx) => {
  const href = evidencePreferredCanonical(ctx.finding)
  if (!href) return { ok: false, error: 'Missing preferredForm for topic 13' }
  const { html, added } = addHeadCanonical(ctx.fileContent, href)
  if (!added) {
    return {
      ok: true,
      path: ctx.path,
      newContent: ctx.fileContent,
      updated: 0,
      noop: true,
    }
  }
  return { ok: true, path: ctx.path, newContent: html, updated: 1 }
}

const topic14RepointCanonical: TransformHandler = async (ctx) => {
  const href = evidenceSelfCanonical(ctx.finding)
  if (!href) return { ok: false, error: 'Missing self-canonical for topic 14' }
  const { html, updated } = setHeadCanonicalHref(ctx.fileContent, href)
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
  const v = await verifyLiveImgDimensions(ctx.body, ctx.liveUrl, fetchImpl)
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

const verifyTopic13: TransformVerifier = async (ctx) => {
  const headers = ctx.responseHeaders ?? new Headers({ 'content-type': 'text/html' })
  const pageUrl = ctx.finding.pageUrl || ctx.liveUrl
  const fetchImpl = ctx.fetchImpl ?? fetch
  return verifyLiveCanonicalPresent(
    ctx.body,
    headers,
    pageUrl,
    headers.get('content-type'),
    { fetch: fetchImpl },
  )
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

// ── Registry ──────────────────────────────────────────────────────

const REGISTRY: RegistryEntry[] = [
  {
    topicId: '49',
    verdict: 'auto-set-dimensions',
    handler: topic49Handler,
    resolvePath: (f) => htmlPath(f) ?? pathFromPageUrl(f.pageUrl),
    previewVerifier: verifyTopic49,
    productionVerifier: verifyTopic49,
  },
  {
    topicId: 'fixture',
    verdict: 'auto-fixture-patch',
    handler: fixturePatchHandler,
    resolvePath: (f) => pathFromPageUrl(f.pageUrl),
    previewVerifier: verifyFixture,
    productionVerifier: verifyFixture,
  },
  {
    topicId: '1',
    verdict: 'auto-fixable',
    handler: topic1RemoveAnchor,
    resolvePath: htmlPath,
    previewVerifier: verifyTopic1,
    productionVerifier: verifyTopic1,
  },
  {
    topicId: '13',
    verdict: 'auto-add-self-canonical',
    handler: topic13AddCanonical,
    resolvePath: htmlPath,
    previewVerifier: verifyTopic13,
    productionVerifier: verifyTopic13,
  },
  {
    topicId: '14',
    verdict: 'auto-self-canonical',
    handler: topic14RepointCanonical,
    resolvePath: htmlPath,
    previewVerifier: verifyTopic14,
    productionVerifier: verifyTopic14,
  },
  {
    topicId: '17',
    verdict: 'auto-collapse-redundant',
    handler: topic17Collapse,
    resolvePath: htmlPath,
    previewVerifier: verifyTopic17,
    productionVerifier: verifyTopic17,
  },
  {
    topicId: '17',
    verdict: 'auto-remove-body-misplaced',
    handler: topic17RemoveBody,
    resolvePath: htmlPath,
    previewVerifier: verifyTopic17,
    productionVerifier: verifyTopic17,
  },
  {
    topicId: '22',
    verdict: 'auto-remove-crawl-delay',
    handler: topic22RemoveCrawlDelay,
    resolvePath: () => 'public/robots.txt',
    resolveVerifyUrl: (_f, base) => originRobotsUrl(base),
    previewVerifier: verifyTopic22CrawlDelay,
    productionVerifier: verifyTopic22CrawlDelay,
  },
  {
    topicId: '26',
    verdict: 'auto-remove-confirmed-4xx',
    handler: topic26RemoveLoc,
    resolvePath: sitemapXmlPath,
    resolveVerifyUrl: (_f, base) => originSitemapUrl(base),
    previewVerifier: verifyTopic26Remove,
    productionVerifier: verifyTopic26Remove,
  },
  {
    topicId: '26',
    verdict: 'auto-remove-repo-noindex',
    handler: topic26RemoveLoc,
    resolvePath: sitemapXmlPath,
    resolveVerifyUrl: (_f, base) => originSitemapUrl(base),
    previewVerifier: verifyTopic26Remove,
    productionVerifier: verifyTopic26Remove,
  },
  {
    topicId: '26',
    verdict: 'auto-remove-injected-noindex',
    handler: topic26RemoveLoc,
    resolvePath: sitemapXmlPath,
    resolveVerifyUrl: (_f, base) => originSitemapUrl(base),
    previewVerifier: verifyTopic26Remove,
    productionVerifier: verifyTopic26Remove,
  },
  {
    topicId: '26',
    verdict: 'auto-replace-single-hop-redirect',
    handler: topic26ReplaceLoc,
    resolvePath: sitemapXmlPath,
    resolveVerifyUrl: (_f, base) => originSitemapUrl(base),
    previewVerifier: verifyTopic26Replace,
    productionVerifier: verifyTopic26Replace,
  },
  {
    topicId: '42',
    verdict: 'auto-rewrite',
    handler: topic42RewriteHref,
    resolvePath: htmlPath,
    previewVerifier: verifyTopic42,
    productionVerifier: verifyTopic42,
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
    'topicId' | 'verdict' | 'surfaceClass' | 'autoFixable' | 'reportOnly' | 'postFixStatus'
  >,
): boolean {
  if (finding.reportOnly) return false
  if (!finding.autoFixable) return false
  if (!canOfferFix(finding.surfaceClass as FindingSurfaceClass)) return false
  if (finding.postFixStatus === 'verified') return false
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
