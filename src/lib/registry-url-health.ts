/**
 * Internal-link registry URL health.
 *
 * Confirmed production bug (Aug 2026): registry rows pointed at
 * autodun.com/mot-checker and autodun.com/ev-charger-finder — both 404.
 * The live tools are https://mot.autodun.com and https://ev.autodun.com.
 * autodun.com/running-costs is a real content gap (no remap) — leave it
 * flagged unreachable until a page exists.
 *
 * Corrections are explicit remaps of known-wrong registry entries, not
 * silent brand/market defaults. Live reachability uses the same HEAD→GET
 * pattern as citation-link-validator.
 */

const FETCH_TIMEOUT_MS = 5000

/**
 * Confirmed wrong path → live tool URL.
 * Match is host + pathname (query/hash ignored). Host may be apex or www.
 */
const KNOWN_REGISTRY_URL_CORRECTIONS: Array<{
  hostEndsWith: string
  path: string
  correctedUrl: string
  reason: string
}> = [
  {
    hostEndsWith: 'autodun.com',
    path: '/mot-checker',
    correctedUrl: 'https://mot.autodun.com',
    reason: 'Live MOT tool is the mot subdomain, not /mot-checker on the apex',
  },
  {
    hostEndsWith: 'autodun.com',
    path: '/ev-charger-finder',
    correctedUrl: 'https://ev.autodun.com',
    reason: 'Live EV charger finder is the ev subdomain, not /ev-charger-finder on the apex',
  },
]

export type UrlReachability = {
  ok: boolean
  detail: string
  status?: number
}

export type RegistryUrlCorrection = {
  from: string
  to: string
  reason: string
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const withScheme = /^\s*https?:\/\//i.test(raw) ? raw.trim() : `https://${raw.trim()}`
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u
  } catch {
    return null
  }
}

export function normalizeRegistryPageUrl(url: string): string {
  const u = parseHttpUrl(url)
  if (!u) return url.trim()
  u.hash = ''
  if (u.pathname.length > 1) {
    u.pathname = u.pathname.replace(/\/+$/, '')
  }
  return u.toString()
}

/**
 * If this URL is a known-wrong registry entry, return the live correction.
 * Does not invent pages for genuine content gaps (e.g. /running-costs).
 */
export function correctKnownRegistryUrl(url: string): RegistryUrlCorrection | null {
  const u = parseHttpUrl(url)
  if (!u) return null
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const path = (u.pathname || '/').replace(/\/+$/, '') || '/'

  for (const rule of KNOWN_REGISTRY_URL_CORRECTIONS) {
    const suffix = rule.hostEndsWith.toLowerCase()
    // Only remap apex (and www) paths — never remotes that are already on a tool subdomain
    if (host !== suffix) continue
    const wantPath = rule.path.replace(/\/+$/, '') || '/'
    if (path !== wantPath) continue
    if (rule.correctedUrl === url.trim()) return null
    return { from: url.trim(), to: rule.correctedUrl, reason: rule.reason }
  }
  return null
}

/** Apply known correction or return the original URL unchanged. */
export function applyKnownRegistryUrlCorrection(url: string): string {
  return correctKnownRegistryUrl(url)?.to || url.trim()
}

export async function checkUrlReachable(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<UrlReachability> {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, detail: 'skipped (non-http URL)' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let res = await fetchImpl(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    })
    if (res.status === 405 || res.status === 501) {
      res = await fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
      })
    }
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, status: res.status }
    return { ok: true, detail: `HTTP ${res.status}`, status: res.status }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const timedOut = controller.signal.aborted
    return { ok: false, detail: timedOut ? 'request timed out' : `fetch failed: ${message}` }
  } finally {
    clearTimeout(timer)
  }
}

export type RegistryLinkHealthRow = {
  id: string
  page_url: string
  site_url?: string | null
  is_active?: boolean
}

export type RegistryLinkHealthAction =
  | {
      id: string
      action: 'corrected'
      from: string
      to: string
      reason: string
      reachable: boolean
      detail: string
    }
  | {
      id: string
      action: 'deactivated'
      url: string
      detail: string
    }
  | {
      id: string
      action: 'ok'
      url: string
      detail: string
    }
  | {
      id: string
      action: 'skipped-gap'
      url: string
      detail: string
    }

/**
 * Correct known-wrong URLs, verify reachability, deactivate remaining 404s.
 * Does not invent a destination for genuine missing pages.
 */
export async function auditRegistryLinkRows(
  rows: RegistryLinkHealthRow[],
  opts?: {
    fetchImpl?: typeof fetch
    /** When true, do not mark unreachable rows inactive — report only. */
    dryRun?: boolean
  },
): Promise<{
  actions: RegistryLinkHealthAction[]
  updates: Array<{ id: string; page_url?: string; site_url?: string; is_active?: boolean }>
}> {
  const fetchImpl = opts?.fetchImpl ?? fetch
  const actions: RegistryLinkHealthAction[] = []
  const updates: Array<{ id: string; page_url?: string; site_url?: string; is_active?: boolean }> = []

  for (const row of rows) {
    const correction = correctKnownRegistryUrl(row.page_url)
    const candidateUrl = correction?.to || row.page_url.trim()
    const reach = await checkUrlReachable(candidateUrl, fetchImpl)

    if (correction) {
      actions.push({
        id: row.id,
        action: 'corrected',
        from: correction.from,
        to: correction.to,
        reason: correction.reason,
        reachable: reach.ok,
        detail: reach.detail,
      })
      if (reach.ok) {
        let siteUrl = row.site_url || undefined
        try {
          siteUrl = new URL(correction.to).origin
        } catch {
          /* keep */
        }
        updates.push({
          id: row.id,
          page_url: correction.to,
          site_url: siteUrl,
          is_active: true,
        })
      } else {
        // Corrected URL itself unreachable — deactivate rather than write a dead fix
        updates.push({ id: row.id, page_url: correction.to, is_active: false })
        actions.push({
          id: row.id,
          action: 'deactivated',
          url: correction.to,
          detail: `corrected URL still unreachable: ${reach.detail}`,
        })
      }
      continue
    }

    if (reach.ok) {
      actions.push({ id: row.id, action: 'ok', url: candidateUrl, detail: reach.detail })
      continue
    }

    // Genuine gap / dead page — deactivate so it cannot be injected into articles
    actions.push({
      id: row.id,
      action: 'deactivated',
      url: candidateUrl,
      detail: reach.detail,
    })
    updates.push({ id: row.id, is_active: false })
  }

  return { actions, updates: opts?.dryRun ? [] : updates }
}

/** Rewrite wrong registry hrefs already baked into article HTML. */
export function rewriteKnownWrongRegistryHrefsInHtml(html: string): {
  html: string
  replacements: RegistryUrlCorrection[]
} {
  const replacements: RegistryUrlCorrection[] = []
  let out = html
  for (const rule of KNOWN_REGISTRY_URL_CORRECTIONS) {
    const host = rule.hostEndsWith.replace(/\./g, '\\.')
    const path = rule.path.replace(/\//g, '\\/')
    const re = new RegExp(
      `https?:\\/\\/(?:www\\.)?${host}${path}\\/?(?=[\\"\\s>]|$)`,
      'gi',
    )
    if (re.test(out)) {
      replacements.push({
        from: `https://${rule.hostEndsWith}${rule.path}`,
        to: rule.correctedUrl,
        reason: rule.reason,
      })
      out = out.replace(re, rule.correctedUrl)
    }
  }
  return { html: out, replacements }
}
