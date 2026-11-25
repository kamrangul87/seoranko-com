/**
 * Regression: Fix Agent e2e crawl_compare (Sentry 25 Nov 2026).
 *
 * Production compared post-crawl+resolve findings against expected.json and
 * got surface=finding for three homepage rows:
 *   1/human-review → expected report-only
 *   42/auto-rewrite → expected auto-fixable
 *   74/auto-unwrap-origin-prefix → expected auto-fixable
 *
 * Root cause: PR #274 passed reportOnly only for informational buckets, so
 * exact `human-review` (no hyphen suffix) fell through to `finding`. Auto-*
 * rows are demoted to finding at rollup until resolveSourceFile stores
 * path+SHA — ingest must keep the href needle so resolve can promote them.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifySurfaceClass } from '../buckets'
import { takeBuckets, rollupAndClassify, type DetectorEmit } from './run-detectors'
import { detectOriginPrefixedExternalHrefs } from '@/lib/fix-strategies/topic-74/detect'
import { resolveOneFindingSource } from '../fix-run/resolve-finding-sources'
import { evidenceNeedleForResolution } from '../fix-run/apply-evidence'
import type { PersistedFindingRow } from './constants'

const ORIGIN = 'https://seoranko-fixture.vercel.app'
const FIXTURE_ROOT = join(process.cwd(), 'fixtures/seoranko-fixture-site')
const INDEX_HTML = readFileSync(join(FIXTURE_ROOT, 'index.html'), 'utf8')

function emit(
  partial: Pick<
    DetectorEmit,
    'topicId' | 'verdict' | 'pageUrl' | 'autoFixable'
  > &
    Partial<DetectorEmit>,
): DetectorEmit {
  return {
    kind: `topic/${partial.topicId}`,
    severity: null,
    detail: '',
    declarationSite: null,
    proposedDiff: null,
    evidenceValues: null,
    bucket: 'actionable',
    ...partial,
  }
}

function persistedFromRolled(
  f: ReturnType<typeof rollupAndClassify>['findings'][number],
): PersistedFindingRow {
  const now = new Date().toISOString()
  return {
    id: `${f.topicId}-${f.verdict}`,
    siteId: 'fixture',
    detectOrigin: ORIGIN,
    userId: 'u',
    topicId: f.topicId,
    kind: f.kind,
    bucket: f.bucket,
    verdict: f.verdict,
    severity: f.severity,
    rollupKey: f.rollupKey,
    declarationSite: f.declarationSite,
    affectedUrlCount: f.affectedUrlCount,
    pageUrl: f.pageUrl,
    detail: f.detail,
    autoFixable: f.autoFixable,
    reportOnly: f.reportOnly,
    surfaceClass: f.surfaceClass,
    proposedDiff: f.proposedDiff,
    evidenceValues: f.evidenceValues,
    sourceRows: [],
    sourcePath: null,
    sourceBlobSha: null,
    sourceResolvedAt: null,
    sourceUnresolvedReason: null,
    firstSeenRunId: 'run',
    lastSeenRunId: 'run',
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'open',
    resolvedAt: null,
    fixedAt: null,
    verificationAt: null,
    postFixStatus: null,
    regressionObservedAt: null,
    acceptedAt: null,
    acceptedBy: null,
    acceptedFingerprint: null,
  }
}

describe('classifySurfaceClass — fixture crawl_compare verdicts', () => {
  it('exact human-review (topic 1, no hyphen suffix) is report-only, not finding', () => {
    expect(
      classifySurfaceClass('human-review', {
        autoFixable: false,
        reportOnly: false,
      }),
    ).toBe('report-only')
  })

  it('human-review-* stays Needs-you even when reportOnly is stamped', () => {
    expect(
      classifySurfaceClass('human-review-jurisdiction-not-set', {
        autoFixable: false,
        reportOnly: true,
      }),
    ).toBe('human-review')
  })

  it('auto-rewrite and auto-unwrap-origin-prefix classify as auto-fixable', () => {
    expect(classifySurfaceClass('auto-rewrite', { autoFixable: true })).toBe(
      'auto-fixable',
    )
    expect(
      classifySurfaceClass('auto-unwrap-origin-prefix', { autoFixable: true }),
    ).toBe('auto-fixable')
  })
})

describe('rollupAndClassify — Sentry crawl_compare homepage rows', () => {
  it('keeps topic 1 human-review as report-only (not finding / not auto-fixable)', () => {
    const { findings } = rollupAndClassify([
      emit({
        topicId: '1',
        verdict: 'human-review',
        pageUrl: `${ORIGIN}/`,
        autoFixable: false,
        evidenceValues: { href: '/gone.html' },
      }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.surfaceClass).toBe('report-only')
    expect(findings[0]!.autoFixable).toBe(false)
    expect(findings[0]!.reportOnly).toBe(true)
  })

  it('ingests nested evidenceValues.href so topic 74 can resolve after rollup demotion', () => {
    const out: DetectorEmit[] = []
    takeBuckets(
      '74',
      'internal-links/origin-prefixed-external-href',
      {
        findings: [
          {
            verdict: 'auto-unwrap-origin-prefix',
            pageUrl: `${ORIGIN}/`,
            // href only nested — detectors (topic 74) persist apply params here
            evidenceValues: {
              href: '/https://www.gov.uk/check-mot-history',
              rewriteHref: 'https://www.gov.uk/check-mot-history',
            },
            autoFixable: true,
          },
        ],
      },
      out,
      `${ORIGIN}/`,
    )
    expect(out[0]!.evidenceValues).toMatchObject({
      href: '/https://www.gov.uk/check-mot-history',
    })
    const { findings } = rollupAndClassify(out)
    expect(findings[0]!.surfaceClass).toBe('finding')
    expect(evidenceNeedleForResolution(persistedFromRolled(findings[0]!))?.needle).toBe(
      '/https://www.gov.uk/check-mot-history',
    )
  })
})

describe('fixture homepage 42/74 promote after source resolve', () => {
  it('detects origin-prefixed href on fixture index.html and promotes after resolve', async () => {
    const detected = detectOriginPrefixedExternalHrefs(INDEX_HTML, `${ORIGIN}/`)
    expect(detected.findings[0]?.verdict).toBe('auto-unwrap-origin-prefix')

    const out: DetectorEmit[] = []
    takeBuckets(
      '74',
      'internal-links/origin-prefixed-external-href',
      detected,
      out,
      `${ORIGIN}/`,
    )
    const { findings } = rollupAndClassify(out)
    const rolled = findings.find(
      (f) => f.topicId === '74' && f.verdict === 'auto-unwrap-origin-prefix',
    )
    expect(rolled).toBeTruthy()
    expect(rolled!.surfaceClass).toBe('finding')
    expect(rolled!.autoFixable).toBe(false)

    const patch = await resolveOneFindingSource({
      siteId: 'fixture',
      finding: persistedFromRolled(rolled!),
      tree: [{ path: 'index.html', sha: 'sha-index' }],
      treeShas: { 'index.html': 'sha-index' },
      readFile: async (path) => (path === 'index.html' ? INDEX_HTML : null),
    })
    expect(patch.sourcePath).toBe('index.html')
    expect(patch.autoFixable).toBe(true)
    expect(patch.surfaceClass).toBe('auto-fixable')
  })

  it('promotes topic 42 auto-rewrite on fixture homepage after resolve', async () => {
    const out: DetectorEmit[] = []
    takeBuckets(
      '42',
      'internal-links/through-redirects',
      {
        findings: [
          {
            verdict: 'auto-rewrite',
            sourceUrl: `${ORIGIN}/`,
            href: '/old-blog',
            rewriteHref: '/blog/',
            autoFixable: true,
          },
        ],
      },
      out,
      `${ORIGIN}/`,
    )
    const { findings } = rollupAndClassify(out)
    const rolled = findings.find(
      (f) => f.topicId === '42' && f.verdict === 'auto-rewrite',
    )
    expect(rolled).toBeTruthy()
    expect(rolled!.surfaceClass).toBe('finding')

    const patch = await resolveOneFindingSource({
      siteId: 'fixture',
      finding: persistedFromRolled(rolled!),
      tree: [{ path: 'index.html', sha: 'sha-index' }],
      treeShas: { 'index.html': 'sha-index' },
      readFile: async (path) => (path === 'index.html' ? INDEX_HTML : null),
    })
    expect(patch.sourcePath).toBe('index.html')
    expect(patch.autoFixable).toBe(true)
    expect(patch.surfaceClass).toBe('auto-fixable')
  })
})
