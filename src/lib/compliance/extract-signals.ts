/**
 * Deterministic extraction of third-party signals from crawled HTML + headers.
 */

import {
  VENDOR_SIGNATURES,
  type VendorMatchKind,
  type VendorSignature,
} from './vendor-signatures'

export type PageSignals = {
  pageUrl: string
  scriptSrcs: string[]
  formActions: string[]
  iframeSrcs: string[]
  cookieNames: string[]
}

export type DetectedVendorHit = {
  vendor: VendorSignature
  pageUrl: string
  matchKind: VendorMatchKind
  matchedValue: string
}

const ATTR_RE = (tag: string, attr: string) =>
  new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'gi')

function collectAttr(html: string, tag: string, attr: string): string[] {
  const out: string[] = []
  const re = ATTR_RE(tag, attr)
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m[1]) out.push(m[1])
  }
  return out
}

/** Node undici exposes getSetCookie(); fall back to get('set-cookie'). */
export function cookieNamesFromHeaders(headers: Headers | null | undefined): string[] {
  if (!headers) return []
  const names: string[] = []
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] }
  const lines =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : (() => {
          const single = headers.get('set-cookie')
          return single ? [single] : []
        })()
  for (const line of lines) {
    const name = line.split('=')[0]?.trim()
    if (name) names.push(name)
  }
  return names
}

/** document.cookie / cookie setters mentioned in inline scripts (best-effort). */
function cookieNamesFromHtml(html: string): string[] {
  const names: string[] = []
  const re = /(?:document\.cookie|Cookie)\s*=\s*["']([^=;"'\s]+)=/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m[1]) names.push(m[1])
  }
  return names
}

export function extractPageSignals(
  pageUrl: string,
  html: string,
  headers?: Headers | null,
): PageSignals {
  const cookieNames = [
    ...new Set([
      ...cookieNamesFromHeaders(headers),
      ...cookieNamesFromHtml(html),
    ]),
  ]
  return {
    pageUrl,
    scriptSrcs: collectAttr(html, 'script', 'src'),
    formActions: collectAttr(html, 'form', 'action'),
    iframeSrcs: collectAttr(html, 'iframe', 'src'),
    cookieNames,
  }
}

function valuesForKind(signals: PageSignals, kind: VendorMatchKind): string[] {
  if (kind === 'script_src') return signals.scriptSrcs
  if (kind === 'form_action') return signals.formActions
  if (kind === 'iframe_src') return signals.iframeSrcs
  return signals.cookieNames
}

export function matchVendorsOnPage(signals: PageSignals): DetectedVendorHit[] {
  const hits: DetectedVendorHit[] = []
  for (const vendor of VENDOR_SIGNATURES) {
    for (const pat of vendor.patterns) {
      for (const value of valuesForKind(signals, pat.kind)) {
        if (pat.pattern.test(value)) {
          hits.push({
            vendor,
            pageUrl: signals.pageUrl,
            matchKind: pat.kind,
            matchedValue: value,
          })
        }
      }
    }
  }
  return hits
}

export function matchVendorAgainstValue(
  vendor: VendorSignature,
  kind: VendorMatchKind,
  value: string,
): boolean {
  return vendor.patterns.some((p) => p.kind === kind && p.pattern.test(value))
}
