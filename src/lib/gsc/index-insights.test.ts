import { describe, expect, it } from 'vitest'
import {
  computeInspectionDeltas,
  googleLooksIndexed,
  googleRobotsAllows,
} from './inspection-deltas'
import {
  computeCanonicalMismatch,
  parseInspectionResult,
  remainingInspectionBudget,
  GSC_INSPECTION_DAILY_QUOTA,
  GSC_INSPECTION_DAILY_RESERVE,
} from './url-inspection'
import { buildGscInspectionFixAgentIssues } from './inspection-fix-issues'
import { classifyAuditIssue } from '@/lib/fix-agent-classification'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('GSC URL Inspection parse + canonical', () => {
  it('parses indexStatusResult fields from API body', () => {
    const parsed = parseInspectionResult({
      inspectionResult: {
        indexStatusResult: {
          verdict: 'NEUTRAL',
          coverageState: 'URL is unknown to Google',
          robotsTxtState: 'ALLOWED',
          indexingState: 'INDEXING_STATE_UNSPECIFIED',
          googleCanonical: 'https://example.com/a',
          userCanonical: 'https://example.com/b',
          lastCrawlTime: null,
          pageFetchState: 'SUCCESSFUL',
        },
      },
    })
    expect(parsed.coverageState).toBe('URL is unknown to Google')
    expect(parsed.robotsTxtState).toBe('ALLOWED')
    expect(parsed.googleCanonical).toBe('https://example.com/a')
    expect(computeCanonicalMismatch(parsed.userCanonical, parsed.googleCanonical)).toBe(true)
  })

  it('remaining budget respects daily reserve', () => {
    expect(remainingInspectionBudget(0)).toBe(
      GSC_INSPECTION_DAILY_QUOTA - GSC_INSPECTION_DAILY_RESERVE,
    )
    expect(remainingInspectionBudget(GSC_INSPECTION_DAILY_QUOTA)).toBe(0)
    expect(remainingInspectionBudget(GSC_INSPECTION_DAILY_QUOTA - GSC_INSPECTION_DAILY_RESERVE)).toBe(
      0,
    )
  })
})

describe('GSC Index Insights deltas (mechanical)', () => {
  it('flags crawl indexable vs Google not indexed with honest copy', () => {
    const deltas = computeInspectionDeltas(
      { ourVerdict: 'INDEXABLE', ourRobotsBlocked: false, inSitemap: true },
      {
        coverageState: 'URL is unknown to Google',
        robotsTxtState: 'ALLOWED',
        indexingState: null,
        googleCanonical: 'https://example.com/',
        userCanonical: 'https://example.com/',
        canonicalMismatch: false,
        lastCrawlTime: null,
        pageFetchState: null,
        verdict: 'NEUTRAL',
      },
    )
    expect(deltas.some((d) => d.reason === 'crawl_indexable_google_not_indexed')).toBe(true)
    expect(deltas.some((d) => d.reason === 'sitemap_never_crawled')).toBe(true)
    const notIndexed = deltas.find((d) => d.reason === 'crawl_indexable_google_not_indexed')!
    expect(notIndexed.explanation).not.toMatch(/won't rank|will not rank|algorithm/i)
    expect(notIndexed.fixAgentKind).toBeNull()
    expect(notIndexed.humanTaskKind).toBe('gsc-not-indexed')
  })

  it('flags canonical mismatch and maps to redirect-canonical strategy', () => {
    const deltas = computeInspectionDeltas(
      { ourVerdict: 'AT_RISK', ourRobotsBlocked: false, inSitemap: false },
      {
        coverageState: 'Submitted and indexed',
        robotsTxtState: 'ALLOWED',
        indexingState: 'INDEXING_ALLOWED',
        googleCanonical: 'https://example.com/preferred',
        userCanonical: 'https://example.com/other',
        canonicalMismatch: true,
        lastCrawlTime: '2026-09-01T00:00:00Z',
        pageFetchState: 'SUCCESSFUL',
        verdict: 'PASS',
      },
    )
    const d = deltas.find((x) => x.reason === 'canonical_mismatch')!
    expect(d.fixAgentKind).toBe('redirect-canonical')
    expect(googleLooksIndexed({ coverageState: 'Submitted and indexed', indexingState: null, verdict: 'PASS' })).toBe(
      true,
    )
  })

  it('flags robots state conflict both directions', () => {
    expect(googleRobotsAllows('DISALLOWED')).toBe(false)
    const a = computeInspectionDeltas(
      { ourVerdict: 'BLOCKED', ourRobotsBlocked: true, inSitemap: false },
      {
        coverageState: null,
        robotsTxtState: 'ALLOWED',
        indexingState: null,
        googleCanonical: null,
        userCanonical: null,
        canonicalMismatch: false,
        lastCrawlTime: null,
        pageFetchState: null,
        verdict: null,
      },
    )
    expect(a.some((d) => d.reason === 'robots_state_conflict')).toBe(true)
  })
})

describe('GSC inspection → Fix Agent mapping', () => {
  it('canonical mismatch becomes redirect-canonical; not-indexed stays human', () => {
    const issues = buildGscInspectionFixAgentIssues([
      {
        url: 'https://example.com/a',
        user_canonical: 'https://example.com/a',
        google_canonical: 'https://example.com/b',
        deltas: [
          {
            reason: 'canonical_mismatch',
            explanation: 'canonicals differ',
            evidence: {},
            fixAgentKind: 'redirect-canonical',
            humanTaskKind: 'gsc-canonical-mismatch',
          },
        ],
      },
      {
        url: 'https://example.com/c',
        deltas: [
          {
            reason: 'crawl_indexable_google_not_indexed',
            explanation: 'not indexed',
            evidence: {},
            fixAgentKind: null,
            humanTaskKind: 'gsc-not-indexed',
          },
        ],
      },
    ])
    const canon = issues.find((i) => i.fixMetadata?.kind === 'redirect-canonical')!
    expect(classifyAuditIssue(canon, { connectionType: 'github' }).autoKind).toBe(
      'redirect-canonical',
    )
    const human = issues.find((i) => i.fixMetadata?.kind === 'gsc-human-delta')!
    const classified = classifyAuditIssue(human)
    expect(classified.fixability).toBe('human')
    expect(classified.humanKind).toBe('gsc-not-indexed')
  })
})

describe('GSC Index Insights wiring', () => {
  const root = join(__dirname, '../../..')

  it('ships migration with RLS and historical insert table', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/20260909120000_gsc_url_inspections.sql'),
      'utf8',
    )
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS gsc_url_inspections/)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/gsc_inspection_quota_usage/)
    expect(sql).toMatch(/Never overwrite/)
  })

  it('daily cron runs inspections after metrics sync', () => {
    const cron = readFileSync(join(root, 'src/app/api/cron/gsc-sync/route.ts'), 'utf8')
    expect(cron).toMatch(/syncAllUrlInspections/)
    expect(cron).toMatch(/syncAllActiveGscConnections/)
  })

  it('Index Diagnosis panel shows Google\'s view column', () => {
    const panel = readFileSync(join(root, 'src/components/IndexDiagnosisPanel.tsx'), 'utf8')
    expect(panel).toMatch(/Google&apos;s view|Google's view/)
    expect(panel).toMatch(/\/api\/gsc\/inspections/)
    expect(panel).toMatch(/Not a ranking explanation/)
  })
})
