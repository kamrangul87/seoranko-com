import { describe, expect, it } from 'vitest'
import { filterRecoverableRuns, type RecoverableRunRow } from './recoverable'

function run(overrides: Partial<RecoverableRunRow> & Pick<RecoverableRunRow, 'id'>): RecoverableRunRow {
  return {
    prNumber: 63,
    prUrl: 'https://github.com/o/r/pull/63',
    createdAt: '2026-11-03T06:00:00.000Z',
    status: 'failed',
    phase: 'done',
    errorDetail: 'No progress for 15 minutes — failed by heartbeat watchdog',
    closedByCustomer: false,
    summary: { verifiedLive: 0, committed: 1 },
    ...overrides,
  }
}

describe('filterRecoverableRuns', () => {
  it('hides a watchdog-failed PR when a later receipt already exists', () => {
    const out = filterRecoverableRuns({
      runs: [run({ id: 'old-63' })],
      receiptPrNumbers: [65],
      latestReceiptAt: '2026-11-03T07:28:06.000Z',
    })
    expect(out).toEqual([])
  })

  it('hides a closed PR and a PR that already has a receipt', () => {
    const out = filterRecoverableRuns({
      runs: [
        run({ id: 'closed', closedByCustomer: true, prNumber: 60 }),
        run({ id: 'receipted', prNumber: 64, createdAt: '2026-11-03T08:00:00.000Z' }),
      ],
      receiptPrNumbers: [64],
    })
    expect(out).toEqual([])
  })

  it('keeps a failed merged-without-receipt run as a fallback', () => {
    const out = filterRecoverableRuns({
      runs: [
        run({
          id: 'need',
          prNumber: 70,
          createdAt: '2026-11-09T08:00:00.000Z',
          mergedByCustomer: true,
          mergedAt: '2026-11-09T08:05:00.000Z',
        }),
      ],
      receiptPrNumbers: [],
    })
    expect(out.map((r) => r.id)).toEqual(['need'])
  })
})
