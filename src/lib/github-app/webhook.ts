/**
 * GitHub App webhook signature verification (HMAC SHA-256).
 */

import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verify `X-Hub-Signature-256: sha256=...` against the raw body.
 * Returns false on missing/invalid signatures (fail closed).
 */
export function verifyGithubWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null,
  webhookSecret: string,
): boolean {
  if (!signatureHeader || !webhookSecret) return false
  const expected =
    'sha256=' +
    createHmac('sha256', webhookSecret)
      .update(typeof rawBody === 'string' ? rawBody : rawBody)
      .digest('hex')
  try {
    const a = Buffer.from(signatureHeader)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
