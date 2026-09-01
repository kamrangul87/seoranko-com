/**
 * Core Web Vitals via Google PageSpeed Insights API (CrUX field + Lighthouse lab).
 *
 * Thresholds are Google's published boundaries — do not invent custom ones:
 * - LCP: ≤2.5s good, ≤4s needs improvement, >4s poor
 * - INP: ≤200ms good, ≤500ms needs improvement, >500ms poor
 * - CLS: ≤0.1 good, ≤0.25 needs improvement, >0.25 poor
 *
 * Prefer URL (then origin) field data; fall back to lab and label clearly.
 */

import type { QualityDimensionId } from './quality-score-dimensions'

export type CwVMetricId = 'lcp' | 'inp' | 'cls'
export type CwVRating = 'good' | 'needs_improvement' | 'poor'
export type CwVDataSource = 'field' | 'lab'

export interface CwVMetricReading {
  id: CwVMetricId
  label: string
  /** Canonical display units: LCP seconds, INP ms, CLS unitless. */
  value: number
  unit: 's' | 'ms' | ''
  rating: CwVRating
  source: CwVDataSource
  /** Raw PSI / Lighthouse display string when available. */
  displayValue: string
}

export interface CwVAuditIssue {
  id: string
  severity: 'critical' | 'warning' | 'info'
  category: 'core-web-vitals'
  title: string
  description: string
  remediation: string
  affectsDimensions: QualityDimensionId[]
  blocking?: boolean
}

export interface CoreWebVitalsResult {
  ok: boolean
  /** field = CrUX present for at least one metric; lab = lab-only fallback; none = no metrics. */
  dataMode: 'field' | 'lab' | 'none'
  metrics: CwVMetricReading[]
  issues: CwVAuditIssue[]
  error?: string
  /** True when field data was missing and lab readings were used. */
  labFallbackUsed: boolean
}

/** Google CWV thresholds (good / needs-improvement upper bounds). */
export const CWV_THRESHOLDS = {
  lcp: { goodMs: 2500, poorMs: 4000 },
  inp: { goodMs: 200, poorMs: 500 },
  cls: { good: 0.1, poor: 0.25 },
} as const

const LAB_ONLY_NOTE =
  'lab data only — insufficient real-user traffic for field data'

export function rateLcpMs(ms: number): CwVRating {
  if (ms <= CWV_THRESHOLDS.lcp.goodMs) return 'good'
  if (ms <= CWV_THRESHOLDS.lcp.poorMs) return 'needs_improvement'
  return 'poor'
}

export function rateInpMs(ms: number): CwVRating {
  if (ms <= CWV_THRESHOLDS.inp.goodMs) return 'good'
  if (ms <= CWV_THRESHOLDS.inp.poorMs) return 'needs_improvement'
  return 'poor'
}

export function rateCls(score: number): CwVRating {
  if (score <= CWV_THRESHOLDS.cls.good) return 'good'
  if (score <= CWV_THRESHOLDS.cls.poor) return 'needs_improvement'
  return 'poor'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function fieldPercentile(metrics: unknown, key: string): number | null {
  if (!isRecord(metrics)) return null
  const entry = metrics[key]
  if (!isRecord(entry)) return null
  const p = entry.percentile
  return typeof p === 'number' && Number.isFinite(p) ? p : null
}

/**
 * CrUX reports CLS as score × 100 (e.g. 8 → 0.08). Convert to unitless CLS.
 */
export function clsFromFieldPercentile(percentile: number): number {
  return percentile / 100
}

function labNumeric(audits: unknown, id: string): number | null {
  if (!isRecord(audits)) return null
  const audit = audits[id]
  if (!isRecord(audit)) return null
  const n = audit.numericValue
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function labDisplay(audits: unknown, id: string): string | null {
  if (!isRecord(audits)) return null
  const audit = audits[id]
  if (!isRecord(audit)) return null
  return typeof audit.displayValue === 'string' ? audit.displayValue : null
}

function formatLcp(seconds: number): string {
  return `${seconds.toFixed(2)} s`
}

function formatInp(ms: number): string {
  return `${Math.round(ms)} ms`
}

function formatCls(score: number): string {
  return score.toFixed(3)
}

function ratingSeverity(rating: CwVRating): 'critical' | 'warning' | null {
  if (rating === 'poor') return 'critical'
  if (rating === 'needs_improvement') return 'warning'
  return null
}

function remediationFor(id: CwVMetricId): string {
  switch (id) {
    case 'lcp':
      return 'Improve Largest Contentful Paint: preload the LCP image/font, reduce server TTFB, defer non-critical JS/CSS, and avoid late-loading hero media. Target ≤2.5s (good) per Google’s CWV thresholds.'
    case 'inp':
      return 'Improve Interaction to Next Paint: break up long tasks, reduce main-thread JS, defer non-essential scripts, and keep event handlers lean. Target ≤200ms (good) per Google’s CWV thresholds.'
    case 'cls':
      return 'Improve Cumulative Layout Shift: set width/height (or aspect-ratio) on images and embeds, reserve space for ads/embeds, and avoid inserting content above existing content. Target ≤0.1 (good) per Google’s CWV thresholds.'
  }
}

function issueFromMetric(m: CwVMetricReading, labFallbackUsed: boolean): CwVAuditIssue | null {
  const severity = ratingSeverity(m.rating)
  if (!severity) return null
  const sourceBit =
    m.source === 'lab' || labFallbackUsed
      ? ` (${LAB_ONLY_NOTE})`
      : ' (Chrome UX Report field data)'
  const thresholdHint =
    m.id === 'lcp'
      ? 'Google: ≤2.5s good, >4s poor'
      : m.id === 'inp'
        ? 'Google: ≤200ms good, >500ms poor'
        : 'Google: ≤0.1 good, >0.25 poor'
  return {
    id: `cwv-${m.id}-${m.rating}`,
    severity,
    category: 'core-web-vitals',
    title: `${m.label} is ${m.rating === 'poor' ? 'poor' : 'needs improvement'} (${m.displayValue})`,
    description: `${m.label} measured ${m.displayValue}${sourceBit}. ${thresholdHint}.`,
    remediation: remediationFor(m.id),
    affectsDimensions: ['core_web_vitals'],
    blocking: severity === 'critical',
  }
}

function extractFieldMetrics(loadingExperience: unknown): Partial<Record<CwVMetricId, CwVMetricReading>> {
  if (!isRecord(loadingExperience)) return {}
  const metrics = loadingExperience.metrics
  const out: Partial<Record<CwVMetricId, CwVMetricReading>> = {}

  const lcpMs = fieldPercentile(metrics, 'LARGEST_CONTENTFUL_PAINT_MS')
  if (lcpMs != null) {
    const seconds = lcpMs / 1000
    out.lcp = {
      id: 'lcp',
      label: 'LCP',
      value: seconds,
      unit: 's',
      rating: rateLcpMs(lcpMs),
      source: 'field',
      displayValue: formatLcp(seconds),
    }
  }

  const inpMs = fieldPercentile(metrics, 'INTERACTION_TO_NEXT_PAINT')
  if (inpMs != null) {
    out.inp = {
      id: 'inp',
      label: 'INP',
      value: inpMs,
      unit: 'ms',
      rating: rateInpMs(inpMs),
      source: 'field',
      displayValue: formatInp(inpMs),
    }
  }

  const clsRaw = fieldPercentile(metrics, 'CUMULATIVE_LAYOUT_SHIFT_SCORE')
  if (clsRaw != null) {
    const cls = clsFromFieldPercentile(clsRaw)
    out.cls = {
      id: 'cls',
      label: 'CLS',
      value: cls,
      unit: '',
      rating: rateCls(cls),
      source: 'field',
      displayValue: formatCls(cls),
    }
  }

  return out
}

function extractLabMetrics(lighthouseResult: unknown): Partial<Record<CwVMetricId, CwVMetricReading>> {
  if (!isRecord(lighthouseResult)) return {}
  const audits = lighthouseResult.audits
  const out: Partial<Record<CwVMetricId, CwVMetricReading>> = {}

  const lcpMs = labNumeric(audits, 'largest-contentful-paint')
  if (lcpMs != null) {
    const seconds = lcpMs / 1000
    out.lcp = {
      id: 'lcp',
      label: 'LCP',
      value: seconds,
      unit: 's',
      rating: rateLcpMs(lcpMs),
      source: 'lab',
      displayValue: labDisplay(audits, 'largest-contentful-paint') || formatLcp(seconds),
    }
  }

  // Lab INP may be absent (needs real interactions); use when Lighthouse provides it.
  const inpMs =
    labNumeric(audits, 'interaction-to-next-paint') ??
    labNumeric(audits, 'experimental-interaction-to-next-paint')
  if (inpMs != null) {
    out.inp = {
      id: 'inp',
      label: 'INP',
      value: inpMs,
      unit: 'ms',
      rating: rateInpMs(inpMs),
      source: 'lab',
      displayValue:
        labDisplay(audits, 'interaction-to-next-paint') ||
        labDisplay(audits, 'experimental-interaction-to-next-paint') ||
        formatInp(inpMs),
    }
  }

  const cls = labNumeric(audits, 'cumulative-layout-shift')
  if (cls != null) {
    out.cls = {
      id: 'cls',
      label: 'CLS',
      value: cls,
      unit: '',
      rating: rateCls(cls),
      source: 'lab',
      displayValue: labDisplay(audits, 'cumulative-layout-shift') || formatCls(cls),
    }
  }

  return out
}

/**
 * Merge field (preferred) with lab fallback per metric.
 */
export function mergeFieldAndLabMetrics(
  field: Partial<Record<CwVMetricId, CwVMetricReading>>,
  lab: Partial<Record<CwVMetricId, CwVMetricReading>>,
): { metrics: CwVMetricReading[]; labFallbackUsed: boolean; dataMode: 'field' | 'lab' | 'none' } {
  const ids: CwVMetricId[] = ['lcp', 'inp', 'cls']
  const metrics: CwVMetricReading[] = []
  let anyField = false
  let anyLabFallback = false

  for (const id of ids) {
    if (field[id]) {
      metrics.push(field[id]!)
      anyField = true
    } else if (lab[id]) {
      metrics.push(lab[id]!)
      anyLabFallback = true
    }
  }

  if (metrics.length === 0) return { metrics, labFallbackUsed: false, dataMode: 'none' }
  if (anyField) return { metrics, labFallbackUsed: anyLabFallback, dataMode: 'field' }
  return { metrics, labFallbackUsed: true, dataMode: 'lab' }
}

export function buildCoreWebVitalsIssues(
  metrics: CwVMetricReading[],
  opts: { labFallbackUsed: boolean; dataMode: 'field' | 'lab' | 'none'; error?: string },
): CwVAuditIssue[] {
  const issues: CwVAuditIssue[] = []

  if (opts.error) {
    issues.push({
      id: 'cwv-psi-unavailable',
      severity: 'info',
      category: 'core-web-vitals',
      title: 'Core Web Vitals could not be measured',
      description: opts.error,
      remediation:
        'Retry the audit later, or set PAGESPEED_API_KEY / GOOGLE_API_KEY for higher PageSpeed Insights quota. Do not invent CWV numbers.',
      affectsDimensions: ['core_web_vitals'],
    })
    return issues
  }

  if (opts.dataMode === 'none') {
    issues.push({
      id: 'cwv-no-data',
      severity: 'info',
      category: 'core-web-vitals',
      title: 'No Core Web Vitals data returned',
      description:
        'PageSpeed Insights returned neither Chrome UX Report field data nor usable lab metrics for LCP/INP/CLS.',
      remediation: 'Confirm the URL is publicly crawlable, then re-run the audit.',
      affectsDimensions: ['core_web_vitals'],
    })
    return issues
  }

  if (opts.dataMode === 'lab' || opts.labFallbackUsed) {
    issues.push({
      id: 'cwv-lab-fallback',
      severity: 'info',
      category: 'core-web-vitals',
      title: 'Using lab data for Core Web Vitals',
      description: `One or more CWV metrics used ${LAB_ONLY_NOTE}. Lab values are still scored against Google’s published thresholds.`,
      remediation:
        'Field (CrUX) data appears automatically once the URL/origin has enough real Chrome traffic. Until then, treat lab readings as directional.',
      affectsDimensions: ['core_web_vitals'],
    })
  }

  for (const m of metrics) {
    const issue = issueFromMetric(m, opts.labFallbackUsed || m.source === 'lab')
    if (issue) issues.push(issue)
  }

  // Lab often omits INP — surface that explicitly when LCP/CLS exist but INP does not.
  if (!metrics.some((m) => m.id === 'inp') && metrics.length > 0) {
    issues.push({
      id: 'cwv-inp-unavailable',
      severity: 'info',
      category: 'core-web-vitals',
      title: 'INP not available in this measurement',
      description:
        'Interaction to Next Paint needs real-user interactions. Field data was missing and lab data did not include INP for this URL.',
      remediation:
        'Re-check once CrUX field data is available for the URL/origin. Do not invent an INP number.',
      affectsDimensions: ['core_web_vitals'],
    })
  }

  return issues
}

/**
 * Pure parse of a PSI JSON body → metrics + issues (no network).
 */
export function parsePagespeedCoreWebVitals(data: unknown): CoreWebVitalsResult {
  if (!isRecord(data)) {
    return {
      ok: false,
      dataMode: 'none',
      metrics: [],
      issues: buildCoreWebVitalsIssues([], {
        labFallbackUsed: false,
        dataMode: 'none',
        error: 'PageSpeed Insights returned an empty response.',
      }),
      error: 'Empty PSI response',
      labFallbackUsed: false,
    }
  }

  const urlField = extractFieldMetrics(data.loadingExperience)
  const originField = extractFieldMetrics(data.originLoadingExperience)
  // Prefer URL-level CrUX; fill missing metrics from origin-level CrUX.
  const field: Partial<Record<CwVMetricId, CwVMetricReading>> = { ...originField, ...urlField }
  const lab = extractLabMetrics(data.lighthouseResult)
  const merged = mergeFieldAndLabMetrics(field, lab)
  const issues = buildCoreWebVitalsIssues(merged.metrics, {
    labFallbackUsed: merged.labFallbackUsed,
    dataMode: merged.dataMode,
  })

  return {
    ok: true,
    dataMode: merged.dataMode,
    metrics: merged.metrics,
    issues,
    labFallbackUsed: merged.labFallbackUsed,
  }
}

function psiApiKey(): string | undefined {
  return process.env.PAGESPEED_API_KEY || process.env.GOOGLE_API_KEY || undefined
}

/** PSI can take 20–90s for a full Lighthouse run — allow headroom above typical server defaults. */
export const PSI_FETCH_TIMEOUT_MS = 120_000

export type PsiFailureKind = 'quota' | 'timeout' | 'http' | 'network'

export function classifyPsiHttpError(status: number, body: string): { kind: PsiFailureKind; message: string } {
  const lower = body.toLowerCase()
  if (
    status === 429 ||
    /quota exceeded|rate limit|resource_exhausted|daily limit/i.test(lower)
  ) {
    return {
      kind: 'quota',
      message: 'PageSpeed Insights quota exceeded — try again later or add PAGESPEED_API_KEY for a dedicated quota.',
    }
  }
  return {
    kind: 'http',
    message: `PageSpeed Insights API error ${status}${body ? `: ${body.slice(0, 200)}` : ''}`,
  }
}

export function classifyPsiNetworkError(err: unknown): { kind: PsiFailureKind; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  if (/timeout|aborted|deadline/i.test(message)) {
    return {
      kind: 'timeout',
      message: `PageSpeed Insights request timed out after ${PSI_FETCH_TIMEOUT_MS / 1000}s — the API can be slow; retry or check quota.`,
    }
  }
  return {
    kind: 'network',
    message: `PageSpeed Insights request failed: ${message}`,
  }
}

/**
 * Fetch Core Web Vitals for a public URL via PageSpeed Insights API v5.
 */
export async function fetchCoreWebVitals(
  pageUrl: string,
  opts?: { fetchImpl?: typeof fetch; strategy?: 'mobile' | 'desktop'; timeoutMs?: number },
): Promise<CoreWebVitalsResult> {
  const fetchImpl = opts?.fetchImpl || fetch
  const strategy = opts?.strategy || 'mobile'
  const timeoutMs = opts?.timeoutMs ?? PSI_FETCH_TIMEOUT_MS
  const key = psiApiKey()
  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
  endpoint.searchParams.set('url', pageUrl)
  endpoint.searchParams.set('strategy', strategy)
  // Request performance category so lighthouse audits include LCP/CLS/INP when available.
  endpoint.searchParams.append('category', 'PERFORMANCE')
  if (key) endpoint.searchParams.set('key', key)

  try {
    const res = await fetchImpl(endpoint.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.warn('[core-web-vitals] PSI non-OK', {
        url: pageUrl,
        status: res.status,
        detail: detail.slice(0, 400),
        hasApiKey: Boolean(key),
      })
      const classified = classifyPsiHttpError(res.status, detail)
      return {
        ok: false,
        dataMode: 'none',
        metrics: [],
        issues: buildCoreWebVitalsIssues([], {
          labFallbackUsed: false,
          dataMode: 'none',
          error: classified.message,
        }),
        error: classified.message,
        labFallbackUsed: false,
      }
    }
    const data: unknown = await res.json()
    return parsePagespeedCoreWebVitals(data)
  } catch (err) {
    const classified = classifyPsiNetworkError(err)
    console.warn('[core-web-vitals] PSI fetch failed', {
      url: pageUrl,
      kind: classified.kind,
      message: classified.message,
      hasApiKey: Boolean(key),
    })
    return {
      ok: false,
      dataMode: 'none',
      metrics: [],
      issues: buildCoreWebVitalsIssues([], {
        labFallbackUsed: false,
        dataMode: 'none',
        error: classified.message,
      }),
      error: classified.message,
      labFallbackUsed: false,
    }
  }
}
