import { afterEach, describe, expect, it } from 'vitest'
import { countsForViewer, shouldShowInternalCounts } from './customer-counts'

describe('countsForViewer', () => {
  afterEach(() => {
    delete process.env.MASTER_EMAIL
  })

  it('zeros internal for non-master customers', () => {
    process.env.MASTER_EMAIL = 'owner@example.com'
    expect(
      countsForViewer(
        { actionable: 3, informational: 2, internal: 5798 },
        'customer@example.com',
      ),
    ).toEqual({ actionable: 3, informational: 2, internal: 0 })
    expect(shouldShowInternalCounts('customer@example.com')).toBe(false)
  })

  it('keeps internal for master', () => {
    process.env.MASTER_EMAIL = 'owner@example.com'
    expect(
      countsForViewer(
        { actionable: 3, informational: 2, internal: 5798 },
        'owner@example.com',
      ),
    ).toEqual({ actionable: 3, informational: 2, internal: 5798 })
    expect(shouldShowInternalCounts('owner@example.com')).toBe(true)
  })
})
