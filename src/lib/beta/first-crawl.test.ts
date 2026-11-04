import { describe, expect, it } from 'vitest'
import {
  isFirstCrawlComplete,
  isTerminalFindingsRunStatus,
} from './first-crawl'

describe('isFirstCrawlComplete', () => {
  it('is false until a findings crawl or index diagnosis exists', () => {
    expect(
      isFirstCrawlComplete({
        indexDiagnosisRunCount: 0,
        findingsTerminalRunCount: 0,
      }),
    ).toBe(false)
  })

  it('treats a finished Audit crawl as complete even with zero index_diagnosis_runs', () => {
    expect(
      isFirstCrawlComplete({
        indexDiagnosisRunCount: 0,
        findingsTerminalRunCount: 1,
      }),
    ).toBe(true)
  })

  it('treats Index Diagnosis as complete too', () => {
    expect(
      isFirstCrawlComplete({
        indexDiagnosisRunCount: 1,
        findingsTerminalRunCount: 0,
      }),
    ).toBe(true)
  })
})

describe('isTerminalFindingsRunStatus', () => {
  it('accepts complete and partial, not running', () => {
    expect(isTerminalFindingsRunStatus('complete')).toBe(true)
    expect(isTerminalFindingsRunStatus('partial')).toBe(true)
    expect(isTerminalFindingsRunStatus('running')).toBe(false)
    expect(isTerminalFindingsRunStatus('queued')).toBe(false)
  })
})
