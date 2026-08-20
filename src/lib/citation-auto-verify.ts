/**
 * Auto-verify dated grant / policy figures against the cited official page.
 *
 * When Quality Gate flags a grant-figure or dated-policy warning that already
 * has an authoritative citation URL, we re-fetch that page and check whether
 * the cited figure still appears. Matching → mark auto-verified (no manual
 * review). Fetch/figure failures keep the flag with a specific reason.
 */

const FETCH_TIMEOUT_MS = 8000

export type CitationVerifyStatus =
  | 'auto-verified'
  | 'figure-missing'
  | 'unreachable'
  | 'no-citation'

export interface CitationVerifyResult {
  status: CitationVerifyStatus
  detail: string
  verifiedAsOf?: string // YYYY-MM-DD
  url?: string
}

/** Normalise a money/percent figure for loose matching in page text. */
export function normalizeFigureForMatch(figure: string): string[] {
  const raw = figure.replace(/\s+/g, ' ').trim()
  const variants = new Set<string>()
  variants.add(raw.toLowerCase())

  // "up to £350" → also try "£350", "350"
  const money = raw.match(/[£$€]\s?([\d,]+(?:\.\d+)?)/)
  if (money) {
    const amount = money[1].replace(/,/g, '')
    const symbol = money[0].replace(/[\d,.\s]/g, '')[0] || '£'
    variants.add(`${symbol}${amount}`.toLowerCase())
    variants.add(`${symbol} ${amount}`.toLowerCase())
    variants.add(amount)
  }

  const pct = raw.match(/(\d+(?:\.\d+)?)\s?%/)
  if (pct) {
    variants.add(`${pct[1]}%`)
    variants.add(`${pct[1]} %`)
  }

  return Array.from(variants).filter(Boolean)
}

export function pageTextContainsFigure(pageText: string, figure: string): boolean {
  const haystack = pageText.toLowerCase().replace(/\s+/g, ' ')
  for (const variant of normalizeFigureForMatch(figure)) {
    if (variant.length >= 2 && haystack.includes(variant.toLowerCase())) {
      return true
    }
  }
  return false
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&pound;/gi, '£')
    .replace(/&#163;/g, '£')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
}

function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Fetch an official citation URL and confirm the figure still appears.
 * Never throws — always returns a status the gate can surface.
 */
export async function verifyFigureAgainstCitation(
  figure: string,
  citationUrl: string | undefined | null,
  opts: {
    now?: Date
    fetchImpl?: typeof fetch
    /** Host label for user-facing messages, e.g. "GOV.UK" */
    sourceLabel?: string
  } = {},
): Promise<CitationVerifyResult> {
  const sourceLabel = opts.sourceLabel || 'the cited official page'
  if (!citationUrl || !/^https?:\/\//i.test(citationUrl)) {
    return {
      status: 'no-citation',
      detail: 'no citation present to check',
    }
  }

  const fetchFn = opts.fetchImpl || fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetchFn(citationUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'SEORANKO-citation-verify/1.0',
      },
    })
    if (!res.ok) {
      return {
        status: 'unreachable',
        detail: `couldn't reach ${sourceLabel} right now (HTTP ${res.status})`,
        url: citationUrl,
      }
    }
    const html = await res.text()
    const text = stripHtmlToText(html)
    if (pageTextContainsFigure(text, figure)) {
      const verifiedAsOf = todayIsoDate(opts.now)
      return {
        status: 'auto-verified',
        detail: `auto-verified as of ${verifiedAsOf} — "${figure}" still appears on ${sourceLabel}`,
        verifiedAsOf,
        url: citationUrl,
      }
    }
    return {
      status: 'figure-missing',
      detail: `page no longer shows this figure ("${figure}")`,
      url: citationUrl,
    }
  } catch (err) {
    const timedOut = controller.signal.aborted
    const message = err instanceof Error ? err.message : String(err)
    return {
      status: 'unreachable',
      detail: timedOut
        ? `couldn't reach ${sourceLabel} right now (timed out)`
        : `couldn't reach ${sourceLabel} right now (${message})`,
      url: citationUrl,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Prefer gov.uk / legislation / ofgem hosts for the source label. */
export function sourceLabelForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'gov.uk' || host.endsWith('.gov.uk')) return 'GOV.UK'
    if (host.includes('legislation.gov.uk')) return 'legislation.gov.uk'
    if (host.includes('ofgem')) return 'Ofgem'
    return host
  } catch {
    return 'the cited official page'
  }
}
