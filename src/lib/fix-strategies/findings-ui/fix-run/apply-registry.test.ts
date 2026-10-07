/**
 * Registry gate + same-file ordering. Wired topics require stored
 * sourcePath + sourceBlobSha before isCommitableFinding.
 */

import { describe, expect, it } from 'vitest'
import type { PersistedFindingRow } from '../crawl/constants'
import {
  applyRegisteredTransform,
  isCommitableFinding,
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
    sourcePath: null,
    sourceBlobSha: null,
    sourceResolvedAt: null,
    sourceUnresolvedReason: null,
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
  it('registers wired topics + fixture; excludes 13 / text-plain / 28', () => {
    const registered = listRegisteredTransforms()
    expect(registered).toEqual(
      expect.arrayContaining([
        { topicId: '49', verdict: 'auto-set-dimensions' },
        { topicId: 'fixture', verdict: 'auto-fixture-patch' },
        { topicId: '1', verdict: 'auto-fixable' },
        { topicId: '14', verdict: 'auto-self-canonical' },
        { topicId: '17', verdict: 'auto-collapse-redundant' },
        { topicId: '17', verdict: 'auto-remove-body-misplaced' },
        { topicId: '22', verdict: 'auto-remove-crawl-delay' },
        { topicId: '26', verdict: 'auto-remove-confirmed-4xx' },
        { topicId: '26', verdict: 'auto-replace-single-hop-redirect' },
        { topicId: '42', verdict: 'auto-rewrite' },
      ]),
    )
    expect(isTransformRegistered('13', 'auto-add-self-canonical')).toBe(false)
    expect(isTransformRegistered('22', 'auto-set-text-plain')).toBe(false)
    expect(isTransformRegistered('28', 'informational-unreferenced')).toBe(false)
  })

  it('isCommitableFinding requires stored path + blob SHA', () => {
    const without = finding({
      id: 'a',
      topicId: '49',
      verdict: 'auto-set-dimensions',
      pageUrl: 'https://x.com/blog',
    })
    expect(isCommitableFinding(without)).toBe(false)

    const withPath = finding({
      id: 'b',
      topicId: '49',
      verdict: 'auto-set-dimensions',
      pageUrl: 'https://x.com/blog',
      sourcePath: 'public/blog/index.html',
      sourceBlobSha: 'abc123',
    })
    expect(isCommitableFinding(withPath)).toBe(true)
    expect(resolveTransformPath(withPath)).toBe('public/blog/index.html')
  })
})

describe('fixture apply + verifier', () => {
  it('applies marker and verifies on re-fetched body', async () => {
    const f = finding({
      id: 'fx-1',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      pageUrl: 'https://fixture.example/a.html',
      sourcePath: 'public/a.html',
      sourceBlobSha: 'sha-a',
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
      liveUrl: 'https://preview.example/a.html',
      stage: 'preview',
    })
    expect(v.ok).toBe(true)
  })
})

describe('same-file ordering', () => {
  it('orders two fixture transforms on the same file by path → topic → id', () => {
    const a = finding({
      id: 'z',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      sourcePath: 'public/about.html',
      sourceBlobSha: 's1',
    })
    const b = finding({
      id: 'a',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      sourcePath: 'public/about.html',
      sourceBlobSha: 's1',
    })
    expect(resolveTransformPath(a)).toBe('public/about.html')
    expect(resolveTransformPath(b)).toBe('public/about.html')
    const ordered = orderFindingsForApply([a, b])
    expect(ordered.map((f) => f.id)).toEqual(['a', 'z'])
  })

  it('applies two transforms sequentially on one file body', async () => {
    const f1 = finding({
      id: 'one',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      sourcePath: 'public/x.html',
      sourceBlobSha: 's',
    })
    const f2 = finding({
      id: 'two',
      topicId: 'fixture',
      verdict: 'auto-fixture-patch',
      sourcePath: 'public/x.html',
      sourceBlobSha: 's',
    })
    let body = '<html><body>Start</body></html>'
    for (const f of orderFindingsForApply([f2, f1])) {
      const applied = await applyRegisteredTransform({
        fileContent: body,
        path: 'public/x.html',
        finding: f,
      })
      expect(applied.ok).toBe(true)
      if (applied.ok) body = applied.newContent
    }
    expect(body).toContain('data-seoranko-fix="one"')
    expect(body).toContain('data-seoranko-fix="two"')
  })
})
