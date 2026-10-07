/**
 * Secondary/probe fetches (www peers, redirects, images, robots, sitemaps)
 * must never throw out of a crawl tick. Classify transport failures and
 * optionally return a synthetic Response so hop-recording callers continue.
 *
 * Crawl-pipeline secondary fetch sites (harden here or at the call site):
 * - duplicate-url/detect.ts fetchManual — www/http/slash/query peers
 * - shared/hop-recording-fetch.ts recordRedirectHops — redirect/canonical walks
 * - findings-ui/crawl/run-detectors.ts makeGapFetchDeps — all detector deps
 * - shared/image-intrinsic-size.ts fetchImageHeaderBytes — topic 49
 * - findings-ui/crawl/safe-crawl-fetch.ts — robots/discovery
 * - findings-ui/crawl/discover.ts — sitemap/homepage seeds
 * - shared/robots-txt-inspect.ts fetchAndInspectRobotsTxt
 * - shared/sitemap-inspect.ts fetchSitemapDocument
 * - fetch/fetch-url.ts — already classifies network errors (no throw)
 */

export type TransportErrorClass =
  | 'tls'
  | 'dns'
  | 'timeout'
  | 'connection'
  | 'network'

export type TransportFailure = {
  errorClass: TransportErrorClass
  message: string
}

/** Non-standard status used only inside SEORANKO probe deps — never a real origin. */
export const TRANSPORT_FAILURE_STATUS = 599

export function classifyTransportError(err: unknown): TransportFailure {
  const message = err instanceof Error ? err.message : String(err)
  const cause =
    err instanceof Error && err.cause && typeof err.cause === 'object'
      ? (err.cause as { code?: string; message?: string })
      : null
  const code = String(cause?.code ?? '')
  const blob = `${code} ${message} ${cause?.message ?? ''}`.toLowerCase()

  if (
    blob.includes('cert') ||
    blob.includes('altname') ||
    blob.includes('ssl') ||
    blob.includes('tls') ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ) {
    return { errorClass: 'tls', message }
  }
  if (
    blob.includes('enotfound') ||
    blob.includes('getaddrinfo') ||
    blob.includes('dns') ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN'
  ) {
    return { errorClass: 'dns', message }
  }
  if (
    blob.includes('abort') ||
    blob.includes('timeout') ||
    code === 'ABORT_ERR' ||
    code === 'ETIMEDOUT'
  ) {
    return { errorClass: 'timeout', message }
  }
  if (
    blob.includes('econnreset') ||
    blob.includes('econnrefused') ||
    blob.includes('epipe') ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED'
  ) {
    return { errorClass: 'connection', message }
  }
  return { errorClass: 'network', message }
}

/**
 * Wrap a fetch impl so network/DNS/TLS failures become a 599 Response with
 * diagnostic headers instead of a thrown TypeError.
 */
export function neverThrowFetch(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    try {
      return await base(input, init)
    } catch (err) {
      const { errorClass, message } = classifyTransportError(err)
      return new Response(null, {
        status: TRANSPORT_FAILURE_STATUS,
        statusText: `${errorClass}: ${message}`.slice(0, 200),
        headers: {
          'x-seoranko-transport-error': errorClass,
          'x-seoranko-transport-message': message.slice(0, 500),
        },
      })
    }
  }
}

export function transportFailureFromResponse(
  res: Response,
): TransportFailure | null {
  if (res.status !== TRANSPORT_FAILURE_STATUS) return null
  const errorClass = (res.headers.get('x-seoranko-transport-error') ??
    'network') as TransportErrorClass
  const message =
    res.headers.get('x-seoranko-transport-message') ?? res.statusText
  return { errorClass, message }
}
