/**
 * Shared Sentry scrubbing — never ship GitHub App secrets or tokens in events.
 */

const SECRET_KEY_RE =
  /(private_key|privateKey|client_secret|clientSecret|webhook_secret|webhookSecret|access_token|accessToken|pem|SENTRY_TEST_SECRET|SITE_CONNECTION_ENCRYPTION_KEY|credentials_ciphertext)/i

const PEM_RE = /-----BEGIN [A-Z0-9 ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]+PRIVATE KEY-----/g
const TOKEN_RE = /\b(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g

function scrubString(value: string): string {
  return value.replace(PEM_RE, '[Filtered PEM]').replace(TOKEN_RE, '[Filtered Token]')
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return value
  if (typeof value === 'string') return scrubString(value)
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = '[Filtered]'
      } else {
        out[k] = scrubValue(v, depth + 1)
      }
    }
    return out
  }
  return value
}

/** Drop or redact sensitive fields before send. */
export function scrubSentryEvent<T extends { request?: unknown; extra?: unknown; contexts?: unknown; breadcrumbs?: unknown }>(
  event: T,
): T {
  const next = { ...event } as T & {
    request?: { headers?: Record<string, string>; data?: unknown; cookies?: unknown }
    extra?: Record<string, unknown>
    contexts?: Record<string, unknown>
  }

  if (next.request) {
    const req = { ...(next.request as object) } as {
      headers?: Record<string, string>
      data?: unknown
      cookies?: unknown
    }
    if (req.headers) {
      const headers = { ...req.headers }
      for (const key of Object.keys(headers)) {
        if (/authorization|cookie|x-hub-signature/i.test(key)) {
          headers[key] = '[Filtered]'
        }
      }
      req.headers = headers
    }
    if (req.data) req.data = scrubValue(req.data)
    if (req.cookies) req.cookies = '[Filtered]'
    next.request = req
  }
  if (next.extra) next.extra = scrubValue(next.extra) as Record<string, unknown>
  if (next.contexts) next.contexts = scrubValue(next.contexts) as Record<string, unknown>

  return next
}
