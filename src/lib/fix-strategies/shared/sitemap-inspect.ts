/**
 * ONE sitemap inspection for topics 24, 25, 27, 28.
 *
 * Build once via `inspectSiteSitemaps` / `buildSitemapInspection`. All four
 * topics classify from the returned object — never re-fetch or re-parse the
 * sitemap four times. Sitemap indexes are followed before absence conclusions.
 *
 * `Sitemap:` records come from robots-txt-inspect (S19 — anywhere in file).
 */

import { gunzipSync } from 'node:zlib'
import {
  inspectRobotsTxtBody,
  type HopRecordingLikeDeps,
  type RobotsSitemapRecord,
  type RobotsTxtInspection,
  fetchAndInspectRobotsTxt,
} from './robots-txt-inspect'
import {
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_LOC_CHARS,
  SITEMAP_MAX_URLS,
  isAbsoluteHttpLoc,
  parseSitemapXml,
  type ParsedSitemapXml,
} from './sitemap-xml'
import { normalizeFixStrategyUrl } from './url-normalize'
import { recordRedirectHops } from './hop-recording-fetch'

export type SitemapDeclarationKind =
  | 'absolute'
  | 'relative' // S18 — invalid, never fetched
  | 'empty'

export type SitemapDeclaration = {
  source: 'robots.txt'
  record: RobotsSitemapRecord
  kind: SitemapDeclarationKind
  /** Absolute URL when resolvable against origin; null for relative/empty. */
  absoluteUrl: string | null
}

export type SitemapFetchOutcome =
  | 'ok'
  | 'not-found' // 4xx
  | 'server-error' // persistent 5xx
  | 'transient-5xx' // topic 3
  | 'non-xml'
  | 'redirect-chain'
  | 'unreachable'
  | 'skipped-relative' // never fetched (S18)

export type SitemapDocument = {
  /** Requested URL (declaration or child of index). */
  url: string
  /** How this document entered the inspection. */
  origin: 'robots-declaration' | 'index-child' | 'discovered'
  fetchOutcome: SitemapFetchOutcome
  status: number | null
  contentType: string | null
  /** Wire bytes (compressed if gzip). */
  compressedByteLength: number
  /** Decompressed UTF-8 / XML body bytes (S11 — the 50 MB limit applies here). */
  decompressedByteLength: number
  wasGzip: boolean
  exceedsSizeLimit: boolean
  redirectHops: number
  finalUrl: string | null
  body: string
  parsed: ParsedSitemapXml | null
  detail: string
}

export type SitemapInspection = {
  originUrl: string
  robots: RobotsTxtInspection
  declarations: SitemapDeclaration[]
  /** Every fetched document, including children of indexes. */
  documents: SitemapDocument[]
  /**
   * All urlset locs across the tree, after following indexes.
   * Keys are normalizeFixStrategyUrl results (slash/case preserved).
   */
  allLocsNormalized: Set<string>
  /** Raw loc strings as they appear in the XML. */
  allLocsRaw: string[]
  /** Conventional / discovered sitemap URLs not covered by a Sitemap: record. */
  discoveredUnreferenced: string[]
}

export type InspectSiteSitemapsOptions = {
  deps: HopRecordingLikeDeps
  originUrl: string
  /** Pre-built robots inspection (reuse topic 22). */
  robots?: RobotsTxtInspection
  /**
   * Extra sitemap URLs discovered outside robots.txt (conventional paths,
   * sitemap.ts route, HTML links) — used by topic 28.
   */
  discoveredSitemapUrls?: string[]
  /** Max child sitemaps to follow from an index (product safety cap). */
  maxIndexChildren?: number
  confirm5xx?: boolean
}

const XML_CT = /xml|text\/plain/i

/**
 * Extract declarations from a robots inspection (S19).
 */
export function declarationsFromRobots(
  robots: RobotsTxtInspection,
): SitemapDeclaration[] {
  return robots.sitemapRecords.map((record) => {
    const value = record.value.trim()
    if (!value) {
      return {
        source: 'robots.txt' as const,
        record,
        kind: 'empty' as const,
        absoluteUrl: null,
      }
    }
    if (isAbsoluteHttpLoc(value)) {
      return {
        source: 'robots.txt' as const,
        record,
        kind: 'absolute' as const,
        absoluteUrl: value,
      }
    }
    // Relative — invalid per S18; do not resolve for fetch (topic 24 finding)
    return {
      source: 'robots.txt' as const,
      record,
      kind: 'relative' as const,
      absoluteUrl: null,
    }
  })
}

/**
 * Build inspection from a pre-fetched robots body + optional document bodies
 * (fixtures). Does not network.
 */
export function buildSitemapInspection(opts: {
  originUrl: string
  robots: RobotsTxtInspection
  documents: SitemapDocument[]
  discoveredUnreferenced?: string[]
}): SitemapInspection {
  const declarations = declarationsFromRobots(opts.robots)
  const allLocsRaw: string[] = []
  const allLocsNormalized = new Set<string>()
  for (const doc of opts.documents) {
    if (!doc.parsed || doc.parsed.kind !== 'urlset') continue
    for (const loc of doc.parsed.locs) {
      allLocsRaw.push(loc)
      const n = normalizeFixStrategyUrl(loc, opts.originUrl)
      if (n) allLocsNormalized.add(n)
    }
  }
  return {
    originUrl: opts.originUrl,
    robots: opts.robots,
    declarations,
    documents: opts.documents,
    allLocsNormalized,
    allLocsRaw,
    discoveredUnreferenced: opts.discoveredUnreferenced ?? [],
  }
}

/**
 * Fetch robots.txt, declared sitemaps, and follow indexes — once.
 */
export async function inspectSiteSitemaps(
  options: InspectSiteSitemapsOptions,
): Promise<SitemapInspection> {
  const robots =
    options.robots ??
    (await fetchAndInspectRobotsTxt(options.originUrl, options.deps, {
      confirm5xx: options.confirm5xx,
    }))

  const declarations = declarationsFromRobots(robots)
  const documents: SitemapDocument[] = []
  const fetched = new Set<string>()
  const maxChildren = options.maxIndexChildren ?? 200

  for (const decl of declarations) {
    if (decl.kind === 'relative' || decl.kind === 'empty') {
      documents.push({
        url: decl.record.value,
        origin: 'robots-declaration',
        fetchOutcome: 'skipped-relative',
        status: null,
        contentType: null,
        compressedByteLength: 0,
        decompressedByteLength: 0,
        wasGzip: false,
        exceedsSizeLimit: false,
        redirectHops: 0,
        finalUrl: null,
        body: '',
        parsed: null,
        detail:
          decl.kind === 'relative'
            ? 'Relative Sitemap: URL — invalid (S18); never fetched'
            : 'Empty Sitemap: value',
      })
      continue
    }

    const url = decl.absoluteUrl!
    if (fetched.has(url)) continue
    fetched.add(url)
    const doc = await fetchSitemapDocument(
      url,
      'robots-declaration',
      options.deps,
      options.confirm5xx !== false,
    )
    documents.push(doc)

    if (
      doc.fetchOutcome === 'ok' &&
      doc.parsed?.kind === 'sitemapindex'
    ) {
      let n = 0
      for (const child of doc.parsed.childSitemapLocs) {
        if (n >= maxChildren) break
        const abs =
          normalizeFixStrategyUrl(child, url) ??
          (isAbsoluteHttpLoc(child) ? child : null)
        if (!abs || fetched.has(abs)) continue
        fetched.add(abs)
        n++
        documents.push(
          await fetchSitemapDocument(
            abs,
            'index-child',
            options.deps,
            options.confirm5xx !== false,
          ),
        )
      }
    }
  }

  // Discovered sitemaps (topic 28) — fetch only if not already covered
  const discoveredUnreferenced: string[] = []
  for (const raw of options.discoveredSitemapUrls ?? []) {
    const abs = normalizeFixStrategyUrl(raw, options.originUrl) ?? raw
    const covered = declarations.some(
      (d) =>
        d.absoluteUrl != null &&
        normalizeFixStrategyUrl(d.absoluteUrl) ===
          normalizeFixStrategyUrl(abs),
    )
    const alreadyFetched = fetched.has(abs)
    if (covered || alreadyFetched) continue

    const listedInFetchedIndex = documents.some(
      (d) =>
        d.parsed?.kind === 'sitemapindex' &&
        d.parsed.childSitemapLocs.some(
          (c) => normalizeFixStrategyUrl(c, d.url) === abs,
        ),
    )
    if (listedInFetchedIndex) continue

    discoveredUnreferenced.push(abs)
    if (!fetched.has(abs)) {
      fetched.add(abs)
      documents.push(
        await fetchSitemapDocument(
          abs,
          'discovered',
          options.deps,
          options.confirm5xx !== false,
        ),
      )
    }
  }

  return buildSitemapInspection({
    originUrl: options.originUrl,
    robots,
    documents,
    discoveredUnreferenced,
  })
}

async function fetchSitemapDocument(
  url: string,
  origin: SitemapDocument['origin'],
  deps: HopRecordingLikeDeps,
  confirm5xx: boolean,
): Promise<SitemapDocument> {
  try {
    const hops = await recordRedirectHops(url, { fetch: deps.fetch }, {
      readFinalBody: false,
    })
    const redirectHops = hops.hops.filter(
      (h) => h.status >= 300 && h.status < 400,
    ).length

    if (hops.finalStatus >= 500) {
      if (confirm5xx) {
        const second = await deps.fetch(url, { redirect: 'follow' })
        if (second.status < 500) {
          return emptyDoc(url, origin, {
            fetchOutcome: 'transient-5xx',
            status: hops.finalStatus,
            redirectHops,
            detail: 'Transient 5xx on sitemap — topic 3',
          })
        }
      }
      return emptyDoc(url, origin, {
        fetchOutcome: 'server-error',
        status: hops.finalStatus,
        redirectHops,
        detail: `Persistent ${hops.finalStatus} on declared sitemap`,
      })
    }

    if (hops.finalStatus >= 400) {
      return emptyDoc(url, origin, {
        fetchOutcome: 'not-found',
        status: hops.finalStatus,
        redirectHops,
        finalUrl: hops.finalUrl,
        detail: `Declared sitemap returned ${hops.finalStatus}`,
      })
    }

    const finalUrl = hops.finalUrl || url
    const res = await deps.fetch(finalUrl, { redirect: 'follow' })
    const ct = res.headers.get('content-type')
    const buf = Buffer.from(await res.arrayBuffer())
    const compressedByteLength = buf.byteLength

    let wasGzip = false
    let decompressed: Buffer = buf
    const enc = res.headers.get('content-encoding') ?? ''
    if (
      /gzip/i.test(enc) ||
      /\.gz(\?|$)/i.test(finalUrl) ||
      looksLikeGzip(buf)
    ) {
      try {
        decompressed = gunzipSync(buf)
        wasGzip = true
      } catch {
        decompressed = buf
      }
    }

    const decompressedByteLength = decompressed.byteLength
    const exceedsSizeLimit = decompressedByteLength > SITEMAP_MAX_BYTES
    const body = decompressed.toString('utf8')

    const looksXml =
      (ct && XML_CT.test(ct)) ||
      /^\s*<\?xml/i.test(body) ||
      /^\s*<(urlset|sitemapindex)\b/i.test(body)

    if (!looksXml && res.status >= 200 && res.status < 300) {
      return {
        url,
        origin,
        fetchOutcome: 'non-xml',
        status: res.status,
        contentType: ct,
        compressedByteLength,
        decompressedByteLength,
        wasGzip,
        exceedsSizeLimit,
        redirectHops,
        finalUrl,
        body,
        parsed: null,
        detail: `200 but not XML (content-type ${ct ?? 'missing'})`,
      }
    }

    const parsed = parseSitemapXml(body)
    return {
      url,
      origin,
      fetchOutcome: 'ok',
      status: res.status,
      contentType: ct,
      compressedByteLength,
      decompressedByteLength,
      wasGzip,
      exceedsSizeLimit,
      redirectHops,
      finalUrl,
      body,
      parsed,
      detail:
        redirectHops > 0
          ? `OK after ${redirectHops} redirect(s)`
          : 'OK',
    }
  } catch (err) {
    return emptyDoc(url, origin, {
      fetchOutcome: 'unreachable',
      status: null,
      detail: `Unreachable: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

function looksLikeGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

function emptyDoc(
  url: string,
  origin: SitemapDocument['origin'],
  partial: Partial<SitemapDocument> & {
    fetchOutcome: SitemapFetchOutcome
    detail: string
  },
): SitemapDocument {
  return {
    url,
    origin,
    fetchOutcome: partial.fetchOutcome,
    status: partial.status ?? null,
    contentType: partial.contentType ?? null,
    compressedByteLength: partial.compressedByteLength ?? 0,
    decompressedByteLength: partial.decompressedByteLength ?? 0,
    wasGzip: partial.wasGzip ?? false,
    exceedsSizeLimit: partial.exceedsSizeLimit ?? false,
    redirectHops: partial.redirectHops ?? 0,
    finalUrl: partial.finalUrl ?? null,
    body: partial.body ?? '',
    parsed: partial.parsed ?? null,
    detail: partial.detail,
  }
}

/** Helper for fixtures: wrap a body as an OK urlset/index document. */
export function documentFromBody(
  url: string,
  body: string,
  opts?: {
    origin?: SitemapDocument['origin']
    contentType?: string | null
    compressedByteLength?: number
    wasGzip?: boolean
    status?: number
    redirectHops?: number
  },
): SitemapDocument {
  const decompressedByteLength = Buffer.byteLength(body, 'utf8')
  const compressed =
    opts?.compressedByteLength ?? decompressedByteLength
  const parsed = parseSitemapXml(body)
  return {
    url,
    origin: opts?.origin ?? 'robots-declaration',
    fetchOutcome: 'ok',
    status: opts?.status ?? 200,
    contentType: opts?.contentType ?? 'application/xml',
    compressedByteLength: compressed,
    decompressedByteLength,
    wasGzip: opts?.wasGzip ?? false,
    exceedsSizeLimit: decompressedByteLength > SITEMAP_MAX_BYTES,
    redirectHops: opts?.redirectHops ?? 0,
    finalUrl: url,
    body,
    parsed,
    detail: 'OK (fixture)',
  }
}

export function robotsInspectionFromBody(
  body: string,
  opts?: { status?: number; url?: string; fetchStatus?: RobotsTxtInspection['fetchStatus'] },
): RobotsTxtInspection {
  const status = opts?.status ?? 200
  return inspectRobotsTxtBody(body, {
    url: opts?.url ?? 'https://example.com/robots.txt',
    status,
    contentType: 'text/plain',
    fetchStatus:
      opts?.fetchStatus ??
      (status >= 400 && status < 500
        ? 'not-found'
        : status >= 500
          ? 'server-error'
          : 'ok'),
  })
}

export {
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_LOC_CHARS,
  SITEMAP_MAX_URLS,
}
