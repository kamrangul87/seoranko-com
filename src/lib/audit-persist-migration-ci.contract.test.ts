import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { buildSavedAuditPayload } from './audit-saved-payload'
import { reconstructIndexDiagnosisFromRow, type IndexDiagnosisRunRow } from './index-diagnosis/persist'
import type { CrawlCoverage, PageIndexability } from './index-diagnosis/types'

const root = join(__dirname, '../..')

describe('migration CI contract (merge-to-main auto-apply)', () => {
  it('ships a main-branch workflow that runs supabase db push on every main push', () => {
    const yml = readFileSync(join(root, '.github/workflows/supabase-migrate.yml'), 'utf8')
    expect(yml).toMatch(/branches:\s*\[main\]/)
    expect(yml).toMatch(/workflow_dispatch/)
    expect(yml).toMatch(/scripts\/ci-supabase-db-push\.sh/)
    expect(yml).toMatch(/secrets\.SUPABASE_DB_PASSWORD/)
    expect(yml).toMatch(/db push|ci-supabase-db-push/)
    // Must not be path-filtered away — every merge to main re-syncs schema.
    expect(yml).not.toMatch(/paths:/)
  })

  it('fails loudly when DB password / URL credentials are missing', () => {
    const sh = readFileSync(join(root, 'scripts/ci-supabase-db-push.sh'), 'utf8')
    expect(sh).toMatch(/SUPABASE_DB_PASSWORD/)
    expect(sh).toMatch(/db push/)
    expect(sh).toMatch(/--db-url/)
    expect(sh).toMatch(/ddfboapzwclecbdjoqex/)
    expect(sh).toMatch(/exit 1/)
    expect(sh).toMatch(/Missing credentials/)
  })

  it('uses IPv4 session pooler (not IPv6-only db.<ref>.supabase.co)', () => {
    const sh = readFileSync(join(root, 'scripts/ci-supabase-db-push.sh'), 'utf8')
    expect(sh).toMatch(/aws-1-eu-west-2\.pooler\.supabase\.com/)
    expect(sh).toMatch(/postgres\.\$\{PROJECT_REF\}/)
    expect(sh).toMatch(/5432\/postgres/)
    // Direct DB host is IPv6-only — must not be the default CI target.
    expect(sh).not.toMatch(/@db\.\$\{PROJECT_REF\}\.supabase\.co/)
  })

  it('wires Vercel production builds to db push (merge-to-main deploy path)', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts.build).toMatch(/vercel-production-migrate\.sh/)
    const sh = readFileSync(join(root, 'scripts/vercel-production-migrate.sh'), 'utf8')
    expect(sh).toMatch(/VERCEL_ENV/)
    expect(sh).toMatch(/production/)
    expect(sh).toMatch(/ci-supabase-db-push\.sh/)
    expect(sh).toMatch(/exit 1/)
  })
})

describe('Audit saved payload (reload without re-crawl)', () => {
  function coverage(): CrawlCoverage {
    return {
      domain: 'example.com',
      seedUrl: 'https://example.com/',
      discoveredCount: 1,
      fetchedCount: 1,
      excluded: [],
      excludedByReason: {
        ROBOTS_DISALLOWED: 0,
        META_NOINDEX: 0,
        X_ROBOTS_NOINDEX: 0,
        NON_200: 0,
        DEPTH_LIMIT: 0,
        TIMEOUT: 0,
        PLAN_LIMIT: 0,
        REDIRECT_CHAIN: 0,
        NOT_REACHED: 0,
      },
      terminationReason: 'QUEUE_EMPTY',
      terminationEvidence: 'done',
      discoverySources: { sitemap: 0, links: 0, both: 0, seed: 1 },
      sitemapOnlyUrls: [],
      linkedOnlyUrls: [],
      sitemapDiscoveredUrls: [],
      robotsTxtFetched: true,
      robotsTxtEvidence: 'ok',
    }
  }

  function page(): PageIndexability {
    return {
      url: 'https://example.com/',
      verdict: 'INDEXABLE',
      decisiveStep: null,
      decisiveEvidence: '',
      steps: [],
      httpStatus: 200,
      crawlDepth: 0,
      internalLinksIn: 0,
      inboundLinks: [],
      duplicateClusterId: null,
      duplicateClusterSize: 1,
      mainContentFingerprint: 'x',
      pathPattern: '/',
      depthBand: '0',
      pageTitle: 'Home',
      pageH1: 'Home',
    }
  }

  it('rebuilds Index Diagnosis + Link Graph summary from DB rows without htmlByUrl', () => {
    const row: IndexDiagnosisRunRow = {
      id: 'diag-1',
      domain: 'example.com',
      seed_url: 'https://example.com/',
      verdict_headline: 'Mostly indexable',
      coverage: coverage(),
      pages: [page()],
      cohorts: [],
      top_causes: [],
      indexable_count: 1,
      blocked_count: 0,
      at_risk_count: 0,
      created_at: '2026-09-07T12:00:00.000Z',
    }
    const result = reconstructIndexDiagnosisFromRow(row)
    expect(result.htmlByUrl).toBeUndefined()
    expect(result.verdict.headline).toBe('Mostly indexable')

    const payload = buildSavedAuditPayload({
      domain: 'example.com',
      diagnosis: { row, result },
      linkGraph: {
        audit: {
          id: 'lg-1',
          created_at: '2026-09-07T12:05:00.000Z',
          verdict_headline: '2 critical link issues',
          top_causes: [],
          js_suspected: false,
          trailing_slash_convention: true,
        },
        findingCount: 2,
        criticalCount: 2,
        failCount: 0,
        warnCount: 0,
        topFindings: [{ rule_id: 'L01', severity: 'CRITICAL' }],
      },
      tablesMissing: false,
    })

    expect(payload.saved).toBe(true)
    expect(payload.tablesMissing).toBe(false)
    expect(payload.indexDiagnosisRunId).toBe('diag-1')
    expect(payload.indexDiagnosis?.ranAt).toBe('2026-09-07T12:00:00.000Z')
    expect(payload.linkGraph?.auditId).toBe('lg-1')
    expect(payload.linkGraph?.summary.criticalCount).toBe(2)
    expect(payload.linkGraph?.summary.verdictHeadline).toBe('2 critical link issues')
  })

  it('flags empty result with tablesMissing when migrations were never applied', () => {
    const payload = buildSavedAuditPayload({
      domain: 'example.com',
      diagnosis: null,
      linkGraph: null,
      tablesMissing: true,
    })
    expect(payload.saved).toBe(false)
    expect(payload.tablesMissing).toBe(true)
    expect(payload.indexDiagnosis).toBeNull()
    expect(payload.linkGraph).toBeNull()
  })
})
