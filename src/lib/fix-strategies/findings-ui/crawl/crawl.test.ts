import { describe, expect, it, beforeEach } from 'vitest'
import {
  CRAWL_URL_CHUNK_SIZE,
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
  rollupAndClassify,
  type DetectorEmit,
} from './index'
import { classifyVerdictBucket } from '../buckets'

describe('findings crawl persistence', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
  })

  it('exports chunk size 5 for serverless ticks', () => {
    expect(CRAWL_URL_CHUNK_SIZE).toBe(5)
  })

  it('upserts findings by (site, topic, rollupKey) and records observations', async () => {
    const store = createMemoryFindingsStore()
    const run1 = await store.createRun({
      siteId: 'site-a',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    const run2 = await store.createRun({
      siteId: 'site-a',
      userId: 'user-a',
      origin: 'https://example.com',
    })

    const finding = {
      topicId: '38',
      kind: 'structured-data/contradicts-visible-page',
      verdict: 'human-review-entity-url-mismatch',
      severity: 'high',
      detail: 'entity url mismatch',
      pageUrl: 'https://example.com/blog',
      declarationSite: 'generator:site-jsonld',
      rollupKey: '38|human-review-entity-url-mismatch|generator:site-jsonld',
      affectedUrlCount: 3,
      rolledUp: true,
      bucket: 'actionable' as const,
      autoFixable: false,
      reportOnly: true,
      surfaceClass: 'human-review',
      proposedDiff: null,
      evidenceValues: null,
      sourceRows: [],
    }

    await store.upsertFindings({
      siteId: 'site-a',
      userId: 'user-a',
      runId: run1.id,
      findings: [finding],
      internalEvidence: [
        {
          topicId: '38',
          kind: 'x',
          verdict: 'suppress-unknown-type',
          severity: null,
          detail: 'suppressed',
          pageUrl: 'https://example.com/blog',
          declarationSite: null,
          autoFixable: false,
          proposedDiff: null,
          evidenceValues: null,
          bucket: 'internal',
        },
      ],
    })

    await store.upsertFindings({
      siteId: 'site-a',
      userId: 'user-a',
      runId: run2.id,
      findings: [{ ...finding, affectedUrlCount: 4, detail: 'updated' }],
      internalEvidence: [],
    })

    const listed = await store.listFindings({
      siteId: 'site-a',
      includeInformational: false,
    })
    expect(listed).toHaveLength(1)
    expect(listed[0]!.affectedUrlCount).toBe(4)
    expect(listed[0]!.detail).toBe('updated')
    expect(listed[0]!.firstSeenRunId).toBe(run1.id)
    expect(listed[0]!.lastSeenRunId).toBe(run2.id)

    const counts = await store.counts('site-a')
    expect(counts.actionable).toBe(1)
    expect(counts.informational).toBe(0)
    expect(counts.internal).toBeGreaterThanOrEqual(1)

    // Internal never returned by list
    const withInfo = await store.listFindings({
      siteId: 'site-a',
      includeInformational: true,
    })
    expect(withInfo.every((f) => f.bucket !== 'internal')).toBe(true)
  })

  it('claimUrlChunk processes resumable queue', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 's',
      userId: 'u',
      origin: 'https://example.com',
    })
    await store.enqueueUrls(run.id, [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
      'https://example.com/d',
      'https://example.com/e',
      'https://example.com/f',
    ])
    const chunk1 = await store.claimUrlChunk(run.id, CRAWL_URL_CHUNK_SIZE)
    expect(chunk1).toHaveLength(5)
    for (const j of chunk1) {
      await store.updateUrlJob(j.id, { status: 'crawled' })
    }
    const chunk2 = await store.claimUrlChunk(run.id, CRAWL_URL_CHUNK_SIZE)
    expect(chunk2).toHaveLength(1)
    const counts = await store.countJobsByStatus(run.id)
    expect(counts.crawled).toBe(5)
    expect(counts.running).toBe(1)
  })
})

describe('rollupAndClassify buckets', () => {
  it('keeps internal emits as evidence only', () => {
    const emits: DetectorEmit[] = [
      {
        topicId: '38',
        kind: 'structured-data/contradicts-visible-page',
        verdict: 'human-review-entity-url-mismatch',
        severity: 'high',
        detail: 'mismatch',
        pageUrl: 'https://example.com/a',
        declarationSite: 'generator:x',
        autoFixable: false,
        proposedDiff: null,
        evidenceValues: null,
        bucket: classifyVerdictBucket('human-review-entity-url-mismatch'),
      },
      {
        topicId: '38',
        kind: 'structured-data/contradicts-visible-page',
        verdict: 'suppress-unknown-type',
        severity: null,
        detail: 'ok',
        pageUrl: 'https://example.com/a',
        declarationSite: null,
        autoFixable: false,
        proposedDiff: null,
        evidenceValues: null,
        bucket: classifyVerdictBucket('suppress-unknown-type'),
      },
    ]
    const { findings, internalEvidence } = rollupAndClassify(emits)
    expect(internalEvidence).toHaveLength(1)
    expect(findings.every((f) => f.bucket !== 'internal')).toBe(true)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.rollupKey).toContain('generator:x')
  })
})
