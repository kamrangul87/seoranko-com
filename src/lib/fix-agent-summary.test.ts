import { describe, expect, it } from 'vitest'
import { buildFixAgentRunSummary, inferFixWritePath } from './fix-agent'

describe('buildFixAgentRunSummary', () => {
  it('only counts verified as live; pending is unverified not applied', () => {
    expect(
      buildFixAgentRunSummary({
        liveCount: 0,
        pendingDeployCount: 4,
        pendingMergeCount: 0,
        failedCount: 0,
        humanTaskCount: 5,
      }),
    ).toBe(
      'Fix Agent finished: 4 unverified (written, not confirmed live), 5 human task(s).',
    )
  })

  it('reports live + unverified + failures without Applied language', () => {
    const msg = buildFixAgentRunSummary({
      liveCount: 1,
      pendingDeployCount: 2,
      pendingMergeCount: 3,
      failedCount: 4,
      humanTaskCount: 5,
    })
    expect(msg).toBe(
      'Fix Agent finished: 1 live (re-crawl confirmed), 5 unverified (written, not confirmed live), 4 failed (see errors), 5 human task(s).',
    )
    expect(msg).not.toMatch(/applied/i)
    expect(msg).not.toMatch(/awaiting PR merge/i)
  })

  it('never returns a silent zero-applied line when only human tasks exist', () => {
    const msg = buildFixAgentRunSummary({
      liveCount: 0,
      pendingDeployCount: 0,
      pendingMergeCount: 0,
      failedCount: 0,
      humanTaskCount: 5,
    })
    expect(msg).toBe('Fix Agent finished: 5 human task(s).')
    expect(msg).not.toMatch(/0 applied/i)
  })

  it('reports empty run as nothing confirmed live', () => {
    expect(
      buildFixAgentRunSummary({
        liveCount: 0,
        pendingDeployCount: 0,
        pendingMergeCount: 0,
        failedCount: 0,
        humanTaskCount: 0,
      }),
    ).toBe('Fix Agent finished: nothing confirmed live.')
  })
})

describe('inferFixWritePath', () => {
  it('detects direct-then-PR fallback failures (legacy messages)', () => {
    expect(
      inferFixWritePath(
        'Direct push blocked (Resource not accessible (HTTP 403)). PR fallback also failed: Could not create review branch (403).',
      ),
    ).toBe('direct_then_pr')
  })

  it('classifies new no-PR-fallback block as direct_push', () => {
    expect(
      inferFixWritePath(
        'Direct push blocked (Resource not accessible by integration (HTTP 403)). Fix Agent requires Contents write on the default branch (PR fallback is disabled).',
      ),
    ).toBe('direct_push')
  })

  it('detects PR-fallback-only errors (legacy)', () => {
    expect(inferFixWritePath('GitHub commit to review branch failed (422)')).toBe('pr_fallback')
    expect(inferFixWritePath('Change committed to branch "seoranko-fix-abc" but the Pull Request could not be opened: 422')).toBe(
      'pr_fallback',
    )
  })

  it('detects direct-push GitHub errors', () => {
    expect(inferFixWritePath('GitHub commit failed (HTTP 401)')).toBe('direct_push')
    expect(inferFixWritePath('Resource not accessible by integration (HTTP 403)')).toBe('direct_push')
  })

  it('marks strategy failures that never reached GitHub', () => {
    expect(inferFixWritePath('Security headers require host config', 'headers-unsupported')).toBe(
      'no_github_write',
    )
    expect(inferFixWritePath('No strategy available')).toBe('no_github_write')
  })
})
