/**
 * Google Search Console Search Analytics client.
 * Paginates past the first 1000 rows. No paid SERP APIs.
 */

export type GscSiteEntry = {
  siteUrl: string
  permissionLevel: string
}

export type GscSearchAnalyticsRow = {
  page: string
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export class GscApiError extends Error {
  status: number
  retryable: boolean

  constructor(message: string, status: number, retryable = false) {
    super(message)
    this.name = 'GscApiError'
    this.status = status
    this.retryable = retryable
  }
}

async function gscFetch(url: string, accessToken: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: init?.signal || AbortSignal.timeout(60000),
  })
  return res
}

function classifyGscHttpError(status: number, body: unknown): GscApiError {
  const msg =
    typeof body === 'object' &&
    body &&
    'error' in body &&
    typeof (body as { error?: { message?: string } }).error?.message === 'string'
      ? (body as { error: { message: string } }).error.message
      : `Search Console API error (${status})`

  if (status === 403) {
    return new GscApiError(
      'You are not a verified owner of this Search Console property, or access was revoked. ' +
        'Ask a verified owner to add you, or pick a different property.',
      403,
      false,
    )
  }
  if (status === 401) {
    return new GscApiError('Search Console authorization expired. Reconnect Google Search Console.', 401, false)
  }
  if (status === 429 || status === 500 || status === 503) {
    return new GscApiError(msg, status, true)
  }
  return new GscApiError(msg, status, false)
}

export async function listGscSites(accessToken: string): Promise<GscSiteEntry[]> {
  const res = await gscFetch('https://www.googleapis.com/webmasters/v3/sites', accessToken)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw classifyGscHttpError(res.status, data)
  const entries = Array.isArray(data.siteEntry) ? data.siteEntry : []
  return entries
    .map((e: { siteUrl?: string; permissionLevel?: string }) => ({
      siteUrl: String(e.siteUrl || ''),
      permissionLevel: String(e.permissionLevel || ''),
    }))
    .filter((e: GscSiteEntry) => !!e.siteUrl)
}

const ROW_LIMIT = 25000

export async function fetchSearchAnalyticsPageDate(
  accessToken: string,
  propertyUrl: string,
  startDate: string,
  endDate: string,
  opts?: { onPage?: (rows: GscSearchAnalyticsRow[], startRow: number) => void },
): Promise<GscSearchAnalyticsRow[]> {
  if (!propertyUrl) throw new Error('propertyUrl is required')
  if (!startDate || !endDate) throw new Error('startDate and endDate are required')

  const encoded = encodeURIComponent(propertyUrl)
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`
  const all: GscSearchAnalyticsRow[] = []
  let startRow = 0

  for (;;) {
    let attempt = 0
    let pageRows: GscSearchAnalyticsRow[] = []
    for (;;) {
      attempt += 1
      const res = await gscFetch(endpoint, accessToken, {
        method: 'POST',
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ['page', 'date'],
          rowLimit: ROW_LIMIT,
          startRow,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const err = classifyGscHttpError(res.status, data)
        if (err.retryable && attempt < 5) {
          const delayMs = Math.min(30_000, 1000 * 2 ** (attempt - 1))
          await new Promise((r) => setTimeout(r, delayMs))
          continue
        }
        throw err
      }
      const rows = Array.isArray(data.rows) ? data.rows : []
      pageRows = rows.map((r: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }) => {
        const keys = Array.isArray(r.keys) ? r.keys : []
        return {
          page: String(keys[0] || ''),
          date: String(keys[1] || ''),
          clicks: Number(r.clicks || 0),
          impressions: Number(r.impressions || 0),
          ctr: Number(r.ctr || 0),
          position: Number(r.position || 0),
        }
      })
      break
    }

    opts?.onPage?.(pageRows, startRow)
    all.push(...pageRows)
    if (pageRows.length < ROW_LIMIT) break
    startRow += ROW_LIMIT
  }

  return all
}

/** GSC lags ~2–3 days. Dates strictly after this cutoff are provisional. */
export function gscFinalityCutoffDate(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - 3)
  return d.toISOString().slice(0, 10)
}

export function isGscDateFinal(dateYmd: string, now = new Date()): boolean {
  return dateYmd <= gscFinalityCutoffDate(now)
}

/** Latest calendar day we request from GSC (yesterday — today is incomplete). */
export function gscAvailableEndDate(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Inclusive YYYY-MM-DD range spanning ~16 months of GSC retention. */
export function gscBackfillDateRange(now = new Date()): { startDate: string; endDate: string } {
  const endDate = gscAvailableEndDate(now)
  const end = new Date(`${endDate}T00:00:00.000Z`)
  const start = new Date(end)
  start.setUTCMonth(start.getUTCMonth() - 16)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate,
  }
}
