import { describe, expect, it } from 'vitest'
import {
  buildWhatChangedDigest,
  pickPreviousTerminalRunId,
} from './what-changed'
import type { PersistedFindingRow } from './constants'

function finding(
  overrides: Partial<PersistedFindingRow> & Pick<PersistedFindingRow, 'id'>,
): PersistedFindingRow {
  const now = '2026-09-28T12:00:00.000Z'
  const { id, ...rest } = overrides
  return {
    id,
    siteId: 'site-a',
    detectOrigin: null,
    userId: 'user-a',
    topicId: '13',
    kind: 'canonical/tag-absent',
    bucket: 'actionable',
    verdict: 'auto-add-canonical',
    severity: 'medium',
    rollupKey: `13|${id}`,
    declarationSite: null,
    affectedUrlCount: 1,
    pageUrl: 'https://example.com/page',
    detail: 'no canonical',
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'auto-fixable',
    proposedDiff: null,
    evidenceValues: null,
    sourceRows: [],
    firstSeenRunId: 'run-cur',
    lastSeenRunId: 'run-cur',
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'open',
    resolvedAt: null,
    fixedAt: null,
    verificationAt: null,
    postFixStatus: null,
    regressionObservedAt: null,
    ...rest,
  }
}

describe('pickPreviousTerminalRunId', () => {
  it('prefers prior scheduled terminal over manual', () => {
    const id = pickPreviousTerminalRunId(
      [
        {
          id: 'run-cur',
          status: 'partial',
          trigger: 'scheduled',
          createdAt: '2026-09-28T10:00:00.000Z',
        },
        {
          id: 'run-manual',
          status: 'complete',
          trigger: 'manual',
          createdAt: '2026-09-27T10:00:00.000Z',
        },
        {
          id: 'run-sched',
          status: 'complete',
          trigger: 'scheduled',
          createdAt: '2026-09-21T10:00:00.000Z',
        },
      ],
      'run-cur',
    )
    expect(id).toBe('run-sched')
  })

  it('falls back to any terminal when no prior scheduled', () => {
    expect(
      pickPreviousTerminalRunId(
        [
          {
            id: 'run-cur',
            status: 'complete',
            trigger: 'scheduled',
            createdAt: '2026-09-28T10:00:00.000Z',
          },
          {
            id: 'run-old',
            status: 'partial',
            trigger: 'manual',
            createdAt: '2026-09-20T10:00:00.000Z',
          },
        ],
        'run-cur',
      ),
    ).toBe('run-old')
  })
})

describe('buildWhatChangedDigest', () => {
  it('summarizes new / resolved / regressed vs previous run', () => {
    const digest = buildWhatChangedDigest({
      currentRunId: 'run-cur',
      previousRunId: 'run-prev',
      nowIso: '2026-09-28T12:00:00.000Z',
      findings: [
        finding({
          id: 'f-new',
          firstSeenRunId: 'run-cur',
          lastSeenRunId: 'run-cur',
          status: 'open',
        }),
        finding({
          id: 'f-resolved',
          firstSeenRunId: 'run-prev',
          lastSeenRunId: 'run-prev',
          status: 'resolved',
          resolvedAt: '2026-09-28T11:00:00.000Z',
        }),
        finding({
          id: 'f-regressed',
          firstSeenRunId: 'run-prev',
          lastSeenRunId: 'run-cur',
          status: 'regressed',
          resolvedAt: '2026-09-21T11:00:00.000Z',
          regressionObservedAt: '2026-09-28T11:30:00.000Z',
        }),
        finding({
          id: 'f-still',
          firstSeenRunId: 'run-prev',
          lastSeenRunId: 'run-cur',
          status: 'open',
        }),
        finding({
          id: 'f-internal',
          bucket: 'internal',
          firstSeenRunId: 'run-cur',
          lastSeenRunId: 'run-cur',
          status: 'open',
        }),
      ],
    })

    expect(digest.previousRunId).toBe('run-prev')
    expect(digest.newFindings.map((f) => f.id)).toEqual(['f-new'])
    expect(digest.resolvedFindings.map((f) => f.id)).toEqual(['f-resolved'])
    expect(digest.regressedFindings.map((f) => f.id)).toEqual(['f-regressed'])
    expect(digest.stillOpenCount).toBe(3) // new + regressed + still
    expect(digest.summaryLine).toContain('1 new finding')
    expect(digest.summaryLine).toContain('1 resolved')
    expect(digest.summaryLine).toContain('1 regression')
  })

  it('reports no changes when lifecycle is unchanged', () => {
    const digest = buildWhatChangedDigest({
      currentRunId: 'run-cur',
      previousRunId: 'run-prev',
      findings: [
        finding({
          id: 'f1',
          firstSeenRunId: 'run-prev',
          lastSeenRunId: 'run-cur',
          status: 'open',
        }),
      ],
    })
    expect(digest.summaryLine).toBe('No changes — 1 still open')
  })
})
