/**
 * Registry of deterministic transforms that the one-run Fix Agent can commit.
 * Only findings with a registered (topicId, verdict) pair are selected.
 *
 * Each entry: apply function, target-file resolver, preview + production
 * verifiers (re-fetch deployed response and assert the specific change).
 * No verifier → no registration.
 *
 * Phase 2 pre-check (see PR #176): candidates 1, 13, 14, 17, 22, 26, 28, 42
 * all failed at least one gate (exact file target on emit, and/or verifier
 * wiring prerequisites). They are NOT registered — do not invent paths.
 * Topic 49 remains the only product transform that passes all four checks.
 */

import type { PersistedFindingRow } from '../crawl/constants'
import { applyTopic49AutoSetDimensions } from '../fix-flow/apply-topic-49'
import { canOfferFix } from '../buckets'
import type { FindingSurfaceClass } from '../types'
import { verifyLiveImgDimensions } from '@/lib/fix-strategies/topic-49/verify-live-dimensions'
import { pathFromPageUrl } from './apply-evidence'

export type ApplyTransformResult =
  | { ok: true; path: string; newContent: string; updated: number; noop?: boolean }
  | { ok: false; error: string; path?: string }

export type ApplyTransformContext = {
  fileContent: string
  path: string
  finding: PersistedFindingRow
  fetchImpl?: typeof fetch
}

export type TransformHandler = (
  ctx: ApplyTransformContext,
) => Promise<ApplyTransformResult>

export type VerifyContext = {
  finding: PersistedFindingRow
  body: string
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
  resolveVerifyUrl?: (
    finding: PersistedFindingRow,
    baseOriginOrPreview: string,
  ) => string | null
  previewVerifier: TransformVerifier
  productionVerifier: TransformVerifier
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

const verifyFixture: TransformVerifier = async (ctx) => {
  const needle = `data-seoranko-fix="${ctx.finding.id}"`
  if (ctx.body.includes(needle) || ctx.body.includes('data-seoranko-fix')) {
    return { ok: true, detail: 'Fixture marker present in fetched body' }
  }
  return { ok: false, detail: 'Fixture marker missing in fetched body' }
}

const REGISTRY: RegistryEntry[] = [
  {
    topicId: '49',
    verdict: 'auto-set-dimensions',
    handler: topic49Handler,
    resolvePath: (f) => (f.pageUrl ? pathFromPageUrl(f.pageUrl) : null),
    previewVerifier: verifyTopic49,
    productionVerifier: verifyTopic49,
  },
  {
    topicId: 'fixture',
    verdict: 'auto-fixture-patch',
    handler: fixturePatchHandler,
    resolvePath: (f) => (f.pageUrl ? pathFromPageUrl(f.pageUrl) : null),
    previewVerifier: verifyFixture,
    productionVerifier: verifyFixture,
  },
]

function findEntry(
  topicId: string,
  verdict: string,
): RegistryEntry | undefined {
  return REGISTRY.find((r) => r.topicId === topicId && r.verdict === verdict)
}

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
 * Order findings for apply: path → topicId → id (same-file edits sequential).
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
