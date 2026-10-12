const MAX_SNIPPET_BYTES = 2048

/**
 * Tag-level HTML only: strip text nodes / attribute values that look like
 * prose, keep element skeleton for fixture drafts. Cap at 2 KB.
 */
export function sanitiseHtmlSnippet(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = raw
  // Remove script/style bodies entirely
  s = s.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '<$1/>')
  // Collapse text between tags to a single space marker
  s = s.replace(/>([^<]+)</g, (_m, text: string) => {
    const t = text.trim()
    if (!t) return '><'
    // Keep short tokens that look like attributes/enums, not sentences
    if (t.length <= 24 && !/\s/.test(t) && !/[.!?…]/.test(t)) {
      return `>${t}<`
    }
    return '><'
  })
  // Strip long attribute values (likely content / URLs with query junk)
  s = s.replace(
    /(\s(?:alt|title|aria-label|content|value|data-[a-z0-9-]+)=)(["'])[\s\S]*?\2/gi,
    '$1$2…$2',
  )
  s = s.replace(/\s+/g, ' ').trim()
  const buf = Buffer.from(s, 'utf8')
  if (buf.length <= MAX_SNIPPET_BYTES) return s
  return buf.subarray(0, MAX_SNIPPET_BYTES).toString('utf8')
}

export type FixFailureEvidence = {
  reason: string
  url?: string | null
  httpStatus?: number | null
  filePath?: string | null
  /** Tag-level snippet ≤ 2 KB; never customer body prose. */
  snippet?: string | null
  e2eStep?: string | null
}

export function buildFailureEvidence(input: {
  reason: string
  url?: string | null
  httpStatus?: number | null
  filePath?: string | null
  htmlSnippet?: string | null
  e2eStep?: string | null
}): FixFailureEvidence {
  const snippet = sanitiseHtmlSnippet(input.htmlSnippet)
  const out: FixFailureEvidence = {
    reason: input.reason.slice(0, 500),
  }
  if (input.url) out.url = input.url
  if (input.httpStatus != null) out.httpStatus = input.httpStatus
  if (input.filePath) out.filePath = input.filePath
  if (snippet) out.snippet = snippet
  if (input.e2eStep) out.e2eStep = input.e2eStep
  return out
}

/** True when evidence looks like it still contains sentence-level body text. */
export function evidenceContainsBodyText(evidence: FixFailureEvidence): boolean {
  const snip = evidence.snippet ?? ''
  // Sentence-like text between tags or long prose outside tags
  if (/>([^<]{40,})</.test(snip)) return true
  if (/[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/i.test(snip.replace(/<[^>]+>/g, ' '))) {
    return true
  }
  return false
}
