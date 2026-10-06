/**
 * Registry of deterministic transforms that the one-run Fix Agent can commit.
 * Only findings with a registered (topicId, verdict) pair are selected.
 */

import type { PersistedFindingRow } from '../crawl/constants'
import { applyTopic49AutoSetDimensions } from '../fix-flow/apply-topic-49'
import { canOfferFix } from '../buckets'
import type { FindingSurfaceClass } from '../types'

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

function pathFromPageUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl)
    let path = u.pathname.replace(/^\//, '')
    if (!path || path.endsWith('/')) path = `${path}index.html`.replace(/^\//, '')
    if (!/\.(html?|md|mdx)$/i.test(path)) {
      if (!path.includes('.')) path = `${path}.html`
    }
    if (path.startsWith('blog/') || path.startsWith('images/')) {
      return `public/${path}`
    }
    if (!path.startsWith('public/')) {
      return `public/${path}`
    }
    return path
  } catch {
    return null
  }
}

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

/**
 * Fixture-only transform: inserts a deterministic HTML comment when content
 * lacks `data-seoranko-fix`. Used by unit/fixture tests — never selected
 * for live findings (verdict is fixture-specific).
 */
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

const REGISTRY: Array<{
  topicId: string
  verdict: string
  handler: TransformHandler
  resolvePath: (finding: PersistedFindingRow) => string | null
}> = [
  {
    topicId: '49',
    verdict: 'auto-set-dimensions',
    handler: topic49Handler,
    resolvePath: (f) => (f.pageUrl ? pathFromPageUrl(f.pageUrl) : null),
  },
  {
    topicId: 'fixture',
    verdict: 'auto-fixture-patch',
    handler: fixturePatchHandler,
    resolvePath: (f) => {
      if (f.pageUrl) return pathFromPageUrl(f.pageUrl)
      return null
    },
  },
]

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
  return REGISTRY.some(
    (r) => r.topicId === finding.topicId && r.verdict === finding.verdict,
  )
}

export function resolveTransformPath(finding: PersistedFindingRow): string | null {
  const entry = REGISTRY.find(
    (r) => r.topicId === finding.topicId && r.verdict === finding.verdict,
  )
  return entry ? entry.resolvePath(finding) : null
}

export async function applyRegisteredTransform(
  ctx: ApplyTransformContext,
): Promise<ApplyTransformResult> {
  const entry = REGISTRY.find(
    (r) =>
      r.topicId === ctx.finding.topicId && r.verdict === ctx.finding.verdict,
  )
  if (!entry) {
    return {
      ok: false,
      error: `No registered transform for topic ${ctx.finding.topicId} / ${ctx.finding.verdict}`,
    }
  }
  return entry.handler(ctx)
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
