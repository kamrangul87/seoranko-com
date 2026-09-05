import { describe, expect, it } from 'vitest'
import { buildFixAgentRunSummary } from './fix-agent'

describe('buildFixAgentRunSummary', () => {
  it('distinguishes awaiting Vercel deploy from human tasks', () => {
    expect(
      buildFixAgentRunSummary({
        liveCount: 0,
        pendingDeployCount: 4,
        pendingMergeCount: 0,
        failedCount: 0,
        humanTaskCount: 5,
      }),
    ).toBe(
      'Fix Agent finished: 4 committed, awaiting Vercel deploy, 5 human task(s).',
    )
  })

  it('reports PR merge pending and failures with see-errors cue', () => {
    expect(
      buildFixAgentRunSummary({
        liveCount: 1,
        pendingDeployCount: 2,
        pendingMergeCount: 3,
        failedCount: 4,
        humanTaskCount: 5,
      }),
    ).toBe(
      'Fix Agent finished: 1 live, 2 committed, awaiting Vercel deploy, 3 PR(s) awaiting merge, 4 failed (see errors), 5 human task(s).',
    )
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

  it('reports empty run clearly', () => {
    expect(
      buildFixAgentRunSummary({
        liveCount: 0,
        pendingDeployCount: 0,
        pendingMergeCount: 0,
        failedCount: 0,
        humanTaskCount: 0,
      }),
    ).toBe('Fix Agent finished: nothing applied.')
  })
})
