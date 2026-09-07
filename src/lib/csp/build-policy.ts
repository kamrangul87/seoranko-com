/**
 * Harvest CSP-relevant external origins from static HTML.
 * Does not execute JavaScript — connect-src from runtime fetch/XHR is incomplete.
 */

export type CspDirective =
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'font-src'
  | 'frame-src'
  | 'connect-src'
  | 'form-action'
  | 'default-src'

export type HarvestedOrigin = {
  origin: string
  directives: CspDirective[]
}

function addOrigin(
  map: Map<string, Set<CspDirective>>,
  raw: string,
  baseUrl: string,
  directive: CspDirective,
) {
  try {
    const u = new URL(raw, baseUrl)
    if (!/^https?:$/i.test(u.protocol)) return
    const origin = u.origin
    if (!map.has(origin)) map.set(origin, new Set())
    map.get(origin)!.add(directive)
  } catch {
    /* ignore invalid */
  }
}

export function harvestOriginsFromHtml(html: string, pageUrl: string): HarvestedOrigin[] {
  const map = new Map<string, Set<CspDirective>>()
  const base = pageUrl

  for (const m of Array.from(html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi))) {
    addOrigin(map, m[1]!, base, 'script-src')
  }
  for (const m of Array.from(html.matchAll(/<link\b([^>]*)>/gi))) {
    const tag = m[1] || ''
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    if (/\brel\s*=\s*["'][^"']*stylesheet/i.test(tag)) addOrigin(map, href, base, 'style-src')
    else if (/\brel\s*=\s*["'][^"']*(?:preconnect|dns-prefetch|preload)/i.test(tag)) {
      addOrigin(map, href, base, 'connect-src')
      addOrigin(map, href, base, 'script-src')
    }
  }
  for (const m of Array.from(
    html.matchAll(/<(?:img|source)\b[^>]*\b(?:src|srcset)\s*=\s*["']([^"']+)["']/gi),
  )) {
    for (const part of m[1]!.split(',')) {
      const src = part.trim().split(/\s+/)[0]
      if (src) addOrigin(map, src, base, 'img-src')
    }
  }
  for (const m of Array.from(html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi))) {
    addOrigin(map, m[1]!, base, 'frame-src')
  }
  for (const m of Array.from(html.matchAll(/<form\b[^>]*\baction\s*=\s*["']([^"']+)["']/gi))) {
    addOrigin(map, m[1]!, base, 'form-action')
  }
  for (const m of Array.from(html.matchAll(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/gi))) {
    addOrigin(map, m[2]!, base, 'font-src')
    addOrigin(map, m[2]!, base, 'img-src')
  }

  return Array.from(map.entries())
    .map(([origin, directives]) => ({
      origin,
      directives: Array.from(directives).sort() as CspDirective[],
    }))
    .sort((a, b) => a.origin.localeCompare(b.origin))
}

export function mergeHarvestedOrigins(lists: HarvestedOrigin[][]): HarvestedOrigin[] {
  const map = new Map<string, Set<CspDirective>>()
  for (const list of lists) {
    for (const row of list) {
      if (!map.has(row.origin)) map.set(row.origin, new Set())
      for (const d of row.directives) map.get(row.origin)!.add(d)
    }
  }
  return Array.from(map.entries())
    .map(([origin, directives]) => ({
      origin,
      directives: Array.from(directives).sort() as CspDirective[],
    }))
    .sort((a, b) => a.origin.localeCompare(b.origin))
}

/**
 * Build a conservative report-only CSP from harvested origins.
 * Always includes 'self'. Does not invent CDNs that were not observed.
 */
export function buildReportOnlyCsp(
  pageOrigin: string,
  harvested: HarvestedOrigin[],
): { headerValue: string; origins: string[] } {
  const byDir = new Map<CspDirective, Set<string>>()
  const ensure = (d: CspDirective) => {
    if (!byDir.has(d)) byDir.set(d, new Set(["'self'"]))
    return byDir.get(d)!
  }

  ensure('default-src')
  ensure('script-src')
  ensure('style-src').add("'unsafe-inline'") // common for static marketing sites; report-only only
  ensure('img-src').add('data:').add('blob:')
  ensure('font-src')
  ensure('frame-src')
  ensure('connect-src')
  ensure('form-action')

  const external: string[] = []
  for (const row of harvested) {
    if (row.origin === pageOrigin) continue
    external.push(row.origin)
    for (const d of row.directives) {
      ensure(d).add(row.origin)
      // GTM / analytics scripts often XHR to same host
      if (d === 'script-src') ensure('connect-src').add(row.origin)
    }
  }

  const order: CspDirective[] = [
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'font-src',
    'connect-src',
    'frame-src',
    'form-action',
  ]

  const parts = order.map((d) => {
    const vals = Array.from(ensure(d))
    return `${d} ${vals.join(' ')}`
  })

  return {
    headerValue: parts.join('; '),
    origins: Array.from(new Set([pageOrigin, ...external])).sort(),
  }
}

/** Origins in `observed` that are not covered by `approved`. */
export function newOriginsNotInAllowlist(observed: string[], approved: string[]): string[] {
  const allow = new Set(approved.map((o) => o.replace(/\/$/, '')))
  return observed.filter((o) => !allow.has(o.replace(/\/$/, '')))
}
