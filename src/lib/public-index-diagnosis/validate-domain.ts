/**
 * Domain validation + IP hashing for the public Index Diagnosis tool.
 */

import { createHash } from 'crypto'
import { promises as dns } from 'dns'
import { normalizeUrl } from '@/lib/supabase/audit-db'
import { isSafePublicUrl } from '@/lib/fetch-page-content'

export type DomainValidationOk = { ok: true; normalizedUrl: string; domain: string }
export type DomainValidationErr = {
  ok: false
  code: 'invalid' | 'private' | 'unresolvable' | 'ip_literal'
  message: string
}

export function hashIp(ip: string): string {
  const pepper =
    process.env.SITE_CONNECTION_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'seoranko-public-scan'
  return createHash('sha256').update(`${pepper}|${ip}`).digest('hex')
}

function isIpLiteralHostname(host: string): boolean {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true
  if (host.includes(':')) return true // IPv6
  return false
}

export async function validatePublicDomainInput(
  raw: string,
): Promise<DomainValidationOk | DomainValidationErr> {
  const trimmed = String(raw || '').trim()
  if (!trimmed) {
    return { ok: false, code: 'invalid', message: 'Enter a domain (for example example.com).' }
  }

  let normalized: string
  try {
    normalized = normalizeUrl(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  } catch {
    return { ok: false, code: 'invalid', message: 'That does not look like a valid domain.' }
  }

  if (!isSafePublicUrl(normalized)) {
    return {
      ok: false,
      code: 'private',
      message: 'Localhost, private, and reserved addresses cannot be scanned.',
    }
  }

  let host: string
  try {
    host = new URL(normalized).hostname
  } catch {
    return { ok: false, code: 'invalid', message: 'That does not look like a valid domain.' }
  }

  if (isIpLiteralHostname(host)) {
    return {
      ok: false,
      code: 'ip_literal',
      message: 'Enter a domain name, not an IP address.',
    }
  }

  try {
    await dns.lookup(host)
  } catch {
    return {
      ok: false,
      code: 'unresolvable',
      message: `Could not resolve ${host}. Check the domain and try again.`,
    }
  }

  return {
    ok: true,
    normalizedUrl: normalized,
    domain: host.replace(/^www\./i, '').toLowerCase(),
  }
}

export function clientIpFromHeaders(headers: Headers): string {
  const xf = headers.get('x-forwarded-for')
  if (xf) {
    const first = xf.split(',')[0]?.trim()
    if (first) return first
  }
  const real = headers.get('x-real-ip')?.trim()
  if (real) return real
  return '0.0.0.0'
}
