/**
 * Topic 16 postcondition: exactly one canonical declaration across HTML+headers.
 * Never imports the fixer.
 */

import { extractCanonicalDeclarations } from '@/lib/fix-strategies/shared'

export type LiveHtmlHeaderAgreeVerification = {
  ok: boolean
  detail: string
  declarationCount: number
}

export function verifyLiveSingleCanonicalDeclaration(
  liveBody: string,
  liveHeaders: Headers,
  pageUrl: string,
  contentType: string | null,
): LiveHtmlHeaderAgreeVerification {
  const extracted = extractCanonicalDeclarations(
    liveBody,
    liveHeaders,
    pageUrl,
    contentType,
  )

  const count = extracted.head.length + extracted.header.length
  // Body decls don't count as effective declarations (C2) but postcondition
  // asks for exactly one reachable declaration across HTML and headers.
  if (count !== 1) {
    return {
      ok: false,
      detail: `expected exactly one HTML+header canonical, found ${count}`,
      declarationCount: count,
    }
  }

  if (extracted.body.length > 0) {
    return {
      ok: false,
      detail: 'body still has a misplaced canonical',
      declarationCount: count,
    }
  }

  return {
    ok: true,
    detail: 'exactly one canonical declaration across HTML and headers',
    declarationCount: count,
  }
}
