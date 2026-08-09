// Validates external citation links the model wrote inline (as distinct from
// internal/registry links, which are already tracked and audited via
// InternalLink[] / auditPlacedLinks — see article-v2/route.ts). Confirmed via
// a real generated article citing a URL that doesn't exist
// (oneevgroup.com/insights/smart-ev-tariffs-uk-2026) — nothing in the
// pipeline previously checked whether a cited URL actually resolves, so a
// fabricated citation shipped with full citation formatting, which reads as
// more trustworthy than an unsourced claim, not less.

const FETCH_TIMEOUT_MS = 5000

// Maps a named source (as it would appear in anchor text/prose) to the
// domain its citations should actually resolve to. Mirrors the org list in
// fact-checker.ts's NAMED_SOURCE_RE for consistency between what counts as
// "sourced" and what counts as a legitimate citation for that source.
const KNOWN_SOURCE_DOMAINS: Record<string, string> = {
  'gov.uk': 'gov.uk',
  'ofgem': 'ofgem.gov.uk',
  'dvsa': 'gov.uk',
  'dvla': 'gov.uk',
  'hmrc': 'gov.uk',
  'nhs': 'nhs.uk',
  'dft': 'gov.uk',
  'ons': 'ons.gov.uk',
  'rightmove': 'rightmove.co.uk',
  'ofcom': 'ofcom.org.uk',
  'fca': 'fca.org.uk',
  'cma': 'gov.uk',
}

export interface CitationLinkIssue {
  url: string
  anchorText: string
  reason: 'unreachable' | 'domain-mismatch'
  detail: string
}

export interface CitationLinkValidationResult {
  html: string
  issues: CitationLinkIssue[]
}

interface Anchor {
  raw: string
  url: string
  text: string
}

function extractAnchors(html: string): Anchor[] {
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  const results: Anchor[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    results.push({ raw: m[0], url: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() })
  }
  return results
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

// Catches "GOV.UK confirms..." linking somewhere that isn't actually
// gov.uk — an anchor claiming a specific authority but pointing elsewhere is
// worse than no citation, since it borrows that source's credibility.
function domainMismatch(anchorText: string, url: string): string | null {
  const hostname = hostnameOf(url)
  if (!hostname) return null
  const lowerText = anchorText.toLowerCase()
  for (const [name, expectedDomain] of Object.entries(KNOWN_SOURCE_DOMAINS)) {
    const nameRe = new RegExp(`\\b${name.replace('.', '\\.')}\\b`, 'i')
    if (nameRe.test(lowerText) && hostname !== expectedDomain && !hostname.endsWith(`.${expectedDomain}`)) {
      return `anchor text names "${name.toUpperCase()}" but the link resolves to "${hostname}", not "${expectedDomain}"`
    }
  }
  return null
}

async function checkReachable(url: string): Promise<{ ok: boolean; detail: string }> {
  if (!/^https?:\/\//i.test(url)) return { ok: true, detail: 'skipped (non-http URL)' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    let res = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' })
    // Some servers reject HEAD outright (405) or don't implement it (501) —
    // fall back to GET rather than treating that as the link being broken.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' })
    }
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    return { ok: true, detail: `HTTP ${res.status}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const timedOut = controller.signal.aborted
    return { ok: false, detail: timedOut ? 'request timed out' : `fetch failed: ${message}` }
  } finally {
    clearTimeout(timer)
  }
}

export async function validateCitationLinks(
  html: string,
  opts: { skipUrls?: string[]; skipDomains?: string[] } = {}
): Promise<CitationLinkValidationResult> {
  const anchors = extractAnchors(html)
  const skipUrls = new Set((opts.skipUrls || []).filter(Boolean))
  const skipDomains = (opts.skipDomains || []).filter(Boolean).map(d => d.toLowerCase())

  // Internal/registry links are already tracked and audited elsewhere
  // (auditPlacedLinks) — only validate links the model wrote itself as
  // citations, i.e. anything not in the known internal-link set and not
  // pointing at the article's own brand domain.
  const candidates = anchors.filter(a => {
    if (skipUrls.has(a.url)) return false
    const hostname = hostnameOf(a.url)
    if (hostname && skipDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))) return false
    return true
  })

  if (candidates.length === 0) return { html, issues: [] }

  const checked = await Promise.all(candidates.map(async (a): Promise<(Anchor & { reason: CitationLinkIssue['reason']; detail: string }) | null> => {
    const mismatch = domainMismatch(a.text, a.url)
    if (mismatch) return { ...a, reason: 'domain-mismatch', detail: mismatch }
    const { ok, detail } = await checkReachable(a.url)
    if (!ok) return { ...a, reason: 'unreachable', detail }
    return null
  }))

  const failures = checked.filter((c): c is NonNullable<typeof c> => c !== null)
  let patchedHtml = html
  const issues: CitationLinkIssue[] = []
  for (const f of failures) {
    // Strip the anchor but keep the visible text — downgrades the sentence
    // to an unsourced claim (no href left in its paragraph) rather than
    // shipping a dead or fabricated-looking citation. checkAndPatchFactSourcing
    // running afterward on this stripped HTML will then correctly evaluate —
    // and, if needed, hedge — the now-unsourced sentence.
    patchedHtml = patchedHtml.replace(f.raw, f.text)
    issues.push({ url: f.url, anchorText: f.text, reason: f.reason, detail: f.detail })
  }

  return { html: patchedHtml, issues }
}
