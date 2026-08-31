/**
 * Core Web Vitals — Google thresholds + PSI field/lab parsing (no live API required).
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  rateLcpMs,
  rateInpMs,
  rateCls,
  clsFromFieldPercentile,
  parsePagespeedCoreWebVitals,
  mergeFieldAndLabMetrics,
  fetchCoreWebVitals,
  CWV_THRESHOLDS,
} from './core-web-vitals'
import { buildExplainableScore } from './quality-score-dimensions'

describe('Google CWV thresholds', () => {
  it('uses published LCP / INP / CLS boundaries', () => {
    expect(CWV_THRESHOLDS.lcp.goodMs).toBe(2500)
    expect(CWV_THRESHOLDS.lcp.poorMs).toBe(4000)
    expect(CWV_THRESHOLDS.inp.goodMs).toBe(200)
    expect(CWV_THRESHOLDS.inp.poorMs).toBe(500)
    expect(CWV_THRESHOLDS.cls.good).toBe(0.1)
    expect(CWV_THRESHOLDS.cls.poor).toBe(0.25)

    expect(rateLcpMs(2500)).toBe('good')
    expect(rateLcpMs(2501)).toBe('needs_improvement')
    expect(rateLcpMs(4001)).toBe('poor')

    expect(rateInpMs(200)).toBe('good')
    expect(rateInpMs(201)).toBe('needs_improvement')
    expect(rateInpMs(501)).toBe('poor')

    expect(rateCls(0.1)).toBe('good')
    expect(rateCls(0.11)).toBe('needs_improvement')
    expect(rateCls(0.26)).toBe('poor')
  })

  it('converts CrUX CLS percentile (×100) to unitless score', () => {
    expect(clsFromFieldPercentile(8)).toBeCloseTo(0.08)
    expect(clsFromFieldPercentile(10)).toBeCloseTo(0.1)
  })
})

const fieldPsiFixture = {
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, category: 'FAST' },
      INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: 'FAST' },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 8, category: 'FAST' },
    },
  },
  lighthouseResult: {
    audits: {
      'largest-contentful-paint': { numericValue: 3200, displayValue: '3.2 s' },
      'cumulative-layout-shift': { numericValue: 0.18, displayValue: '0.18' },
    },
  },
}

const labOnlyPsiFixture = {
  lighthouseResult: {
    audits: {
      'largest-contentful-paint': { numericValue: 4500, displayValue: '4.5 s' },
      'cumulative-layout-shift': { numericValue: 0.3, displayValue: '0.3' },
      'interaction-to-next-paint': { numericValue: 320, displayValue: '320 ms' },
    },
  },
}

describe('PSI parse — field preferred over lab', () => {
  it('reads CrUX field LCP/INP/CLS and scores against Google thresholds', () => {
    const result = parsePagespeedCoreWebVitals(fieldPsiFixture)
    expect(result.dataMode).toBe('field')
    expect(result.labFallbackUsed).toBe(false)
    const byId = Object.fromEntries(result.metrics.map((m) => [m.id, m]))
    expect(byId.lcp.source).toBe('field')
    expect(byId.lcp.rating).toBe('good')
    expect(byId.lcp.value).toBeCloseTo(2.1)
    expect(byId.inp.rating).toBe('good')
    expect(byId.cls.value).toBeCloseTo(0.08)
    expect(byId.cls.rating).toBe('good')
    // Good metrics → no FAIL/REVIEW CWV issues
    expect(result.issues.every((i) => i.severity === 'info' || i.id.startsWith('cwv-') === false || i.severity === 'info')).toBe(true)
    expect(result.issues.some((i) => i.severity === 'critical' || i.severity === 'warning')).toBe(false)
  })

  it('falls back to lab and labels insufficient field traffic', () => {
    const result = parsePagespeedCoreWebVitals(labOnlyPsiFixture)
    expect(result.dataMode).toBe('lab')
    expect(result.labFallbackUsed).toBe(true)
    expect(result.issues.some((i) => i.id === 'cwv-lab-fallback')).toBe(true)
    expect(result.issues.find((i) => i.id === 'cwv-lab-fallback')!.description).toMatch(
      /lab data only — insufficient real-user traffic for field data/i,
    )
    expect(result.metrics.find((m) => m.id === 'lcp')!.rating).toBe('poor')
    expect(result.issues.some((i) => i.id.includes('lcp') && i.severity === 'critical')).toBe(true)
    expect(result.metrics.find((m) => m.id === 'inp')!.rating).toBe('needs_improvement')
  })

  it('fills missing field metrics from lab while keeping present field values', () => {
    const field = {
      lcp: {
        id: 'lcp' as const,
        label: 'LCP',
        value: 2.0,
        unit: 's' as const,
        rating: 'good' as const,
        source: 'field' as const,
        displayValue: '2.00 s',
      },
    }
    const lab = {
      cls: {
        id: 'cls' as const,
        label: 'CLS',
        value: 0.2,
        unit: '' as const,
        rating: 'needs_improvement' as const,
        source: 'lab' as const,
        displayValue: '0.200',
      },
    }
    const merged = mergeFieldAndLabMetrics(field, lab)
    expect(merged.dataMode).toBe('field')
    expect(merged.labFallbackUsed).toBe(true)
    expect(merged.metrics.map((m) => m.id)).toEqual(['lcp', 'cls'])
  })
})

describe('Core Web Vitals as 8th explainable dimension', () => {
  it('maps CWV issues into Core Web Vitals without changing other dimensions', () => {
    const cwv = parsePagespeedCoreWebVitals(labOnlyPsiFixture)
    const board = buildExplainableScore([
      { id: 'schema-x', category: 'schema', severity: 'critical', title: 'Schema missing' },
      ...cwv.issues.map((i) => ({
        id: i.id,
        category: i.category,
        severity: i.severity,
        title: i.title,
        affectsDimensions: i.affectsDimensions,
      })),
    ])
    expect(board.dimensions).toHaveLength(8)
    expect(board.dimensions.find((d) => d.id === 'structured_data')!.status).toBe('FAIL')
    expect(board.dimensions.find((d) => d.id === 'core_web_vitals')!.status).toBe('FAIL')
    expect(board.dimensions.find((d) => d.id === 'core_web_vitals')!.label).toBe('Core Web Vitals')
    expect(board.dimensions.find((d) => d.id === 'technical_seo')!.status).toBe('PASS')
  })
})

describe('fetchCoreWebVitals network wrapper', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('persists a graceful advisory when PSI returns non-2xx', async () => {
    global.fetch = vi.fn(async () => new Response('quota', { status: 429 })) as typeof fetch
    const result = await fetchCoreWebVitals('https://example.com')
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.id).toBe('cwv-psi-unavailable')
    expect(result.issues[0]?.description).toMatch(/429/)
    expect(result.issues[0]?.affectsDimensions).toEqual(['core_web_vitals'])
  })

  it('calls the official PSI endpoint with strategy=mobile', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('pagespeedonline/v5/runPagespeed')
      expect(url).toContain('strategy=mobile')
      expect(url).toContain(encodeURIComponent('https://autodun.com'))
      return new Response(JSON.stringify(fieldPsiFixture), { status: 200 })
    })
    global.fetch = fetchMock as typeof fetch
    const result = await fetchCoreWebVitals('https://autodun.com')
    expect(result.ok).toBe(true)
    expect(result.metrics).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
