/**
 * Consolidation audit — live run against autodun.com.
 * Defensive: each detector wrapped; API mismatches recorded as skipped.
 */
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  inspectDocumentHead,
  extractCanonicalDeclarations,
  hasNoindexDirective,
  extractStructuredData,
  collectHreflangAnnotations,
  buildInternalLinkGraph,
  buildSitemapInspection,
  documentFromBody,
  robotsInspectionFromBody,
  inspectRobotsTxtBody,
  recordRedirectHops,
  normalizeFixStrategyUrl,
} from '@/lib/fix-strategies/shared'
import { detectRedirectTopics } from '@/lib/fix-strategies/redirect-chain'
import { detectTagsOutsideHead } from '@/lib/fix-strategies/topic-29'
import { detectTitleMissingOrMalformed } from '@/lib/fix-strategies/topic-30'
import { detectMetaDescriptionIssues } from '@/lib/fix-strategies/topic-31'
import { detectDuplicateTitlesDescriptions } from '@/lib/fix-strategies/topic-33'
import { detectLangDeclaration } from '@/lib/fix-strategies/topic-34'
import { detectRequiredPropertiesAbsent } from '@/lib/fix-strategies/topic-35'
import { detectSchemaUrlsDontResolve } from '@/lib/fix-strategies/topic-36'
import { detectInvalidOrMismatchedType } from '@/lib/fix-strategies/topic-37'
import { detectStructuredDataContradictsVisible } from '@/lib/fix-strategies/topic-38'
import { detectDeprecatedTypes } from '@/lib/fix-strategies/topic-39'
import { detectMissingReturnLinks } from '@/lib/fix-strategies/topic-46'
import { detectInvalidLanguageRegionCodes } from '@/lib/fix-strategies/topic-47'
import { detectAlternateTargetNotIndexable } from '@/lib/fix-strategies/topic-48'
import { detectOrphanPages } from '@/lib/fix-strategies/topic-43'
import { detectCrawlDepth } from '@/lib/fix-strategies/topic-45'
import { detectPotentialSoft404 } from '@/lib/fix-strategies/topic-2b'
import { detect5xxResponses } from '@/lib/fix-strategies/topic-3'
import { detectCanonicalAbsent } from '@/lib/fix-strategies/topic-13'
import { detectCanonicalPointsToNoindexed } from '@/lib/fix-strategies/topic-15'
import { detectHtmlHeaderCanonicalDisagree } from '@/lib/fix-strategies/topic-16'
import { detectMultipleCanonicals } from '@/lib/fix-strategies/topic-17'
import { detectNoindexShouldIndex } from '@/lib/fix-strategies/topic-19'
import { detectMetaHeaderDisagree } from '@/lib/fix-strategies/topic-20'
import { detectBlockedRenderResources } from '@/lib/fix-strategies/topic-21'
import { classifyRobotsTxtInspection } from '@/lib/fix-strategies/topic-22'
import { detectSitemapMissingOrUnreachable } from '@/lib/fix-strategies/topic-24'
import { detectSitemapXmlInvalid } from '@/lib/fix-strategies/topic-25'
import { detectIndexableUrlsAbsent } from '@/lib/fix-strategies/topic-27'
import { detectSitemapNotReferencedInRobots } from '@/lib/fix-strategies/topic-28'
import { detectImgMissingDimensions } from '@/lib/fix-strategies/topic-49'

const ORIGIN = 'https://autodun.com'

type Row = {
  topic: string
  kind: string
  verdict: string
  severity: string | null
  pageUrl?: string
  detail?: string
}

const rows: Row[] = []
const skipped: Array<{ topic: string; reason: string }> = []
const covered = new Set<string>()

function ingest(topic: string, result: unknown) {
  covered.add(topic)
  if (!result || typeof result !== 'object') return
  const r = result as Record<string, unknown>

  const take = (
    key: string,
    kind: string,
    map?: (item: Record<string, unknown>) => Partial<Row>,
  ) => {
    const arr = r[key]
    if (!Array.isArray(arr)) return
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const extra = map?.(item) ?? {}
      const verdict = String(
        extra.verdict ?? item.verdict ?? item.kind ?? kind,
      )
      rows.push({
        topic,
        kind,
        verdict,
        severity:
          (extra.severity as string | null | undefined) ??
          (typeof item.severity === 'string' || item.severity === null
            ? (item.severity as string | null)
            : null),
        pageUrl:
          (extra.pageUrl as string | undefined) ??
          (typeof item.pageUrl === 'string'
            ? item.pageUrl
            : typeof item.sourceUrl === 'string'
              ? item.sourceUrl
              : undefined),
        detail:
          (extra.detail as string | undefined) ??
          (typeof item.detail === 'string' ? item.detail : undefined),
      })
    }
  }

  take('findings', 'finding')
  take('suppressed', 'suppressed')
  take('informational', 'informational')
  take('metrics', 'metric')
  take('observations', 'observation')
  take('routed', 'routed')
  take('routedCauses', 'routed')
  take('ok', 'ok', (item) => ({
    verdict: 'ok',
    detail: String(item.detail ?? ''),
  }))
}

function safe(topic: string, fn: () => unknown) {
  try {
    ingest(topic, fn())
  } catch (e) {
    skipped.push({ topic, reason: e instanceof Error ? e.message : String(e) })
  }
}

async function safeAsync(topic: string, fn: () => Promise<unknown>) {
  try {
    ingest(topic, await fn())
  } catch (e) {
    skipped.push({ topic, reason: e instanceof Error ? e.message : String(e) })
  }
}

async function fetchPage(url: string) {
  const hops = await recordRedirectHops(url, { fetch: globalThis.fetch }, {
    readFinalBody: true,
  })
  return {
    url,
    status: hops.finalStatus,
    headers: hops.finalHeaders,
    body: hops.finalBody,
    finalUrl: hops.finalUrl,
    redirectHopCount: hops.hops.filter((h) => h.status >= 300 && h.status < 400)
      .length,
  }
}

describe('autodun.com consolidation audit', () => {
  it(
    'crawls sample + runs detectors',
    async () => {
      const robotsBody = await (await fetch(`${ORIGIN}/robots.txt`)).text()
      const smRes = await fetch(`${ORIGIN}/sitemap.xml`)
      const smBody = await smRes.text()
      const locs = Array.from(
        smBody.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi),
      ).map((m) => m[1]!.trim())
      const sameOrigin = locs.filter((u) => u.startsWith(ORIGIN))
      const sample = Array.from(
        new Set([
          ORIGIN + '/',
          ...sameOrigin
            .filter((u) => u !== ORIGIN + '/' && u !== ORIGIN)
            .slice(0, 10),
        ]),
      )

      const pages = []
      for (const u of sample) {
        pages.push(await fetchPage(u))
      }

      const robotsInsp = robotsInspectionFromBody(robotsBody, {
        status: 200,
        contentType: 'text/plain',
      })
      const smDoc = documentFromBody(`${ORIGIN}/sitemap.xml`, smBody, {
        status: smRes.status,
        contentType: smRes.headers.get('content-type'),
      })
      const sitemapInsp = buildSitemapInspection({
        originUrl: ORIGIN,
        robots: robotsInsp,
        documents: [smDoc],
      })

      // Sitemap block
      safe('24', () =>
        detectSitemapMissingOrUnreachable({ inspection: sitemapInsp }),
      )
      safe('25', () => detectSitemapXmlInvalid({ inspection: sitemapInsp }))
      safe('28', () =>
        detectSitemapNotReferencedInRobots({ inspection: sitemapInsp }),
      )

      const linkedNorms = new Set<string>()
      for (const p of pages) {
        const signals = buildInternalLinkGraph({
          originUrl: ORIGIN,
          pages: [{ url: p.finalUrl, html: p.body }],
        })
        for (const e of signals.edges) {
          if (e.crawlable) linkedNorms.add(e.toNormalized)
        }
      }

      safe('27', () =>
        detectIndexableUrlsAbsent({
          inspection: sitemapInsp,
          robots: robotsInsp,
          pages: pages.map((p) => ({
            url: p.finalUrl,
            status200: p.status === 200,
            body: p.body,
            headers: p.headers,
            contentType: 'text/html',
            internallyLinked:
              linkedNorms.has(normalizeFixStrategyUrl(p.finalUrl) ?? p.finalUrl) ||
              (normalizeFixStrategyUrl(p.finalUrl) ?? p.finalUrl) ===
                normalizeFixStrategyUrl(ORIGIN + '/') ,
            orphaned: false,
          })),
        }),
      )

      // robots 22 classify
      safe('22', () => {
        const insp = inspectRobotsTxtBody(robotsBody, {
          status: 200,
          contentType: 'text/plain',
          url: `${ORIGIN}/robots.txt`,
        })
        const classified = classifyRobotsTxtInspection(insp)
        return {
          findings: classified.filter((c) => !String(c.verdict).startsWith('suppress')),
          suppressed: classified.filter((c) =>
            String(c.verdict).startsWith('suppress'),
          ),
        }
      })

      safe('21', () =>
        detectBlockedRenderResources(
          pages.map((p) => ({
            url: p.finalUrl,
            html: p.body,
            headers: p.headers,
            contentType: 'text/html',
            indexable:
              p.status === 200 &&
              !hasNoindexDirective(p.headers, p.body, 'text/html'),
          })),
          robotsInsp,
        ),
      )

      // Graph 43/45
      const graph = buildInternalLinkGraph({
        originUrl: ORIGIN,
        homepageUrl: ORIGIN + '/',
        pages: pages.map((p) => ({
          url: p.finalUrl,
          html: p.body,
          status: p.status,
          hasNoindex: hasNoindexDirective(p.headers, p.body, 'text/html'),
          inSitemap: sitemapInsp.allLocsNormalized.has(
            normalizeFixStrategyUrl(p.finalUrl) ?? p.finalUrl,
          ),
        })),
      })
      safe('43', () => detectOrphanPages({ graph }))
      safe('45', () => detectCrawlDepth({ graph }))

      // Hreflang
      const hreflangInsp = collectHreflangAnnotations({
        originUrl: ORIGIN,
        sitemap: sitemapInsp,
        robotsInspection: robotsInsp,
        pages: pages.map((p) => ({
          url: p.finalUrl,
          html: p.body,
          headers: p.headers,
          status: p.status,
          redirectHopCount: p.redirectHopCount,
          finalUrl: p.finalUrl,
        })),
      })
      safe('46', () => detectMissingReturnLinks({ inspection: hreflangInsp }))
      safe('47', () =>
        detectInvalidLanguageRegionCodes({ inspection: hreflangInsp }),
      )
      safe('48', () =>
        detectAlternateTargetNotIndexable({ inspection: hreflangInsp }),
      )

      // Head + SD + soft404 + 5xx + canonical per page
      const headPages = pages.map((p) => ({
        url: p.finalUrl,
        inspection: inspectDocumentHead(p.body, p.finalUrl),
        status200: p.status === 200,
        headers: p.headers,
        body: p.body,
        contentType: 'text/html' as string | null,
      }))

      for (const p of pages) {
        const pageUrl = p.finalUrl
        const inspection = inspectDocumentHead(p.body, pageUrl)
        safe('29', () => detectTagsOutsideHead({ inspection }))
        safe('30', () =>
          detectTitleMissingOrMalformed({
            page: {
              inspection,
              status200: p.status === 200,
              headers: p.headers,
              body: p.body,
              contentType: 'text/html',
            },
          }),
        )
        safe('31', () =>
          detectMetaDescriptionIssues({
            page: {
              inspection,
              status200: p.status === 200,
              headers: p.headers,
              body: p.body,
              contentType: 'text/html',
            },
          }),
        )
        safe('34', () => detectLangDeclaration({ inspection }))

        const extraction = extractStructuredData(p.body, pageUrl)
        safe('35', () =>
          detectRequiredPropertiesAbsent({ html: p.body, pageUrl, extraction }),
        )
        safe('36', () =>
          detectSchemaUrlsDontResolve({
            html: p.body,
            pageUrl,
            extraction,
            probes: {},
          }),
        )
        safe('37', () =>
          detectInvalidOrMismatchedType({ html: p.body, pageUrl, extraction }),
        )
        safe('38', () =>
          detectStructuredDataContradictsVisible({
            html: p.body,
            pageUrl,
            extraction,
          }),
        )
        safe('39', () =>
          detectDeprecatedTypes({ html: p.body, pageUrl, extraction }),
        )

        safe('2b', () =>
          detectPotentialSoft404({
            pageUrl,
            status: p.status,
            html: p.body,
            repoNoindex: 'false',
          }),
        )
        safe('3', () =>
          detect5xxResponses({
            pageUrl,
            attempts: [
              { status: p.status, kind: 'http' },
              { status: p.status, kind: 'http' },
            ],
          }),
        )

        await safeAsync('49', () =>
          detectImgMissingDimensions(p.body, pageUrl, {
            fetch: globalThis.fetch,
          }),
        )
      }

      safe('33', () =>
        detectDuplicateTitlesDescriptions({ pages: headPages }),
      )

      safe('13', () =>
        detectCanonicalAbsent(
          pages.map((p) => ({
            url: p.finalUrl,
            body: p.body,
            headers: p.headers,
            contentType: 'text/html',
            duplicatesProven: false,
          })),
        ),
      )
      safe('16', () =>
        detectHtmlHeaderCanonicalDisagree(
          pages.map((p) => ({
            url: p.finalUrl,
            body: p.body,
            headers: p.headers,
            contentType: 'text/html',
          })),
        ),
      )
      safe('17', () =>
        detectMultipleCanonicals(
          pages.map((p) => ({
            url: p.finalUrl,
            body: p.body,
            headers: p.headers,
            contentType: 'text/html',
          })),
        ),
      )
      safe('20', () =>
        detectMetaHeaderDisagree({
          pages: pages.map((p) => ({
            url: p.finalUrl,
            body: p.body,
            headers: p.headers,
            contentType: 'text/html',
          })),
        }),
      )
      safe('19', () =>
        detectNoindexShouldIndex(
          pages.map((p) => ({
            url: p.finalUrl,
            body: p.body,
            headers: p.headers,
            contentType: 'text/html',
            inSitemap: sitemapInsp.allLocsNormalized.has(
              normalizeFixStrategyUrl(p.finalUrl) ?? p.finalUrl,
            ),
            repoNoindex: 'false' as const,
          })),
        ),
      )

      // Topic 15 for each page with canonical target in crawl set
      for (const p of pages) {
        const ex = extractCanonicalDeclarations(
          p.body,
          p.headers,
          p.finalUrl,
          'text/html',
        )
        const targetNorm = ex.effectiveHead?.normalized
        if (!targetNorm) continue
        const t =
          pages.find(
            (x) =>
              (normalizeFixStrategyUrl(x.finalUrl) ?? x.finalUrl) === targetNorm,
          ) ?? p
        safe('15', () =>
          detectCanonicalPointsToNoindexed({
            pageUrl: p.finalUrl,
            html: p.body,
            headers: p.headers,
            target: {
              url: t.finalUrl,
              status: t.status,
              html: t.body,
              headers: t.headers,
              repoNoindex: 'false',
            },
          }),
        )
      }

      // Redirects 4–7 via shared detectRedirectTopics
      await safeAsync('4-7', async () => {
        const result = await detectRedirectTopics(
          [
            { url: ORIGIN + '/' },
            { url: 'http://autodun.com/' },
            { url: ORIGIN + '/blog' },
          ],
          { deps: { fetch: globalThis.fetch } },
        )
        const findings: Array<Record<string, unknown>> = []
        const suppressed: Array<Record<string, unknown>> = []
        for (const f of result.findings) {
          for (const [topic, block] of [
            ['4', f.topic4],
            ['5', f.topic5],
            ['6', f.topic6],
            ['7', f.topic7],
          ] as const) {
            covered.add(topic)
            const b = block as {
              verdict: string
              severity?: string | null
              detail?: string
            }
            const row = {
              verdict: b.verdict,
              severity: b.severity ?? null,
              detail: b.detail,
              pageUrl: f.originUrl,
            }
            if (
              String(b.verdict).startsWith('suppress') ||
              String(b.verdict).startsWith('ok') ||
              String(b.verdict).startsWith('route')
            ) {
              suppressed.push(row)
              rows.push({ topic, kind: 'suppressed', ...row })
            } else {
              findings.push(row)
              rows.push({ topic, kind: 'finding', ...row })
            }
          }
        }
        return { findings, suppressed }
      })

      // Aggregate
      const byKind: Record<string, number> = {}
      const bySeverity: Record<string, number> = {}
      const byVerdict: Record<string, number> = {}
      const suppressByGuard: Record<string, number> = {}
      const findingsByTopic: Record<string, number> = {}

      for (const r of rows) {
        byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
        bySeverity[r.severity ?? '(none)'] =
          (bySeverity[r.severity ?? '(none)'] ?? 0) + 1
        byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1
        if (r.kind === 'suppressed' || r.kind === 'routed') {
          suppressByGuard[r.verdict] = (suppressByGuard[r.verdict] ?? 0) + 1
        }
        if (r.kind === 'finding') {
          findingsByTopic[r.topic] = (findingsByTopic[r.topic] ?? 0) + 1
        }
      }

      const actionable = rows.filter((r) => r.kind === 'finding')
      const report = {
        origin: ORIGIN,
        crawledPages: pages.map((p) => ({
          requested: p.url,
          finalUrl: p.finalUrl,
          status: p.status,
          hops: p.redirectHopCount,
        })),
        topicsCovered: Array.from(covered).sort(),
        skippedDetectors: skipped,
        totals: {
          rows: rows.length,
          actionableFindings: actionable.length,
          suppressedOrRouted: rows.filter(
            (r) => r.kind === 'suppressed' || r.kind === 'routed',
          ).length,
          informational: rows.filter((r) => r.kind === 'informational').length,
          metrics: rows.filter((r) => r.kind === 'metric').length,
          observations: rows.filter((r) => r.kind === 'observation').length,
          ok: rows.filter((r) => r.kind === 'ok').length,
        },
        byKind,
        bySeverity,
        findingsByTopic: Object.fromEntries(
          Object.entries(findingsByTopic).sort((a, b) => b[1] - a[1]),
        ),
        byVerdict: Object.fromEntries(
          Object.entries(byVerdict).sort((a, b) => b[1] - a[1]).slice(0, 60),
        ),
        suppressByGuard: Object.fromEntries(
          Object.entries(suppressByGuard).sort((a, b) => b[1] - a[1]),
        ),
        sampleFindings: actionable.slice(0, 50).map((r) => ({
          topic: r.topic,
          verdict: r.verdict,
          severity: r.severity,
          pageUrl: r.pageUrl,
          detail: r.detail?.slice(0, 180),
        })),
        graph: {
          clientOnly: graph.clientOnlyGraph,
          nodes: graph.nodes.length,
          crawlableEdges: graph.edges.filter((e) => e.crawlable).length,
        },
      }

      mkdirSync('/opt/cursor/artifacts', { recursive: true })
      writeFileSync(
        '/opt/cursor/artifacts/autodun-consolidation-audit.json',
        JSON.stringify(report, null, 2),
      )
      writeFileSync(
        '/workspace/docs/fix-strategies/CONSOLIDATION_AUDIT_AUTODUN_RUN.json',
        JSON.stringify(report, null, 2),
      )

      // eslint-disable-next-line no-console
      console.log('TOTALS', JSON.stringify(report.totals, null, 2))
      // eslint-disable-next-line no-console
      console.log('SEVERITY', report.bySeverity)
      // eslint-disable-next-line no-console
      console.log('FINDINGS_BY_TOPIC', report.findingsByTopic)
      // eslint-disable-next-line no-console
      console.log(
        'TOP_SUPPRESS',
        Object.entries(report.suppressByGuard).slice(0, 20),
      )
      // eslint-disable-next-line no-console
      console.log('SKIPPED', skipped)
      // eslint-disable-next-line no-console
      console.log('COVERED', report.topicsCovered)

      expect(pages.length).toBeGreaterThan(3)
      expect(covered.size).toBeGreaterThan(15)
    },
    300_000,
  )
})
