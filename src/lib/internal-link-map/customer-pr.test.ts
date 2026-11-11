import { describe, expect, it } from 'vitest'
import {
  classifyCustomerPr,
  parseGithubPullUrl,
} from './customer-pr'

describe('parseGithubPullUrl', () => {
  it('reads owner, repo, and number from a github.com pull URL', () => {
    expect(
      parseGithubPullUrl('https://github.com/kamrangul87/autodun-ai/pull/69'),
    ).toEqual({ owner: 'kamrangul87', repo: 'autodun-ai', prNumber: 69 })
  })

  it('returns null for a non-PR URL', () => {
    expect(parseGithubPullUrl('https://example.com/not-a-pr')).toBeNull()
    expect(parseGithubPullUrl('')).toBeNull()
  })
})

describe('classifyCustomerPr', () => {
  it('treats an open PR as still actionable', () => {
    expect(classifyCustomerPr({ state: 'open', merged: false })).toBe('open')
  })

  it('treats merged_at as merged without ever merging', () => {
    expect(classifyCustomerPr({ state: 'closed', merged: true })).toBe('merged')
    expect(classifyCustomerPr({ state: 'open', merged: true })).toBe('merged')
  })

  it('treats a closed unmerged PR as closed_unmerged', () => {
    expect(classifyCustomerPr({ state: 'closed', merged: false })).toBe(
      'closed_unmerged',
    )
  })

  it('is unknown when GitHub was not reached', () => {
    expect(classifyCustomerPr(null)).toBe('unknown')
    expect(classifyCustomerPr(undefined)).toBe('unknown')
  })
})
