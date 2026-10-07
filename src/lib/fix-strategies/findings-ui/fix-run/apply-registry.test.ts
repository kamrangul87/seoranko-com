/**
 * Registry gate + same-file ordering. Product transform: topic 49 only
 * (Phase 2 candidates failed pre-checks — not registered).
 */

import { describe, expect, it } from 'vitest'
import type { PersistedFindingRow } from '../crawl/constants'
import {
  applyRegisteredTransform,
  isTransformRegistered,
  listRegisteredTransforms,
  orderFindingsForApply,
  resolveTransformPath,
  verifyRegisteredTransform,
} from './apply-registry'

function finding(
  partial: Partial<PersistedFindingRow> &
    Pick<PersistedFindingRow, 'id' | 'topicId' | 'verdict'>,
): PersistedFindingRow {
  const now = new Date().toISOString()
  return {
    siteId: 'site-1',
    detectOrigin: null,
    userId: 'user-1',
    kind: `topic/${partial.topicId}`,
    bucket: 'actionable',
    severity: 'moderate',
    rollupKey: `${partial.topicId}|${partial.verdict}`,
    declarationSite: null,
    affectedUrlCount: 1,
    pageUrl: null,
    detail: '',
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'auto-fixable',
    proposedDiff: null,
    evidenceValues: null,
    sourceRows: [],
    firstSeenRunId: null,
    lastSeenRunId: null,
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'open',
    resolvedAt: null,
    fixedAt: null,
    verificationAt: null,
    postFixStatus: null,
    regressionObservedAt: null,
    ...partial,
  }
}

describe('apply-registry registration gate', () => {
  it('registers only topic 49 + fixture (Phase 2 candidates excluded)', () => {
    expect(listRegisteredTransforms()).toEqual([
      { topicId: '49', verdict: 'auto-set-dimensions' },
      { topicId: 'fixture', verdict: 'auto-fixture-patch' },
    ])
    expect(isTransformRegistered('49', 'auto-set-dimensions')).toBe(true)
    expect(isTransformRegistered('fixture', 'auto-fixture-patch')).toBe(true)

    // Failed pre-check — not registered (no path improvisation).
    for (const [topicId, verdict] of [
      ['1', 'auto-fixable'],
      ['13', 'auto-add-self-canonical'],
      ['14', 'auto-self-canonical'],
      ['17', 'auto-collapse-redundant'],
      ['17', 'auto-remove-body-misplaced'],
      ['22', 'auto-remove-crawl-delay'],
      ['22', 'auto-set-text-plain'],
      ['26', 'auto-remove-confirmed-4xx'],
      ['26', 'auto-replace-single-hop-redirect'],
      ['28', 'informational-unreferenced'],
      ['42', 'auto-rewrite'],
    ] as const) {
      expect(isTransformRegistered(topicId, verdict)).toBe(false)
    }
  })
})

describe('fixture apply + verifier', () => {
  it('applies marker and verifies on re-fetched body', async () => {
    const f = finding({
      id: 'fx-1',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      pageUrl: 'https://fixture.example/a.html',
    })
    const applied = await applyRegisteredTransform({
      fileContent: '<html><body>Hi</body></html>',
      path: 'public/a.html',
      finding: f,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.newContent).toContain('data-seoranko-fix="fx-1"')
    const v = await verifyRegisteredTransform({
      finding: f,
      body: applied.newContent,
      liveUrl: 'https://fixture.example/a.html',
      stage: 'preview',
    })
    expect(v.ok).toBe(true)
  })
})

describe('same-file ordering in one run', () => {
  it('orders two fixture transforms on the same file by path → topic → id', () => {
    const a = finding({
      id: 'z-later',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      pageUrl: 'https://fixture.example/about.html',
    })
    const b = finding({
      id: 'a-first',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      pageUrl: 'https://fixture.example/about.html',
    })
    const c = finding({
      id: 'other',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      pageUrl: 'https://fixture.example/blog/index.html',
    })
    expect(resolveTransformPath(a)).toBe('public/about.html')
    expect(resolveTransformPath(b)).toBe('public/about.html')

    const ordered = orderFindingsForApply([a, c, b])
    expect(ordered.map((f) => f.id)).toEqual(['a-first', 'z-later', 'other'])
  })

  it('applies two transforms sequentially on one file body', async () => {
    const pageUrl = 'https://fixture.example/about.html'
    const first = finding({
      id: 'aa',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      pageUrl,
    })
    const second = finding({
      id: 'bb',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      pageUrl,
    })
    let body = '<html><body>Start</body></html>'
    for (const f of orderFindingsForApply([second, first])) {
      const path = resolveTransformPath(f)!
      const applied = await applyRegisteredTransform({
        fileContent: body,
        path,
        finding: f,
      })
      expect(applied.ok).toBe(true)
      if (!applied.ok) return
      // First apply inserts a marker; second is noop if marker already present.
      if (f.id === 'aa') {
        expect(applied.updated).toBeGreaterThan(0)
        body = applied.newContent
      } else {
        expect(applied.noop || applied.updated === 0).toBe(true)
      }
    }
    expect(body).toContain('data-seoranko-fix="aa"')
  })
})
