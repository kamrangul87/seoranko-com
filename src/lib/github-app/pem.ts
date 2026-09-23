/**
 * GitHub App private-key PEM inspection + normalization.
 * Never log or return key material — only metadata and a normalized KeyObject/PEM
 * for in-process signing.
 */

import { createPrivateKey, type KeyObject } from 'crypto'

export type PemFormat = 'pkcs1' | 'pkcs8' | 'encrypted' | 'unknown'

export type PemNewlineStyle = 'lf' | 'crlf' | 'mixed' | 'collapsed_or_missing'

export type PemInspectResult = {
  format: PemFormat
  newlineStyle: PemNewlineStyle
  lineCount: number
  hasBegin: boolean
  hasEnd: boolean
  /** True when body had no line breaks and we re-wrapped base64. */
  repairedCollapsedNewlines: boolean
  /** True when we re-exported as PKCS#8 for signing. */
  convertedToPkcs8: boolean
  /** Signer can load the (normalized) key. */
  signerAccepts: boolean
  signerError: string | null
  /** Normalized PEM for signing (PKCS#8 when conversion succeeded). Never log this. */
  normalizedPem: string
  keyObject: KeyObject | null
}

function detectFormat(pem: string): PemFormat {
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) return 'pkcs1'
  if (/BEGIN ENCRYPTED PRIVATE KEY/.test(pem)) return 'encrypted'
  if (/BEGIN PRIVATE KEY/.test(pem)) return 'pkcs8'
  return 'unknown'
}

function detectNewlines(raw: string): PemNewlineStyle {
  const normalized = raw.replace(/\r\n/g, '\n')
  const hasCrlf = raw.includes('\r\n')
  const lineCount = normalized.split('\n').length
  const trimmedBody = normalized
    .replace(/^-----BEGIN [^-]+-----\s*/, '')
    .replace(/\s*-----END [^-]+-----$/, '')
  const bodyHasNewline = trimmedBody.includes('\n')
  if (lineCount <= 2 || !bodyHasNewline) return 'collapsed_or_missing'
  if (hasCrlf && raw.replace(/\r\n/g, '').includes('\n')) return 'mixed'
  if (hasCrlf) return 'crlf'
  return 'lf'
}

/**
 * Rebuild a PEM if the base64 body lost newlines (e.g. paste → spaces).
 * Does not alter key bits — only whitespace / wrapping.
 */
export function repairPemWrapping(input: string): {
  pem: string
  repairedCollapsedNewlines: boolean
} {
  let s = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const m = s.match(
    /^-----BEGIN ([^-]+)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----$/s,
  )
  if (!m) {
    return { pem: s, repairedCollapsedNewlines: false }
  }
  const type = m[1]
  const b64 = m[2].replace(/\s+/g, '')
  const originalHadInternalNewlines = /\n/.test(m[2].trim())
  const lines = b64.match(/.{1,64}/g) || []
  s = `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`
  return {
    pem: s,
    repairedCollapsedNewlines: !originalHadInternalNewlines && b64.length > 64,
  }
}

/**
 * Inspect paste, repair wrapping, prefer PKCS#8 KeyObject for RS256 signing.
 */
export function inspectAndNormalizeGithubAppPem(rawPem: string): PemInspectResult {
  const newlineStyle = detectNewlines(rawPem)
  const { pem: repaired, repairedCollapsedNewlines } = repairPemWrapping(rawPem)
  const format = detectFormat(repaired)
  const lineCount = repaired.split('\n').length
  const hasBegin = /-----BEGIN /.test(repaired)
  const hasEnd = /-----END /.test(repaired)

  let keyObject: KeyObject | null = null
  let signerAccepts = false
  let signerError: string | null = null
  let convertedToPkcs8 = false
  let normalizedPem = repaired

  try {
    keyObject = createPrivateKey(repaired)
    signerAccepts = true
    // Prefer PKCS#8 export for a consistent signing input.
    if (format === 'pkcs1' || format === 'pkcs8') {
      const exported = keyObject.export({ type: 'pkcs8', format: 'pem' })
      normalizedPem = typeof exported === 'string' ? exported : exported.toString('utf8')
      convertedToPkcs8 = format === 'pkcs1'
      keyObject = createPrivateKey(normalizedPem)
    }
  } catch (e) {
    signerAccepts = false
    signerError = e instanceof Error ? e.message : 'pem_parse_failed'
    // Never echo key material in the error string path callers may log.
    if (/key|pem|decoder|asn1/i.test(signerError)) {
      signerError = 'PEM could not be parsed by the signer (check format and newlines)'
    }
  }

  return {
    format,
    newlineStyle,
    lineCount,
    hasBegin,
    hasEnd,
    repairedCollapsedNewlines,
    convertedToPkcs8,
    signerAccepts,
    signerError,
    normalizedPem,
    keyObject,
  }
}

/** Public metadata only — safe to return to the owner browser. */
export function pemInspectPublicMeta(inspect: PemInspectResult): Record<string, unknown> {
  return {
    format: inspect.format,
    newline_style: inspect.newlineStyle,
    line_count: inspect.lineCount,
    has_begin: inspect.hasBegin,
    has_end: inspect.hasEnd,
    repaired_collapsed_newlines: inspect.repairedCollapsedNewlines,
    converted_to_pkcs8: inspect.convertedToPkcs8,
    signer_accepts: inspect.signerAccepts,
    signer_error: inspect.signerError,
  }
}
