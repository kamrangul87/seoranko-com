/**
 * Normalize a public URL or host into an https origin for detection-only crawl.
 * No DNS lookup, no credentials — parse only. Uses isSafePublicUrl so
 * metadata / private ranges (incl. 169.254.169.254) are refused.
 */
import { isSafePublicUrl } from '@/lib/fetch-page-content'

export function normalizePublicOrigin(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  parsed.protocol = 'https:'
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  parsed.username = ''
  parsed.password = ''
  // Strip default www for origin identity (same as connected-site path)
  if (parsed.hostname.toLowerCase().startsWith('www.')) {
    parsed.hostname = parsed.hostname.slice(4)
  }

  const origin = parsed.origin
  if (!isSafePublicUrl(origin)) return null
  return origin
}
