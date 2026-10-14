import { describe, expect, it } from 'vitest'
import { isCurrentlyPresentFindingStatus } from './finding-status'

describe('isCurrentlyPresentFindingStatus', () => {
  it('treats open and regressed as currently present', () => {
    expect(isCurrentlyPresentFindingStatus('open')).toBe(true)
    expect(isCurrentlyPresentFindingStatus('regressed')).toBe(true)
  })

  it('treats resolved and superseded as history only', () => {
    expect(isCurrentlyPresentFindingStatus('resolved')).toBe(false)
    expect(isCurrentlyPresentFindingStatus('superseded')).toBe(false)
    expect(isCurrentlyPresentFindingStatus(null)).toBe(false)
  })
})
