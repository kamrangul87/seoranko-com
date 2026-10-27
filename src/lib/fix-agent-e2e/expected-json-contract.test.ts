import { describe, expect, it } from 'vitest'
import expectedJson from '../../../fixtures/seoranko-fixture-site/expected.json'

describe('fixture expected.json contract', () => {
  it('does not include internal/suppressed rows', () => {
    const findings = (expectedJson as { findings: Array<{ verdict: string; bucket?: string }> })
      .findings
    const bad = findings.filter(
      (f) =>
        f.bucket === 'internal' ||
        f.verdict === 'ok' ||
        f.verdict.startsWith('suppress-') ||
        f.verdict.startsWith('skip-'),
    )
    expect(bad).toEqual([])
  })
})

