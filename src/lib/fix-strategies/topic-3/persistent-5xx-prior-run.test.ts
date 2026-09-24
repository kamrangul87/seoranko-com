import { describe, expect, it } from 'vitest'
import { detect5xxResponses } from './detect'
import { FIX_STRATEGY_PRODUCT_DECISIONS as PD } from '@/lib/fix-strategies/product-decisions'

const ORIGIN = 'https://example.com'
const windowMs = PD.persistent5xxObservationWindowMs

describe('topic 3 persistent-5xx — reachable from a prior crawl run, not only synthetic attempts', () => {
  it('reports persistent-5xx when a prior run also observed a 5xx here, ≥ window apart', () => {
    const now = 10_000_000
    const result = detect5xxResponses({
      pageUrl: `${ORIGIN}/down`,
      attempts: [
        { status: 503, kind: 'http', observedAtMs: now },
        { status: 503, kind: 'http', observedAtMs: now + 1_000 }, // same-tick re-fetch pair
      ],
      priorObservation: { status: 500, observedAtMs: now - windowMs },
    })
    expect(result.findings.some((f) => f.classification === 'stableAcrossRefetch')).toBe(true)
    const persistent = result.findings.find((f) => f.classification === 'persistent-5xx')
    expect(persistent).toBeDefined()
    expect(persistent!.detail).toMatch(/prior crawl run/)
  })

  it('does not report persistent-5xx when the prior observation is inside the window', () => {
    const now = 10_000_000
    const result = detect5xxResponses({
      pageUrl: `${ORIGIN}/down`,
      attempts: [
        { status: 503, kind: 'http', observedAtMs: now },
        { status: 503, kind: 'http', observedAtMs: now + 1_000 },
      ],
      priorObservation: { status: 500, observedAtMs: now - windowMs / 2 },
    })
    expect(result.findings.some((f) => f.classification === 'persistent-5xx')).toBe(false)
  })

  it('does not report persistent-5xx when the prior observation was not a 5xx', () => {
    const now = 10_000_000
    const result = detect5xxResponses({
      pageUrl: `${ORIGIN}/down`,
      attempts: [
        { status: 503, kind: 'http', observedAtMs: now },
        { status: 503, kind: 'http', observedAtMs: now + 1_000 },
      ],
      priorObservation: { status: 200, observedAtMs: now - windowMs },
    })
    expect(result.findings.some((f) => f.classification === 'persistent-5xx')).toBe(false)
  })

  it('does not report persistent-5xx with no prior observation and a same-tick re-fetch pair alone', () => {
    const now = 10_000_000
    const result = detect5xxResponses({
      pageUrl: `${ORIGIN}/down`,
      attempts: [
        { status: 503, kind: 'http', observedAtMs: now },
        { status: 503, kind: 'http', observedAtMs: now + 1_000 },
      ],
    })
    expect(result.findings.some((f) => f.classification === 'stableAcrossRefetch')).toBe(true)
    expect(result.findings.some((f) => f.classification === 'persistent-5xx')).toBe(false)
  })
})
