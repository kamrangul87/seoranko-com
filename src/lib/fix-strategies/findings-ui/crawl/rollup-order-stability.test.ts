/**
 * Two crawls of the same fixture emits in different page orders must produce
 * identical finding identities (rollupKey) and an empty What changed digest.
 *
 * Topics that emit group findings (declaration-site rollup and/or native
 * member sets): 8–12 (config), 33 (memberUrls), 38 (generator), 42
 * (observedOn / redirect-target), 49 (shared component/generator). This
 * test exercises 8 + 38 + 49 via multi-page emits sharing a collapsible site.
 */
import { describe, expect, it } from 'vitest'
import { rollupAndClassify, type DetectorEmit } from './run-detectors'
import { createMemoryFindingsStore } from './store'
import { buildWhatChangedDigest } from './what-changed'
import { classifyVerdictBucket } from '../buckets'

function emit(
  partial: Omit<
    DetectorEmit,
    'bucket' | 'autoFixable' | 'proposedDiff' | 'evidenceValues'
  > &
    Partial<Pick<DetectorEmit, 'autoFixable' | 'evidenceValues'>>,
): DetectorEmit {
  return {
    autoFixable: false,
    proposedDiff: null,
    evidenceValues: null,
    bucket: classifyVerdictBucket(partial.verdict),
    ...partial,
  }
}

function fixtureEmits(pageOrder: string[]): DetectorEmit[] {
  const t8 = pageOrder.map((pageUrl) =>
    emit({
      topicId: '8',
      kind: 'duplicate-url/trailing-slash',
      verdict: 'informational-generated-only',
      severity: null,
      detail: 'generated-only peer',
      pageUrl,
      declarationSite: 'config:vercel.json',
    }),
  )
  const t38 = pageOrder.map((pageUrl) =>
    emit({
      topicId: '38',
      kind: 'structured-data/contradicts-visible-page',
      verdict: 'human-review-entity-url-mismatch',
      severity: 'high',
      detail: 'entity url',
      pageUrl,
      declarationSite: 'generator:article-jsonld',
    }),
  )
  const t49 = pageOrder.map((pageUrl) =>
    emit({
      topicId: '49',
      kind: 'performance/img-missing-dimensions',
      verdict: 'human-review-no-height-auto',
      severity: null,
      detail: 'no height',
      pageUrl,
      declarationSite: 'components/BlogImage.tsx',
    }),
  )
  return [...t8, ...t38, ...t49]
}

describe('rollup order stability across crawls', () => {
  const pagesA = [
    'https://example.com/about.html',
    'https://example.com/blog/',
    'https://example.com/',
  ]
  const pagesB = [...pagesA].reverse()

  it('identical rollupKeys and representative pageUrls regardless of emit order', () => {
    const a = rollupAndClassify(fixtureEmits(pagesA)).findings
    const b = rollupAndClassify(fixtureEmits(pagesB)).findings
    const keysA = a.map((f) => f.rollupKey).sort()
    const keysB = b.map((f) => f.rollupKey).sort()
    expect(keysA).toEqual(keysB)

    const byKey = (rows: typeof a) =>
      new Map(rows.map((f) => [f.rollupKey, f]))
    const mapA = byKey(a)
    const mapB = byKey(b)
    for (const key of keysA) {
      const fa = mapA.get(key)!
      const fb = mapB.get(key)!
      expect(fa.pageUrl).toBe(fb.pageUrl)
      expect(fa.verdict).toBe(fb.verdict)
      expect(fa.evidenceValues?.memberUrls).toEqual(
        fb.evidenceValues?.memberUrls,
      )
    }

    const t8 = a.find((f) => f.topicId === '8')!
    expect(t8.pageUrl).toBe('https://example.com/')
    expect(t8.rollupKey).toBe(
      '8|informational-generated-only|config:vercel.json',
    )
    expect(t8.rollupKey).not.toContain('about.html')
    expect(t8.evidenceValues?.memberUrls).toEqual([
      'https://example.com/',
      'https://example.com/blog/',
      'https://example.com/about.html',
    ])
  })

  it('two memory-store crawls yield empty What changed (no new/resolved)', async () => {
    const store = createMemoryFindingsStore()
    const siteId = 'site-order'
    const userId = 'user-order'
    const run1 = await store.createRun({
      siteId,
      userId,
      origin: 'https://example.com',
    })
    const { findings: f1 } = rollupAndClassify(fixtureEmits(pagesA))
    await store.upsertFindings({
      siteId,
      detectOrigin: null,
      userId,
      runId: run1.id,
      findings: f1,
      internalEvidence: [],
    })
    await store.updateRun(run1.id, {
      status: 'complete',
      finishedAt: new Date().toISOString(),
    })

    const run2 = await store.createRun({
      siteId,
      userId,
      origin: 'https://example.com',
    })
    const { findings: f2 } = rollupAndClassify(fixtureEmits(pagesB))
    await store.upsertFindings({
      siteId,
      detectOrigin: null,
      userId,
      runId: run2.id,
      findings: f2,
      internalEvidence: [],
    })
    await store.updateRun(run2.id, {
      status: 'complete',
      finishedAt: new Date().toISOString(),
    })

    const listed = await store.listFindings({
      siteId,
      includeInformational: true,
    })
    const digest = buildWhatChangedDigest({
      currentRunId: run2.id,
      previousRunId: run1.id,
      findings: listed,
      nowIso: '2026-10-12T12:00:00.000Z',
    })
    expect(digest.newFindings).toHaveLength(0)
    expect(digest.resolvedFindings).toHaveLength(0)
    expect(digest.regressedFindings).toHaveLength(0)
    expect(digest.summaryLine).toMatch(/No changes/)
  })
})
