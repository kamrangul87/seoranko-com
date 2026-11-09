import { describe, expect, it } from 'vitest'
import { findingsResolvedByJurisdiction } from './reevaluate-jurisdiction'

describe('findingsResolvedByJurisdiction', () => {
  it('resolves jurisdiction-not-set once a jurisdiction is set, and does nothing when empty', () => {
    const rows = [
      { id: 'a', verdict: 'human-review-jurisdiction-not-set', status: 'open' },
      { id: 'b', verdict: 'human-review-section-missing-rights', status: 'open' },
    ]
    expect(findingsResolvedByJurisdiction(rows, null)).toEqual([])
    expect(findingsResolvedByJurisdiction(rows, 'UK')).toEqual(['a'])
  })
})
