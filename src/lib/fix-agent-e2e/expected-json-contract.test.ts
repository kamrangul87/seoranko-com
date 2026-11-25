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

  it('homepage 1/42/74 keep crawl_compare surfaces (Sentry 25 Nov 2026)', () => {
    const findings = (
      expectedJson as {
        findings: Array<{
          topicId: string
          verdict: string
          pageUrl: string | null
          surfaceClass: string
          autoFixable: boolean
        }>
      }
    ).findings
    const home = `${(expectedJson as { origin: string }).origin}/`
    const topic1 = findings.find(
      (f) => f.topicId === '1' && f.verdict === 'human-review' && f.pageUrl === home,
    )
    const topic42 = findings.find(
      (f) => f.topicId === '42' && f.verdict === 'auto-rewrite' && f.pageUrl === home,
    )
    const topic74 = findings.find(
      (f) =>
        f.topicId === '74' &&
        f.verdict === 'auto-unwrap-origin-prefix' &&
        f.pageUrl === home,
    )
    expect(topic1).toMatchObject({ surfaceClass: 'report-only', autoFixable: false })
    expect(topic42).toMatchObject({ surfaceClass: 'auto-fixable', autoFixable: true })
    expect(topic74).toMatchObject({ surfaceClass: 'auto-fixable', autoFixable: true })
  })
})

