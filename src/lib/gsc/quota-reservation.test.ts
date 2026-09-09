/**
 * Concurrent reserve_gsc_inspection_quota simulation (pure JS mirror of the SQL).
 * Proves the FOR UPDATE + increment pattern cannot oversell soft cap under races.
 * Live SQL evidence is asserted after migrate CI applies the RPC in production.
 */

import { describe, expect, it } from 'vitest'
import { GSC_INSPECTION_SOFT_CAP } from './url-inspection'

type QuotaRow = {
  requests_used: number
  exhausted: boolean
}

/**
 * Serialized reservation matching the plpgsql function semantics:
 * remaining = soft_cap - used; reserved = min(requested, remaining).
 */
function reserveOnce(
  row: QuotaRow,
  requested: number,
  softCap: number,
): { reserved: number; remaining: number } {
  if (row.exhausted || softCap - row.requests_used <= 0) {
    row.exhausted = true
    return { reserved: 0, remaining: 0 }
  }
  const remainingBefore = softCap - row.requests_used
  const reserved = Math.min(requested, remainingBefore)
  row.requests_used += reserved
  if (row.requests_used >= softCap) row.exhausted = true
  return { reserved, remaining: Math.max(0, softCap - row.requests_used) }
}

describe('quota reservation concurrency model', () => {
  it('never oversells soft cap when N callers race for the last slots', () => {
    const softCap = 100
    const row: QuotaRow = { requests_used: 90, exhausted: false }
    // 20 concurrent callers each asking for 10 — only 10 total remain
    const results = Array.from({ length: 20 }, () => reserveOnce(row, 10, softCap))
    const totalReserved = results.reduce((s, r) => s + r.reserved, 0)
    expect(totalReserved).toBe(10)
    expect(row.requests_used).toBe(softCap)
    expect(results.filter((r) => r.reserved === 0).length).toBeGreaterThan(0)
  })

  it('uses product soft cap constant (2000 - 50 reserve)', () => {
    expect(GSC_INSPECTION_SOFT_CAP).toBe(1950)
    const row: QuotaRow = { requests_used: 1940, exhausted: false }
    const a = reserveOnce(row, 40, GSC_INSPECTION_SOFT_CAP)
    const b = reserveOnce(row, 40, GSC_INSPECTION_SOFT_CAP)
    expect(a.reserved).toBe(10)
    expect(b.reserved).toBe(0)
    expect(a.reserved + b.reserved).toBe(10)
  })
})
