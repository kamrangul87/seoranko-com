import { describe, expect, it } from 'vitest'
import {
  findingStatusForOpenIssue,
  findingStatusFromFixAttempt,
} from './finding-status'

describe('finding status vocabulary', () => {
  it('maps verified + awaiting Google to Awaiting Google recrawl', () => {
    expect(
      findingStatusFromFixAttempt({ status: 'verified', awaitingGoogleRecrawl: true }),
    ).toBe('Awaiting Google recrawl')
  })

  it('maps verified without Google lag to Verified', () => {
    expect(findingStatusFromFixAttempt({ status: 'verified' })).toBe('Verified')
  })

  it('never treats commit/PR as Verified', () => {
    expect(findingStatusFromFixAttempt({ status: 'unverified' })).toBe('Implemented')
    expect(findingStatusFromFixAttempt({ status: 'pr_pending' })).toBe('Implemented')
    expect(findingStatusFromFixAttempt({ status: 'pending_deploy' })).toBe('Implemented')
    expect(findingStatusFromFixAttempt({ status: 'applied' })).toBe('Implemented')
  })

  it('maps open issues to Auto-fixable / Connection required / Invalid evidence', () => {
    expect(
      findingStatusForOpenIssue({ autoFixable: true, connectionPresent: true }),
    ).toBe('Auto-fixable')
    expect(
      findingStatusForOpenIssue({
        autoFixable: true,
        connectionPresent: false,
        needsCrossHostConnection: true,
      }),
    ).toBe('Connection required')
    expect(
      findingStatusForOpenIssue({
        autoFixable: true,
        connectionPresent: true,
        evidenceValid: false,
      }),
    ).toBe('Invalid evidence')
  })
})
