/**
 * Topic 17 postcondition: exactly one link[rel=canonical] in the document,
 * inside <head>. Never imports the fixer.
 */

import { extractCanonicalDeclarations } from '@/lib/fix-strategies/shared'

export type LiveMultipleCanonicalVerification = {
  ok: boolean
  detail: string
}

export function verifyLiveSingleHeadCanonical(
  liveBody: string,
  liveHeaders: Headers,
  pageUrl: string,
  contentType: string | null,
): LiveMultipleCanonicalVerification {
  const extracted = extractCanonicalDeclarations(
    liveBody,
    liveHeaders,
    pageUrl,
    contentType,
  )

  if (extracted.head.length !== 1) {
    return {
      ok: false,
      detail: `expected exactly one head canonical, found ${extracted.head.length}`,
    }
  }
  if (extracted.body.length > 0) {
    return {
      ok: false,
      detail: `body still has ${extracted.body.length} canonical(s)`,
    }
  }

  return {
    ok: true,
    detail: 'exactly one link[rel=canonical] in document, inside <head>',
  }
}
