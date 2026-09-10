import { describe, expect, it } from 'vitest'
import {
  BANNED_RANKING_CLAIM_RE,
  computeInspectionDeltas,
  googleLooksIndexed,
  googleRobotsAllows,
} from './inspection-deltas'
import {
  computeCanonicalMismatch,
  normalizeInspectionCanonical,
  parseInspectionResult,
  remainingInspectionBudget,
  GSC_INSPECTION_BATCH_CAP,
  GSC_INSPECTION_DAILY_QUOTA,
  GSC_INSPECTION_DAILY_RESERVE,
  GSC_INSPECTION_DEADLINE_MS,
  GSC_INSPECTION_SOFT_CAP,
} from './url-inspection'
import { buildGscInspectionFixAgentIssues } from './inspection-fix-issues'
import { classifyAuditIssue } from '@/lib/fix-agent-classification'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('canonical normalization (Phase B spec)', () => {
  it('lowercases scheme+host only; preserves path/query case; strips fragment; no trailing-slash collapse', () => {
    expect(normalizeInspectionCanonical('HTTPS://Example.COM/Path/Page?Q=A#frag')).toBe(
      'https://example.com/Path/Page?Q=A',
    )
    expect(normalizeInspectionCanonical('https://example.com/a/')).toBe('https://example.com/a/')
    expect(normalizeInspectionCanonical('https://example.com/a')).toBe('https://example.com/a')
    expect(
      normalizeInspectionCanonical('https://example.com/a/') ===
        normalizeInspectionCanonical('https://example.com/a'),
    ).toBe(false)
  })

  it('strips default ports', () => {
    expect(normalizeInspectionCanonical('https://example.com:443/x')).toBe('https://example.com/x')
    expect(normalizeInspectionCanonical('http://example.com:80/x')).toBe('http://example.com/x')
  })

  it('canonical mismatch uses normalizeInspectionCanonical (not full-URL lowercase)', () => {
    expect(
      computeCanonicalMismatch('https://Example.com/Path', 'https://example.com/Path'),
    ).toBe(false)
    expect(
      computeCanonicalMismatch('https://example.com/Path', 'https://example.com/path'),
    ).toBe(true)
    expect(
      computeCanonicalMismatch('https://example.com/a/', 'https://example.com/a'),
    ).toBe(true)
  })
})

describe('GSC URL Inspection parse + budget', () => {
  it('parses indexStatusResult + rich results + crawledAs', () => {
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
          crawledAs: 'MOBILE',
          sitemap: ['https://example.com/sitemap.xml'],
          referringUrls: ['https://example.com/'],
        },
        richResultsResult: { verdict: 'PASS', detectedItems: [] },
      },
    })
    expect(parsed.coverageState).toBe('URL is unknown to Google')
    expect(parsed.crawledAs).toBe('MOBILE')
    expect(parsed.sitemap).toEqual(['https://example.com/sitemap.xml'])
    expect(parsed.referringUrlsExhaustive).toBe(false)
    expect(parsed.richResultsVerdict).toBe('PASS')
    expect(computeCanonicalMismatch(parsed.userCanonical, parsed.googleCanonical)).toBe(true)
  })

  it('remaining budget respects soft cap / daily reserve; Hobby constants', () => {
    expect(remainingInspectionBudget(0)).toBe(GSC_INSPECTION_SOFT_CAP)
    expect(GSC_INSPECTION_SOFT_CAP).toBe(
      GSC_INSPECTION_DAILY_QUOTA - GSC_INSPECTION_DAILY_RESERVE,
    )
    expect(GSC_INSPECTION_BATCH_CAP).toBe(40)
    expect(GSC_INSPECTION_DEADLINE_MS).toBe(50_000)
    expect(remainingInspectionBudget(GSC_INSPECTION_SOFT_CAP)).toBe(0)
  })
})

describe('enum-primary googleLooksIndexed', () => {
  it('uses verdict PASS; ignores coverageState prose', () => {
    expect(
      googleLooksIndexed({
        coverageState: 'Submitted and indexed',
        indexingState: null,
        verdict: 'PASS',
      }),
    ).toBe(true)
    expect(
      googleLooksIndexed({
        coverageState: 'Submitted and indexed',
        indexingState: null,
        verdict: 'NEUTRAL',
      }),
    ).toBe(false)
    expect(
      googleLooksIndexed({
        coverageState: 'Submitted and indexed',
        indexingState: 'BLOCKED_BY_META_TAG',
        verdict: 'PASS',
      }),
    ).toBe(false)
  })
})

describe('GSC Index Insights deltas (mechanical)', () => {
  it('flags crawl indexable vs Google not indexed + no successful crawl recorded', () => {
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
    expect(deltas.some((d) => d.reason === 'no_successful_google_crawl_recorded')).toBe(true)
    const notIndexed = deltas.find((d) => d.reason === 'crawl_indexable_google_not_indexed')!
    expect(notIndexed.explanation).not.toMatch(BANNED_RANKING_CLAIM_RE)
    expect(notIndexed.fixAgentKind).toBeNull()
    expect(notIndexed.humanTaskKind).toBe('gsc-not-indexed')
  })

  it('flags crawl_blocked_google_indexed', () => {
    const deltas = computeInspectionDeltas(
      { ourVerdict: 'BLOCKED', ourRobotsBlocked: true, inSitemap: false },
      {
        coverageState: 'Submitted and indexed',
        robotsTxtState: 'ALLOWED',
        indexingState: 'INDEXING_ALLOWED',
        googleCanonical: 'https://example.com/x',
        userCanonical: 'https://example.com/x',
        canonicalMismatch: false,
        lastCrawlTime: '2026-09-01T00:00:00Z',
        pageFetchState: 'SUCCESSFUL',
        verdict: 'PASS',
      },
    )
    expect(deltas.some((d) => d.reason === 'crawl_blocked_google_indexed')).toBe(true)
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
  })

  it('flags robots state conflict', () => {
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

  it('emits google_not_recrawled_since_fix from verified_at vs lastCrawlTime', () => {
    const deltas = computeInspectionDeltas(
      { ourVerdict: 'INDEXABLE', ourRobotsBlocked: false, inSitemap: true },
      {
        coverageState: 'Submitted and indexed',
        robotsTxtState: 'ALLOWED',
        indexingState: 'INDEXING_ALLOWED',
        googleCanonical: 'https://example.com/',
        userCanonical: 'https://example.com/',
        canonicalMismatch: false,
        lastCrawlTime: '2026-09-01T00:00:00Z',
        pageFetchState: 'SUCCESSFUL',
        verdict: 'PASS',
      },
      {
        verifiedIntervention: {
          id: 'd28e07fb-0000-0000-0000-000000000001',
          verifiedAt: '2026-09-08T12:00:00Z',
        },
      },
    )
    const d = deltas.find((x) => x.reason === 'google_not_recrawled_since_fix')!
    expect(d).toBeTruthy()
    expect(d.evidence.intervention_id).toBe('d28e07fb-0000-0000-0000-000000000001')
    expect(d.humanTaskKind).toBe('gsc-post-fix-recrawl')
    expect(d.explanation).not.toMatch(BANNED_RANKING_CLAIM_RE)
  })

  it('does not emit post-fix delta when Google crawled after verified_at', () => {
    const deltas = computeInspectionDeltas(
      { ourVerdict: 'INDEXABLE', ourRobotsBlocked: false, inSitemap: true },
      {
        coverageState: null,
        robotsTxtState: 'ALLOWED',
        indexingState: 'INDEXING_ALLOWED',
        googleCanonical: null,
        userCanonical: null,
        canonicalMismatch: false,
        lastCrawlTime: '2026-09-09T00:00:00Z',
        pageFetchState: 'SUCCESSFUL',
        verdict: 'PASS',
      },
      {
        verifiedIntervention: {
          id: 'x',
          verifiedAt: '2026-09-08T12:00:00Z',
        },
      },
    )
    expect(deltas.some((d) => d.reason === 'google_not_recrawled_since_fix')).toBe(false)
  })

  it('emits historical_transition when indexed state flips', () => {
    const deltas = computeInspectionDeltas(
      { ourVerdict: 'INDEXABLE', ourRobotsBlocked: false, inSitemap: true },
      {
        coverageState: null,
        robotsTxtState: 'ALLOWED',
        indexingState: 'INDEXING_ALLOWED',
        googleCanonical: 'https://example.com/',
        userCanonical: 'https://example.com/',
        canonicalMismatch: false,
        lastCrawlTime: '2026-09-09T00:00:00Z',
        pageFetchState: 'SUCCESSFUL',
        verdict: 'PASS',
      },
      {
        previous: {
          id: 'prev-1',
          inspectedAt: '2026-09-01T00:00:00Z',
          verdict: 'NEUTRAL',
          indexingState: null,
          googleCanonical: 'https://example.com/',
          pageFetchState: 'SUCCESSFUL',
          robotsTxtState: 'ALLOWED',
        },
      },
    )
    expect(deltas.some((d) => d.reason === 'historical_transition')).toBe(true)
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
      {
        url: 'https://example.com/',
        deltas: [
          {
            reason: 'google_not_recrawled_since_fix',
            explanation: 'no crawl since fix',
            evidence: { intervention_id: 'i1' },
            fixAgentKind: null,
            humanTaskKind: 'gsc-post-fix-recrawl',
          },
        ],
      },
    ])
    const canon = issues.find((i) => i.fixMetadata?.kind === 'redirect-canonical')!
    expect(classifyAuditIssue(canon, { connectionType: 'github' }).autoKind).toBe(
      'redirect-canonical',
    )
    const human = issues.find((i) => i.fixMetadata?.kind === 'gsc-human-delta')!
    expect(classifyAuditIssue(human).fixability).toBe('human')
    const postFix = issues.find((i) =>
      (i.fixMetadata?.evidence || '').startsWith('gsc-post-fix-recrawl'),
    )!
    expect(classifyAuditIssue(postFix).humanKind).toBe('gsc-post-fix-recrawl')
  })
})

describe('GSC Index Insights wiring + banned UI phrases', () => {
  const root = join(__dirname, '../../..')

  it('ships Phase A + Phase B migrations with RLS and quota RPC', () => {
    const a = readFileSync(
      join(root, 'supabase/migrations/20260909120000_gsc_url_inspections.sql'),
      'utf8',
    )
    const b = readFileSync(
      join(root, 'supabase/migrations/20260909140000_gsc_index_insights_phase_b.sql'),
      'utf8',
    )
    expect(a).toMatch(/CREATE TABLE IF NOT EXISTS gsc_url_inspections/)
    expect(a).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(b).toMatch(/reserve_gsc_inspection_quota/)
    expect(b).toMatch(/record_gsc_inspection_quota_outcome/)
    expect(b).toMatch(/gsc_inspection_deferred/)
    expect(b).toMatch(/FOR UPDATE/)
    expect(b).toMatch(/intervention_id/)
    expect(b).toMatch(/Read-only w\.r\.t\. that table/)
  })

  it('daily cron runs inspections after metrics sync; Hobby maxDuration 60', () => {
    const cron = readFileSync(join(root, 'src/app/api/cron/gsc-sync/route.ts'), 'utf8')
    const vercel = readFileSync(join(root, 'vercel.json'), 'utf8')
    expect(cron).toMatch(/syncAllUrlInspections/)
    expect(cron).toMatch(/syncAllActiveGscConnections/)
    expect(vercel).toMatch(/"maxDuration": 60/)
    expect(vercel).toMatch(/gsc-sync/)
  })

  it('Index Diagnosis panel uses Phase B wording; no ranking-cause claims', () => {
    const panel = readFileSync(join(root, 'src/components/IndexDiagnosisPanel.tsx'), 'utf8')
    expect(panel).toMatch(/Our current crawl/)
    expect(panel).toMatch(/Google&apos;s last recorded view|Google's last recorded view/)
    expect(panel).toMatch(/Observed difference/)
    expect(panel).toMatch(/\/api\/gsc\/inspections/)
    expect(panel).toMatch(/Not a ranking explanation/)
    expect(panel).not.toMatch(BANNED_RANKING_CLAIM_RE)
  })

  it('scheduler stays read-only for intervention lifecycle / causal_results', () => {
    const sched = readFileSync(join(root, 'src/lib/gsc/inspection-scheduler.ts'), 'utf8')
    expect(sched).toMatch(/intervention_events/)
    expect(sched).toMatch(/verified_at/)
    expect(sched).toMatch(/reserve_gsc_inspection_quota/)
    expect(sched).not.toMatch(/\.from\(['"]causal_results['"]\)\.(insert|update|upsert)/)
    expect(sched).not.toMatch(/lifecycle_state:\s*['"]verified['"]/)
    expect(sched).toMatch(/index_diagnosis_runs/)
    expect(sched).toMatch(/\.eq\(['"]domain['"]/)
  })

  it('empty inspection queue returns before reserveQuota and writes last_error', () => {
    const sched = readFileSync(join(root, 'src/lib/gsc/inspection-scheduler.ts'), 'utf8')
    expect(sched).toMatch(/inspection_queue_empty/)
    expect(sched).toMatch(/formatInspectionLastError/)
    expect(sched).toMatch(/quota_day/)
    const queueIdx = sched.indexOf('buildInspectionQueue')
    const emptyIdx = sched.indexOf("stoppedReason = 'empty'")
    const reserveIdx = sched.indexOf('await reserveQuota')
    expect(queueIdx).toBeGreaterThan(-1)
    expect(emptyIdx).toBeGreaterThan(queueIdx)
    expect(reserveIdx).toBeGreaterThan(emptyIdx)
  })

  it('syncAllUrlInspections orders gsc_connections by last_sync_at (column exists; updated_at does not)', () => {
    const sched = readFileSync(join(root, 'src/lib/gsc/inspection-scheduler.ts'), 'utf8')
    const mig = readFileSync(
      join(root, 'supabase/migrations/20260907120000_causal_experiment_engine_pr1.sql'),
      'utf8',
    )
    const syncAll = sched.slice(sched.indexOf('export async function syncAllUrlInspections'))
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS gsc_connections/)
    expect(mig).toMatch(/last_sync_at/)
    expect(mig).not.toMatch(/updated_at/)
    expect(syncAll).toMatch(/\.order\(\s*['"]last_sync_at['"]/)
    expect(syncAll).not.toMatch(/\.order\(\s*['"]updated_at['"]/)
  })

  it('metrics queue source has no date lookback (GSC reporting lag safe)', () => {
    const sched = readFileSync(join(root, 'src/lib/gsc/inspection-scheduler.ts'), 'utf8')
    const metricsStart = sched.indexOf(".from('url_metrics_daily')")
    const metricsEnd = sched.indexOf('for (const row of metricRows', metricsStart)
    expect(metricsStart).toBeGreaterThan(-1)
    expect(metricsEnd).toBeGreaterThan(metricsStart)
    const metricsQuery = sched.slice(metricsStart, metricsEnd)
    expect(metricsQuery).toMatch(/\.eq\(\s*['"]site_id['"]/)
    expect(metricsQuery).toMatch(/\.gt\(\s*['"]impressions['"]\s*,\s*0\s*\)/)
    expect(metricsQuery).not.toMatch(/['"]date['"]/)
    expect(metricsQuery).not.toMatch(/setUTCDate|Date\.now|CURRENT_DATE/)
  })
})

describe('formatInspectionLastError', () => {
  it('includes reason and ISO timestamp', async () => {
    const { formatInspectionLastError } = await import('./inspection-scheduler')
    const msg = formatInspectionLastError({
      reason: 'no candidate URLs',
      detail: 'queueLen=0',
      at: new Date('2026-09-10T12:00:00.000Z'),
    })
    expect(msg).toContain('URL Inspection: no candidate URLs.')
    expect(msg).toContain('queueLen=0')
    expect(msg).toContain('2026-09-10T12:00:00.000Z')
  })
})
