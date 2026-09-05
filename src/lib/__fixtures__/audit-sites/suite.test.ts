/**
 * Permanent multi-site audit fixture suite.
 *
 * Asserts EXACT expected findings for Index Diagnosis, Sitemap Generator,
 * Fix Agent classification, and Link Graph — against four deliberately-broken
 * static HTML fixtures. Runs on every `npm test` / CI push.
 *
 * Spec principle: capabilities must be provably general, not autodun-only.
 */

import { describe, expect, it } from 'vitest'
import { evaluateAllPages } from '@/lib/index-diagnosis/indexability'
import { buildCohortComparison } from '@/lib/index-diagnosis/cohorts'
import { buildSiteFollowUpTasks } from '@/lib/index-diagnosis/follow-up-tasks'
import { buildIndexDiagnosisFixAgentIssues } from '@/lib/index-diagnosis/fix-agent-issues'
import { classifyAuditIssue } from '@/lib/fix-agent-classification'
import { generateSitemap } from '@/lib/sitemap-generator/generate'
import { runLinkGraphAudit } from '@/lib/link-graph/run'
import { buildLinkGraphFixAgentIssues } from '@/lib/link-graph/fix-agent-issues'
import { rewriteHrefsInHtml } from '@/lib/fix-agent-href-rewrite'
import type { TargetFetcher } from '@/lib/link-graph/resolve-targets'
import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'
import {
  ALL_FIXTURE_MANIFESTS,
  getFixtureManifest,
} from './index'
import {
  absoluteUrl,
  buildFixtureCoverage,
  buildLinkGraphInput,
  buildSitemapInput,
  htmlByUrlFromFetched,
  loadFetchedPages,
} from './load-site'
import type { FixtureManifest } from './types'
import {
  canonicalConsolidationOk,
  isIndexHtmlCanonicalMisconfiguration,
} from '@/lib/index-diagnosis/canonical-equivalence'

function mockFetcherFromMap(
  map: Record<string, { status: number; location?: string }>,
): TargetFetcher {
  return async (url) => {
    const row = map[url]
    if (!row) return { status: 404, location: null, finalRequestUrl: url }
    return { status: row.status, location: row.location || null, finalRequestUrl: url }
  }
}

function analyseFixture(manifest: FixtureManifest) {
  const fetched = loadFetchedPages(manifest)
  const pages = evaluateAllPages(fetched, manifest.robotsTxt)
  const htmlByUrl = htmlByUrlFromFetched(fetched)
  const coverage = buildFixtureCoverage(manifest, fetched.length)
  const cohorts = buildCohortComparison(pages)
  const partial = {
    coverage,
    pages,
    cohorts,
    verdict: {
      headline: 'fixture',
      topCauses: [],
      indexableCount: pages.filter((p) => p.verdict === 'INDEXABLE').length,
      blockedCount: pages.filter((p) => p.verdict === 'BLOCKED').length,
      atRiskCount: pages.filter((p) => p.verdict === 'AT_RISK').length,
    },
    followUpTasks: [],
    ranAt: new Date().toISOString(),
  } as IndexDiagnosisResult
  const followUpTasks = buildSiteFollowUpTasks(partial)
  partial.followUpTasks = followUpTasks

  const inboundLinksByUrl: IndexDiagnosisResult['inboundLinksByUrl'] = {}
  for (const page of fetched) {
    for (const m of Array.from(page.html.matchAll(/href=["']([^"']+)["']/gi))) {
      let abs = m[1]!.trim()
      try {
        if (abs.startsWith('/')) abs = new URL(abs, page.finalUrl).href
        if (!abs.startsWith('http')) continue
        if (new URL(abs).hostname !== new URL(manifest.origin).hostname) continue
        // Strip tracking for inbound key alignment with excluded URLs
        const u = new URL(abs)
        ;['utm_source', 'utm_medium', 'utm_campaign', 'gclid'].forEach((k) => u.searchParams.delete(k))
        const key = u.href.replace(/\?$/, '')
        const list = inboundLinksByUrl[key] || []
        if (!list.some((x) => x.fromUrl === page.finalUrl)) {
          list.push({ fromUrl: page.finalUrl, fromDepth: page.depth })
        }
        inboundLinksByUrl[key] = list
      } catch {
        /* skip */
      }
    }
  }
  partial.inboundLinksByUrl = inboundLinksByUrl
  partial.htmlByUrl = htmlByUrl
  partial.robotsTxt = manifest.robotsTxt

  return { fetched, pages, htmlByUrl, coverage, cohorts, followUpTasks, result: partial }
}

describe('audit-sites fixture suite (permanent regression)', () => {
  it('registers all four required fixtures', () => {
    expect(ALL_FIXTURE_MANIFESTS.map((m) => m.id).sort()).toEqual([
      'broken-links-and-orphans',
      'canonical-and-redirects',
      'duplicate-content',
      'js-rendered-spa',
    ])
  })

  for (const manifest of ALL_FIXTURE_MANIFESTS) {
    describe(manifest.id, () => {
      it(`page verdicts match contract: ${manifest.description.slice(0, 60)}…`, () => {
        const { pages } = analyseFixture(manifest)
        for (const exp of manifest.expectations.pages) {
          const url = absoluteUrl(manifest.origin, exp.path)
          const page = pages.find((p) => p.url === url || p.url === url.replace(/\/$/, ''))
          expect(page, `missing page ${exp.path}`).toBeTruthy()
          expect(page!.verdict, `${exp.path} verdict`).toBe(exp.verdict)
          const canon = page!.steps.find((s) => s.step === 'canonical')
          expect(canon?.passed, `${exp.path} canonical.passed`).toBe(exp.canonicalPassed)
          if (exp.evidenceIncludes) {
            expect(canon?.evidence).toContain(exp.evidenceIncludes)
          }
        }
      })

      it('follow-up tasks match exact kinds/URLs', () => {
        const { followUpTasks } = analyseFixture(manifest)
        for (const exp of manifest.expectations.followUps || []) {
          const match = followUpTasks.find(
            (t) =>
              t.kind === exp.kind &&
              t.affectedUrls.some((u) => u.includes(exp.affectedPath)),
          )
          expect(match, `expected follow-up ${exp.kind} for ${exp.affectedPath}`).toBeTruthy()
        }
        for (const absent of manifest.expectations.followUpsAbsent || []) {
          expect(followUpTasks.some((t) => t.kind === absent)).toBe(false)
        }
      })

      it('sitemap includes/excludes exact paths (canonical-duplicate safe)', () => {
        const { pages, htmlByUrl } = analyseFixture(manifest)
        const sitemap = generateSitemap(buildSitemapInput(manifest, pages, htmlByUrl))
        const xml = sitemap.files.find((f) => f.filename === 'sitemap.xml')?.content || ''
        for (const path of manifest.expectations.sitemap.mustInclude) {
          expect(xml, `sitemap must include ${path}`).toContain(path)
        }
        for (const path of manifest.expectations.sitemap.mustExclude) {
          expect(xml, `sitemap must exclude ${path}`).not.toContain(path)
        }
      })

      if (manifest.expectations.fixAgent) {
        it('Fix Agent classifies auto vs human by connection type', () => {
          const { result } = analyseFixture(manifest)
          const issues = buildIndexDiagnosisFixAgentIssues(result, null)

          for (const kind of manifest.expectations.fixAgent!.autoKindsOnGithub) {
            const issue = issues.find((i) => i.fixMetadata?.kind === kind)
            expect(issue, `expected issue kind ${kind}`).toBeTruthy()
            const gh = classifyAuditIssue(issue!, { connectionType: 'github' })
            expect(gh.fixability, `${kind} on github`).toBe('auto')
            expect(gh.autoKind).toBe(kind)
          }

          for (const kind of manifest.expectations.fixAgent!.humanKindsOnGithub || []) {
            const issue = issues.find((i) => i.fixMetadata?.kind === kind)
            expect(issue, `expected human issue kind ${kind}`).toBeTruthy()
            const gh = classifyAuditIssue(issue!, { connectionType: 'github' })
            expect(gh.fixability).toBe('human')
          }

          for (const kind of manifest.expectations.fixAgent!.serverOnlyKinds || []) {
            const issue = issues.find((i) => i.fixMetadata?.kind === kind)
            expect(issue).toBeTruthy()
            const tag = classifyAuditIssue(issue!, { connectionType: 'universal-tag' })
            expect(tag.fixability, `${kind} must not auto on universal-tag`).not.toBe('auto')
          }
        })
      }

      if (manifest.expectations.duplicate) {
        it('flags duplicate cohort and does not over-flag unique page', () => {
          const { pages, cohorts, followUpTasks } = analyseFixture(manifest)
          const flagged = cohorts.filter((c) => c.flagged && c.kind === 'path_pattern')
          expect(flagged.length).toBeGreaterThan(0)
          const pattern = manifest.expectations.duplicate!.flaggedPathPatternIncludes!
          expect(flagged.some((c) => c.label.includes(pattern) || c.cohortId.includes(pattern))).toBe(
            true,
          )

          const uniqueUrl = absoluteUrl(
            manifest.origin,
            manifest.expectations.duplicate!.uniquePathMustNotBeInFlaggedCohort!,
          )
          const uniquePage = pages.find((p) => p.url === uniqueUrl)
          expect(uniquePage).toBeTruthy()
          // Unique page must not share a large near-duplicate cluster with the clones
          expect(uniquePage!.duplicateClusterSize).toBeLessThan(3)

          const dupTasks = followUpTasks.filter((t) => t.kind === 'duplicate_cohort')
          expect(dupTasks.length).toBeGreaterThan(0)
          expect(dupTasks.every((t) => !t.title.includes('unique'))).toBe(true)
        })
      }

      if (manifest.expectations.linkGraph) {
        it('link graph finds exact rules and no forbidden false positives', async () => {
          const { pages, htmlByUrl } = analyseFixture(manifest)
          const input = buildLinkGraphInput(manifest, pages, htmlByUrl)
          const result = await runLinkGraphAudit(input, {
            fetcher: mockFetcherFromMap(manifest.linkResolveMap || {}),
            resolveExternal: false,
          })

          for (const exp of manifest.expectations.linkGraph!.mustFind) {
            const hits = result.findings.filter((f) => {
              if (f.ruleId !== exp.ruleId) return false
              if (!exp.urlIncludes) return true
              const hay = `${f.sourceUrl || ''} ${f.targetUrl || ''}`
              return hay.includes(exp.urlIncludes)
            })
            expect(hits.length, `expected ${exp.ruleId} (${exp.urlIncludes || ''})`).toBeGreaterThan(0)
            if (exp.severity) {
              expect(hits.every((h) => h.severity === exp.severity)).toBe(true)
            }
          }

          for (const ruleId of manifest.expectations.linkGraph!.mustNotFindRuleIds) {
            expect(
              result.findings.filter((f) => f.ruleId === ruleId),
              `must NOT find ${ruleId}`,
            ).toHaveLength(0)
          }

          // Link Graph → Fix Agent bridge (redirect-hop / non-canonical href rewrites)
          {
            const issues = buildLinkGraphFixAgentIssues(result)
            const rewriteIssues = issues.filter((i) => i.fixMetadata?.kind === 'rewrite-link-href')
            const hasRedirect = result.findings.some((f) => f.ruleId === 'L04' || f.ruleId === 'L05')
            if (hasRedirect) {
              expect(rewriteIssues.length).toBeGreaterThan(0)
              const bulk = issues.find((i) => i.id === 'link-bulk-redirect-hops')
              expect(bulk).toBeTruthy()
              const gh = classifyAuditIssue(bulk!, { connectionType: 'github' })
              expect(gh.fixability).toBe('auto')
              expect(gh.autoKind).toBe('rewrite-link-href')
              const tag = classifyAuditIssue(bulk!, { connectionType: 'universal-tag' })
              expect(tag.fixability).not.toBe('auto')

              const homeKey = Object.keys(htmlByUrl).find(
                (u) => new URL(u).pathname === '/' || u === `${manifest.origin}/` || u === manifest.origin,
              )
              const homeHtml = homeKey ? htmlByUrl[homeKey] : undefined
              const fixes = bulk!.fixMetadata?.hrefFixes || []
              if (homeHtml && fixes.length > 0) {
                const applicable = fixes.filter((f) => {
                  try {
                    return homeHtml.includes(new URL(f.fromHref).pathname)
                  } catch {
                    return homeHtml.includes(f.fromHref)
                  }
                })
                if (applicable.length > 0) {
                  const mut = rewriteHrefsInHtml(
                    homeHtml,
                    applicable.map((f) => ({ fromHref: f.fromHref, toHref: f.toHref })),
                  )
                  expect(mut.changed).toBe(true)
                }
              }
            }
          }

          if (manifest.expectations.spa) {
            expect(result.jsSuspected).toBe(manifest.expectations.spa.jsSuspected)
            for (const ruleId of manifest.expectations.spa.suppressRuleIds) {
              expect(result.findings.some((f) => f.ruleId === ruleId)).toBe(false)
            }
          }
        })
      }
    })
  }

  it('utm tracking params collapse to one link target (fixture B)', async () => {
    const manifest = getFixtureManifest('broken-links-and-orphans')
    const { pages, htmlByUrl } = analyseFixture(manifest)
    const result = await runLinkGraphAudit(buildLinkGraphInput(manifest, pages, htmlByUrl), {
      fetcher: mockFetcherFromMap(manifest.linkResolveMap || {}),
    })
    const aliveTargets = result.targets.filter((t) => t.urlNormalized.includes('/alive.html'))
    expect(aliveTargets).toHaveLength(1)
  })
})

describe('canonical equivalence teeth (catches session regression class)', () => {
  it('directory → index.html is OK; index.html → directory is misconfiguration', () => {
    expect(
      canonicalConsolidationOk(
        'https://fixture-a.test/blog',
        'https://fixture-a.test/blog/index.html',
      ),
    ).toBe(true)
    expect(
      isIndexHtmlCanonicalMisconfiguration(
        'https://fixture-a.test/blog/index.html',
        'https://fixture-a.test/blog/',
      ),
    ).toBe(true)
    expect(
      isIndexHtmlCanonicalMisconfiguration(
        'https://fixture-a.test/blog',
        'https://fixture-a.test/blog/index.html',
      ),
    ).toBe(false)
  })

  it('fixture A would fail if consolidation were wrongly treated as AT_RISK', () => {
    const manifest = getFixtureManifest('canonical-and-redirects')
    const { pages } = analyseFixture(manifest)
    const blog = pages.find((p) => p.url === 'https://fixture-a.test/blog')
    // This is the exact autodun false-positive class from this session
    expect(blog?.verdict).toBe('INDEXABLE')
    expect(blog?.steps.find((s) => s.step === 'canonical')?.passed).toBe(true)
  })
})
