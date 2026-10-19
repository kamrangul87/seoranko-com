import { createHash } from 'node:crypto'

/**
 * Stable fingerprint of a finding's observable content. When a re-crawl
 * upserts with a different fingerprint, any prior "Mark as OK" is cleared
 * so the finding returns to Needs you.
 */
export function findingAcceptanceFingerprint(input: {
  detail: string
  pageUrl: string | null
  evidenceValues: unknown
}): string {
  const payload = JSON.stringify({
    d: input.detail,
    p: input.pageUrl,
    e: input.evidenceValues ?? null,
  })
  return createHash('sha256').update(payload).digest('hex')
}
