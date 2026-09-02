/**
 * Link graph rules L01–L32 + L00.
 * Deterministic only — no model in the detection path.
 */

import { isBareUrlAnchor, isGenericAnchor } from '../generic-anchors'
import { normalizeLinkUrl, registrableHost } from '../normalize'
import type { LinkEdge, LinkFinding, LinkTarget, LinkSeverity } from '../types'

export interface RuleContext {
  edges: LinkEdge[]
  targets: LinkTarget[]
  targetByUrl: Map<string, LinkTarget>
  seedUrl: string
  siteHost: string
  sitemapUrls: string[]
  trailingSlashConvention: boolean
  jsSuspected: boolean
  jsSuspectedUrls: string[]
  lang?: string
  pages: Array<{ url: string; httpStatus: number; crawlDepth: number; verdict: string }>
}

function finding(
  ruleId: string,
  severity: LinkSeverity,
  partial: Omit<LinkFinding, 'ruleId' | 'severity'>,
): LinkFinding {
  return { ruleId, severity, ...partial }
}

function internalEdges(edges: LinkEdge[]): LinkEdge[] {
  return edges.filter((e) => e.isInternal)
}

function boilerplate(region: string): boolean {
  return region === 'nav' || region === 'footer'
}

/** L00 — SPA / JS-rendered link coverage warning (audit-level). */
export function ruleL00(ctx: RuleContext): LinkFinding[] {
  if (!ctx.jsSuspected || ctx.jsSuspectedUrls.length === 0) return []
  return [
    finding('L00_JS_SUSPECTED', 'WARN', {
      sourceUrl: null,
      targetUrl: null,
      suggestedTarget: null,
      evidence: {
        urls: ctx.jsSuspectedUrls.slice(0, 20),
        note: 'Served HTML has fewer than 3 internal anchors on pages with substantial body content. Link coverage may be incomplete — client-side JS links are not discovered in v1.',
      },
    }),
  ]
}

/** Broken / redirected internal links L01–L05, L25 */
export function rulesBrokenRedirect(ctx: RuleContext): LinkFinding[] {
  const out: LinkFinding[] = []
  const seenTarget = new Set<string>()

  for (const edge of internalEdges(ctx.edges)) {
    const t = ctx.targetByUrl.get(edge.hrefResolved)
    if (!t) continue
    const key = `${edge.sourceUrl}|${edge.hrefResolved}`

    if (t.isRedirectLoop) {
      const loopKey = `L03:${edge.hrefResolved}`
      if (!seenTarget.has(loopKey)) {
        seenTarget.add(loopKey)
        out.push(
          finding('L03', 'CRITICAL', {
            sourceUrl: edge.sourceUrl,
            targetUrl: edge.hrefResolved,
            suggestedTarget: null,
            evidence: { hrefRaw: edge.hrefRaw, redirectChain: t.redirectChain },
          }),
        )
      }
      continue
    }

    if (t.finalStatus == null) {
      const k = `L25:${edge.hrefResolved}`
      if (!seenTarget.has(k)) {
        seenTarget.add(k)
        out.push(
          finding('L25', 'WARN', {
            sourceUrl: edge.sourceUrl,
            targetUrl: edge.hrefResolved,
            suggestedTarget: null,
            evidence: { hrefRaw: edge.hrefRaw, reason: 'timeout or fetch error' },
          }),
        )
      }
      continue
    }

    if (t.finalStatus >= 400 && t.finalStatus <= 499) {
      out.push(
        finding('L01', 'CRITICAL', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: null,
          evidence: { hrefRaw: edge.hrefRaw, status: t.finalStatus, key },
        }),
      )
    } else if (t.finalStatus >= 500 && t.finalStatus <= 599) {
      out.push(
        finding('L02', 'CRITICAL', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: null,
          evidence: { hrefRaw: edge.hrefRaw, status: t.finalStatus },
        }),
      )
    }

    if (t.redirectHops > 1) {
      const k = `L04:${edge.hrefResolved}`
      if (!seenTarget.has(k)) {
        seenTarget.add(k)
        out.push(
          finding('L04', 'CRITICAL', {
            sourceUrl: edge.sourceUrl,
            targetUrl: edge.hrefResolved,
            suggestedTarget: t.finalUrl,
            evidence: {
              hrefRaw: edge.hrefRaw,
              redirectHops: t.redirectHops,
              redirectChain: t.redirectChain,
            },
          }),
        )
      }
    } else if (t.redirectHops === 1) {
      const k = `L05:${edge.sourceUrl}|${edge.hrefResolved}`
      if (!seenTarget.has(k)) {
        seenTarget.add(k)
        out.push(
          finding('L05', 'FAIL', {
            sourceUrl: edge.sourceUrl,
            targetUrl: edge.hrefResolved,
            suggestedTarget: t.finalUrl,
            evidence: {
              hrefRaw: edge.hrefRaw,
              redirectHops: 1,
              redirectChain: t.redirectChain,
              finalUrl: t.finalUrl,
            },
          }),
        )
      }
    }
  }

  return out
}

/** Canonical / indexability L06–L10 */
export function rulesCanonicalIndexability(ctx: RuleContext): LinkFinding[] {
  const out: LinkFinding[] = []

  for (const edge of internalEdges(ctx.edges)) {
    const t = ctx.targetByUrl.get(edge.hrefResolved)
    if (!t) continue

    if (
      t.canonicalTarget &&
      normalizeLinkUrl(t.canonicalTarget) !== normalizeLinkUrl(t.urlNormalized) &&
      normalizeLinkUrl(t.canonicalTarget) !== t.urlNormalized
    ) {
      const a = normalizeLinkUrl(t.canonicalTarget)
      const b = normalizeLinkUrl(t.urlNormalized)
      if (a && b && a !== b) {
        out.push(
          finding('L06', 'FAIL', {
            sourceUrl: edge.sourceUrl,
            targetUrl: edge.hrefResolved,
            suggestedTarget: t.canonicalTarget,
            evidence: {
              hrefRaw: edge.hrefRaw,
              canonicalTarget: t.canonicalTarget,
              urlNormalized: t.urlNormalized,
            },
          }),
        )
      }
    }

    if (!t.isIndexable && !t.robotsDisallowed) {
      if (edge.domRegion === 'main') {
        out.push(
          finding('L07', 'FAIL', {
            sourceUrl: edge.sourceUrl,
            targetUrl: edge.hrefResolved,
            suggestedTarget: null,
            evidence: { hrefRaw: edge.hrefRaw, domRegion: edge.domRegion },
          }),
        )
      } else if (boilerplate(edge.domRegion)) {
        out.push(
          finding('L08', 'WARN', {
            sourceUrl: edge.sourceUrl,
            targetUrl: edge.hrefResolved,
            suggestedTarget: null,
            evidence: { hrefRaw: edge.hrefRaw, domRegion: edge.domRegion },
          }),
        )
      }
    }

    if (t.robotsDisallowed) {
      out.push(
        finding('L09', 'FAIL', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: null,
          evidence: { hrefRaw: edge.hrefRaw },
        }),
      )
    }

    if (edge.isNofollow) {
      out.push(
        finding('L10', 'WARN', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: null,
          evidence: {
            hrefRaw: edge.hrefRaw,
            rel: edge.rel,
            note: 'Internal nofollow is usually a mistake but is occasionally deliberate (login, cart, faceted nav).',
          },
        }),
      )
    }
  }

  return out
}

/** Anchor text L11–L16 */
export function rulesAnchorText(ctx: RuleContext): LinkFinding[] {
  const out: LinkFinding[] = []
  const contentEdges = ctx.edges.filter((e) => e.isInternal && !boilerplate(e.domRegion))

  for (const edge of ctx.edges.filter((e) => e.isInternal)) {
    if (!edge.anchorText && !edge.anchorImageAlt) {
      out.push(
        finding('L11', 'FAIL', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: null,
          evidence: { hrefRaw: edge.hrefRaw },
        }),
      )
    }
    if (edge.anchorText && isGenericAnchor(edge.anchorText, ctx.lang)) {
      out.push(
        finding('L12', 'WARN', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: null,
          evidence: { hrefRaw: edge.hrefRaw, anchorText: edge.anchorText },
        }),
      )
    }
    if (edge.anchorText && isBareUrlAnchor(edge.anchorText)) {
      out.push(
        finding('L13', 'WARN', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: null,
          evidence: { hrefRaw: edge.hrefRaw, anchorText: edge.anchorText },
        }),
      )
    }
  }

  // L14: same anchor → ≥2 targets (exclude nav/footer)
  const byAnchor = new Map<string, Set<string>>()
  for (const e of contentEdges) {
    const key = e.anchorText.trim().toLowerCase()
    if (!key) continue
    const set = byAnchor.get(key) || new Set()
    set.add(e.hrefResolved)
    byAnchor.set(key, set)
  }
  for (const [anchor, targets] of Array.from(byAnchor.entries())) {
    if (targets.size >= 2) {
      out.push(
        finding('L14', 'WARN', {
          sourceUrl: null,
          targetUrl: null,
          suggestedTarget: null,
          evidence: { anchorText: anchor, targets: Array.from(targets) },
        }),
      )
    }
  }

  // L15: no dominant anchor (≥5 inlinks, top < 30%)
  const byTarget = new Map<string, Map<string, number>>()
  for (const e of contentEdges) {
    const m = byTarget.get(e.hrefResolved) || new Map()
    const a = e.anchorText.trim().toLowerCase() || '(empty)'
    m.set(a, (m.get(a) || 0) + 1)
    byTarget.set(e.hrefResolved, m)
  }
  for (const [target, anchors] of Array.from(byTarget.entries())) {
    const total = Array.from(anchors.values()).reduce((a, b) => a + b, 0)
    if (total < 5) continue
    const top = Math.max(...Array.from(anchors.values()))
    if (top / total < 0.3) {
      out.push(
        finding('L15', 'WARN', {
          sourceUrl: null,
          targetUrl: target,
          suggestedTarget: null,
          evidence: { inlinks: total, topShare: top / total },
        }),
      )
    }
  }

  // L16: exact-match over-repetition > 20 outside boilerplate
  const pairCounts = new Map<string, number>()
  for (const e of contentEdges) {
    const key = `${e.anchorText.trim().toLowerCase()}→${e.hrefResolved}`
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1)
  }
  for (const [key, count] of Array.from(pairCounts.entries())) {
    if (count > 20) {
      const [anchor, target] = key.split('→')
      out.push(
        finding('L16', 'WARN', {
          sourceUrl: null,
          targetUrl: target || null,
          suggestedTarget: null,
          evidence: { anchorText: anchor, count },
        }),
      )
    }
  }

  return out
}

/** URL hygiene L17–L20 */
export function rulesUrlHygiene(ctx: RuleContext): LinkFinding[] {
  const out: LinkFinding[] = []
  const seedHttps = ctx.seedUrl.startsWith('https:')
  const canonicalHost = registrableHost(ctx.seedUrl)

  for (const edge of ctx.edges) {
    if (edge.isInternal && seedHttps && /^http:\/\//i.test(edge.hrefResolved)) {
      out.push(
        finding('L17', 'FAIL', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: edge.hrefResolved.replace(/^http:/i, 'https:'),
          evidence: { hrefRaw: edge.hrefRaw },
        }),
      )
    }

    if (edge.isInternal) {
      try {
        const path = new URL(edge.hrefResolved).pathname
        if (path.length > 1 && !/\.[a-z0-9]{1,8}$/i.test(path)) {
          const hasSlash = path.endsWith('/')
          if (hasSlash !== ctx.trailingSlashConvention) {
            const suggested = normalizeLinkUrl(edge.hrefResolved, {
              trailingSlash: ctx.trailingSlashConvention,
            })
            out.push(
              finding('L18', 'WARN', {
                sourceUrl: edge.sourceUrl,
                targetUrl: edge.hrefResolved,
                suggestedTarget: suggested,
                evidence: {
                  hrefRaw: edge.hrefRaw,
                  convention: ctx.trailingSlashConvention ? 'trailing-slash' : 'no-trailing-slash',
                },
              }),
            )
          }
        }
      } catch {
        /* skip */
      }

      const host = registrableHost(edge.hrefResolved)
      if (host && host !== canonicalHost) {
        // www vs non-www already stripped in registrableHost — flag only if still different
      }
      try {
        const edgeHost = new URL(edge.hrefResolved).hostname.toLowerCase()
        const seedHost = new URL(ctx.seedUrl).hostname.toLowerCase()
        if (
          edge.isInternal &&
          edgeHost !== seedHost &&
          edgeHost.replace(/^www\./, '') === seedHost.replace(/^www\./, '')
        ) {
          const suggested = edge.hrefResolved.replace(edgeHost, seedHost)
          out.push(
            finding('L19', 'FAIL', {
              sourceUrl: edge.sourceUrl,
              targetUrl: edge.hrefResolved,
              suggestedTarget: suggested,
              evidence: { hrefRaw: edge.hrefRaw, edgeHost, seedHost },
            }),
          )
        }
      } catch {
        /* skip */
      }
    }

    if (
      edge.hrefRaw === '#' ||
      edge.hrefRaw.trim() === '' ||
      /^javascript:void\(0\)$/i.test(edge.hrefRaw.trim())
    ) {
      out.push(
        finding('L20', 'WARN', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: null,
          evidence: { hrefRaw: edge.hrefRaw },
        }),
      )
    }
  }

  return out
}

/** Structure L21–L24 */
export function rulesStructure(ctx: RuleContext): LinkFinding[] {
  const out: LinkFinding[] = []
  if (ctx.jsSuspected) {
    // Suppress L21/L23 sitewide when JS-suspected (spec acceptance #8)
    return out
  }

  const homeNorm = normalizeLinkUrl(ctx.seedUrl) || ctx.seedUrl

  const candidateUrls = new Set<string>([
    ...ctx.sitemapUrls.map((u) => normalizeLinkUrl(u) || u),
    ...ctx.pages.map((p) => normalizeLinkUrl(p.url) || p.url),
  ])

  for (const url of Array.from(candidateUrls)) {
    if (!url) continue
    const isHome =
      url === homeNorm ||
      url.replace(/\/$/, '') === homeNorm.replace(/\/$/, '')
    if (isHome) continue

    const t = ctx.targetByUrl.get(url)
    const edgeInlinks = ctx.edges.filter((e) => e.isInternal && e.hrefResolved === url).length
    if (edgeInlinks === 0) {
      out.push(
        finding('L21', 'CRITICAL', {
          sourceUrl: null,
          targetUrl: url,
          suggestedTarget: null,
          evidence: {
            inlinkCount: 0,
            targetInlinkCount: t?.inlinkCount ?? 0,
            inSitemap: ctx.sitemapUrls.some((s) => (normalizeLinkUrl(s) || s) === url),
          },
        }),
      )
    }
  }

  for (const page of ctx.pages) {
    if (page.crawlDepth > 5) {
      out.push(
        finding('L22', 'FAIL', {
          sourceUrl: null,
          targetUrl: page.url,
          suggestedTarget: null,
          evidence: { depth: page.crawlDepth },
        }),
      )
    }
  }

  for (const page of ctx.pages) {
    if (page.verdict !== 'INDEXABLE') continue
    const mainLinks = ctx.edges.filter(
      (e) => e.sourceUrl === page.url && e.isInternal && e.domRegion === 'main',
    )
    if (mainLinks.length === 0) {
      out.push(
        finding('L23', 'WARN', {
          sourceUrl: page.url,
          targetUrl: null,
          suggestedTarget: null,
          evidence: { mainInternalLinks: 0 },
        }),
      )
    }
  }

  const bySource = new Map<string, number>()
  for (const e of ctx.edges.filter((e) => e.isInternal)) {
    bySource.set(e.sourceUrl, (bySource.get(e.sourceUrl) || 0) + 1)
  }
  for (const [url, count] of Array.from(bySource.entries())) {
    if (count > 150) {
      out.push(
        finding('L24', 'WARN', {
          sourceUrl: url,
          targetUrl: null,
          suggestedTarget: null,
          evidence: { internalEdgeCount: count },
        }),
      )
    }
  }

  return out
}

/** Sitemap cross-check L26–L30 */
export function rulesSitemap(ctx: RuleContext): LinkFinding[] {
  const out: LinkFinding[] = []

  for (const raw of ctx.sitemapUrls) {
    const url = normalizeLinkUrl(raw) || raw
    const t = ctx.targetByUrl.get(url)
    // Resolve may not have run for sitemap-only URLs — use page data
    const page = ctx.pages.find((p) => (normalizeLinkUrl(p.url) || p.url) === url)

    const status = t?.finalStatus ?? page?.httpStatus ?? null
    if (status != null && status >= 400) {
      out.push(
        finding('L26', 'CRITICAL', {
          sourceUrl: null,
          targetUrl: url,
          suggestedTarget: null,
          evidence: { status },
        }),
      )
    }

    if (t && t.redirectHops > 0) {
      out.push(
        finding('L27', 'FAIL', {
          sourceUrl: null,
          targetUrl: url,
          suggestedTarget: t.finalUrl,
          evidence: { redirectHops: t.redirectHops, redirectChain: t.redirectChain },
        }),
      )
    }

    if (t && (t.robotsDisallowed || !t.isIndexable)) {
      out.push(
        finding('L28', 'CRITICAL', {
          sourceUrl: null,
          targetUrl: url,
          suggestedTarget: null,
          evidence: {
            robotsDisallowed: t.robotsDisallowed,
            isIndexable: t.isIndexable,
          },
        }),
      )
    }

    if (
      t?.canonicalTarget &&
      normalizeLinkUrl(t.canonicalTarget) !== normalizeLinkUrl(t.urlNormalized)
    ) {
      out.push(
        finding('L29', 'FAIL', {
          sourceUrl: null,
          targetUrl: url,
          suggestedTarget: t.canonicalTarget,
          evidence: { canonicalTarget: t.canonicalTarget },
        }),
      )
    }
  }

  const sitemapSet = new Set(ctx.sitemapUrls.map((u) => normalizeLinkUrl(u) || u))
  for (const page of ctx.pages) {
    if (page.verdict !== 'INDEXABLE') continue
    const n = normalizeLinkUrl(page.url) || page.url
    if (!sitemapSet.has(n) && !Array.from(sitemapSet).some((s) => s.replace(/\/$/, '') === n.replace(/\/$/, ''))) {
      out.push(
        finding('L30', 'WARN', {
          sourceUrl: null,
          targetUrl: page.url,
          suggestedTarget: null,
          evidence: { note: 'Indexable crawled page missing from sitemap' },
        }),
      )
    }
  }

  return out
}

/** External L31–L32 — WARN only, capped sample handled by caller */
export function rulesExternal(ctx: RuleContext): LinkFinding[] {
  const out: LinkFinding[] = []
  for (const edge of ctx.edges.filter((e) => !e.isInternal)) {
    const t = ctx.targetByUrl.get(edge.hrefResolved)
    if (!t) continue
    if (t.finalStatus != null && t.finalStatus >= 400) {
      out.push(
        finding('L31', 'WARN', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: null,
          evidence: { status: t.finalStatus },
        }),
      )
    }
    if (t.redirectHops > 2) {
      out.push(
        finding('L32', 'WARN', {
          sourceUrl: edge.sourceUrl,
          targetUrl: edge.hrefResolved,
          suggestedTarget: t.finalUrl,
          evidence: { redirectHops: t.redirectHops },
        }),
      )
    }
  }
  return out
}

export function runAllRules(ctx: RuleContext): LinkFinding[] {
  return [
    ...ruleL00(ctx),
    ...rulesBrokenRedirect(ctx),
    ...rulesCanonicalIndexability(ctx),
    ...rulesAnchorText(ctx),
    ...rulesUrlHygiene(ctx),
    ...rulesStructure(ctx),
    ...rulesSitemap(ctx),
    ...rulesExternal(ctx),
  ]
}
