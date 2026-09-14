import { FETCH_EVIDENCE_CONFIG } from './config'
import type { FetchDeps, FetchOutcome, HttpStatusClass } from './types'

export function classifyHttpStatus(status: number): HttpStatusClass {
  if (status === 404) return '404'
  if (status === 410) return '410'
  if (status === 429) return '429'
  if (status === 503) return '503'
  if (status >= 400 && status < 500) return '4xx-other'
  if (status >= 500 && status < 600) return '5xx-other'
  if (status >= 300 && status < 400) return '3xx'
  if (status >= 200 && status < 300) return '2xx'
  return 'other'
}

function classifyNetworkError(
  err: unknown,
): Exclude<FetchOutcome['kind'], 'http'> {
  const message = err instanceof Error ? err.message : String(err)
  const name = err instanceof Error ? err.name : ''
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: string }).code ?? '')
      : ''
  const hay = `${name} ${message} ${code}`.toLowerCase()

  if (
    hay.includes('aborterror') ||
    hay.includes('abort') ||
    hay.includes('timeout') ||
    hay.includes('timed out')
  ) {
    return 'timeout'
  }
  if (
    hay.includes('enotfound') ||
    hay.includes('getaddrinfo') ||
    hay.includes('err_name_not_resolved') ||
    hay.includes('dns')
  ) {
    return 'dns-failure'
  }
  if (
    hay.includes('econnreset') ||
    hay.includes('connection reset') ||
    hay.includes('socket hang up')
  ) {
    return 'connection-reset'
  }
  return 'network-error'
}

/**
 * Fetch a URL without following redirects. Returns status + headers + body,
 * or a classified network failure.
 */
export async function fetchUrl(
  url: string,
  deps: FetchDeps,
  options?: { bypassCache?: boolean },
): Promise<FetchOutcome> {
  const config = { ...FETCH_EVIDENCE_CONFIG, ...deps.config }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  const headers = new Headers()
  if (options?.bypassCache) {
    headers.set('Cache-Control', 'no-cache')
    headers.set('Pragma', 'no-cache')
  }

  try {
    const response = await deps.fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers,
      cache: options?.bypassCache ? 'no-store' : undefined,
    })
    const body = await response.text()
    return {
      kind: 'http',
      status: response.status,
      statusClass: classifyHttpStatus(response.status),
      headers: response.headers,
      body,
      url,
    }
  } catch (err) {
    return {
      kind: classifyNetworkError(err),
      error: err instanceof Error ? err.message : String(err),
      url,
    }
  } finally {
    clearTimeout(timer)
  }
}
