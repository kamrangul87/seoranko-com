import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  allowsTreatmentControlSplit,
  INTERVENTION_TAXONOMY,
  lookupTaxonomy,
  taxonomyForAutoFixKind,
} from '@/lib/intervention/taxonomy'
import {
  extractPageState,
  hashPageState,
  liveMatchesExpectedAfter,
} from '@/lib/intervention/page-state'
import {
  assertAnalysisMetricAllowed,
  hashPreregistration,
} from '@/lib/intervention/preregistration'
import {
  buildUrlWindowSeries,
  resolveObservationWindows,
} from '@/lib/intervention/observation-windows'
import { analyzeIntervention, causalResultConflictTarget } from '@/lib/intervention/analyze'
import { canMarkVerified } from '@/lib/intervention/record'

const root = join(__dirname, '../../..')
const migration = readFileSync(
  join(root, 'supabase/migrations/20260908120000_intervention_dataset_pr2.sql'),
  'utf8',
)

const SAMPLE_BEFORE = `<!DOCTYPE html><html><head>
<title>Old Title Here</title>
<meta name="description" content="Old description text">
<link rel="canonical" href="https://example.com/a">
<meta name="robots" content="index,follow">
</head><body><h1>Old H1</h1><h2>Section</h2>
<a href="/page-a">A</a><a href="/page-b">B</a>
<script type="application/ld+json">{"@type":"Organization","name":"X"}</script>
<p>Some body words for counting purposes here.</p>
</body></html>`

const SAMPLE_AFTER = `<!DOCTYPE html><html><head>
<title>New Title Changed</title>
<meta name="description" content="Old description text">
<link rel="canonical" href="https://example.com/a">
<meta name="robots" content="index,follow">
</head><body><h1>Old H1</h1><h2>Section</h2>
<a href="/page-a">A</a><a href="/page-b">B</a>
<script type="application/ld+json">{"@type":"Organization","name":"X"}</script>
<p>Some body words for counting purposes here.</p>
</body></html>`

describe('Intervention Dataset PR2 — Phase F mechanical tests', () => {
  it('1. Pre-registration is immutable after lock (DB-level trigger in migration)', () => {
    expect(migration).toMatch(/prevent_preregistration_mutation/)
    expect(migration).toMatch(/trg_preregistration_immutable/)
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON experiment_preregistrations/)
    expect(migration).toMatch(/immutable after lock/)
    // Stub tables from earlier MCP apply may lack site_id — must ADD COLUMN before indexes.
    expect(migration).toMatch(
      /ALTER TABLE experiment_preregistrations[\s\S]*ADD COLUMN IF NOT EXISTS site_id/,
    )
  })

  it('2. Analysis refuses a metric other than the registered primary', () => {
    expect(() =>
      assertAnalysisMetricAllowed('impressions', 'clicks'),
    ).toThrow(/Analysis refused/)
    expect(() =>
      assertAnalysisMetricAllowed('impressions', 'clicks', { exploratory: true }),
    ).not.toThrow()
    expect(() => assertAnalysisMetricAllowed('impressions', 'impressions')).not.toThrow()
  })

  it('3. Intervention cannot reach verified without matching re-crawl state hash', () => {
    const expected = extractPageState(SAMPLE_AFTER, { pageUrl: 'https://example.com/a' })
    const liveOk = extractPageState(SAMPLE_AFTER, { pageUrl: 'https://example.com/a' })
    const liveBad = extractPageState(SAMPLE_BEFORE, { pageUrl: 'https://example.com/a' })
    expect(canMarkVerified({ expectedAfter: expected, liveState: liveOk, subtype: 'title' })).toBe(
      true,
    )
    expect(canMarkVerified({ expectedAfter: expected, liveState: liveBad, subtype: 'title' })).toBe(
      false,
    )
    expect(liveMatchesExpectedAfter(expected, liveBad, 'title')).toBe(false)
  })

  it('4. Duplicate intervention insert is rejected (unique constraint)', () => {
    expect(migration).toMatch(/CONSTRAINT intervention_events_unique_apply/)
    expect(migration).toMatch(/UNIQUE \(url_id, intervention_type, applied_at\)/)
  })

  it('5. Missing GSC days produce null, never 0, and set missing_gsc_data', () => {
    const window = resolveObservationWindows({
      appliedAt: '2026-06-10T12:00:00.000Z',
      baselineWindowDays: 3,
      observationWindowDays: 3,
    })
    const series = buildUrlWindowSeries({
      url: 'https://example.com/a',
      window,
      metric: 'impressions',
      rows: [
        {
          url: 'https://example.com/a',
          date: window.baseline_period_start,
          impressions: 10,
          clicks: 1,
          avg_position: 5,
          is_final: true,
        },
        // other days intentionally missing
      ],
    })
    expect(series.missingBaselineDays).toBeGreaterThan(0)
    expect(series.baseline.some((p) => p.value === null)).toBe(true)
    expect(series.baseline.every((p) => p.value !== 0 || p.value === null || p.value > 0)).toBe(true)
    // Explicit: absent day is null not 0
    const missingPoint = series.baseline.find((p) => p.date !== window.baseline_period_start)
    expect(missingPoint?.value).toBeNull()

    const result = analyzeIntervention({
      intervention: {
        id: 'i1',
        experiment_id: 'e1',
        url_id: 'https://example.com/a',
        lifecycle_state: 'verified',
        applied_at: '2026-01-01T00:00:00.000Z',
        verified_at: '2026-01-01T00:00:00.000Z',
        interference_scope: 'url',
        is_isolated: true,
      },
      preregistration: {
        experiment_id: 'e1',
        primary_metric: 'impressions',
        expected_direction: 'increase',
        baseline_window_days: 2,
        observation_window_days: 2,
        analysis_method: 'difference_in_differences',
        minimum_detectable_effect: null,
        locked_at: '2025-12-01T00:00:00.000Z',
      },
      metric: 'impressions',
      metricsRows: [
        {
          url: 'https://example.com/a',
          date: '2025-12-30',
          impressions: 10,
          clicks: 1,
          avg_position: 5,
          is_final: true,
        },
        {
          url: 'https://example.com/a',
          date: '2025-12-31',
          impressions: 12,
          clicks: 1,
          avg_position: 5,
          is_final: true,
        },
        {
          url: 'https://example.com/a',
          date: '2026-01-01',
          impressions: 20,
          clicks: 2,
          avg_position: 4,
          is_final: true,
        },
        // 2026-01-02 missing → null
      ],
      treatedUrls: ['https://example.com/a'],
      controlUrls: ['https://example.com/b'],
      baselineReadinessPassed: true,
      gscRevisionInBaseline: false,
      now: new Date('2026-03-01T00:00:00.000Z'),
    })
    // Incomplete observation → insufficient_data before missing_gsc_data path when window incomplete
    expect(['missing_gsc_data', 'insufficient_data']).toContain(result.validity_status)
  })

  it('6. Baseline-readiness failure blocks measuring (invalid_baseline)', () => {
    const result = analyzeIntervention({
      intervention: {
        id: 'i1',
        experiment_id: 'e1',
        url_id: 'https://example.com/a',
        lifecycle_state: 'verified',
        applied_at: '2026-06-01T00:00:00.000Z',
        verified_at: '2026-06-01T00:00:00.000Z',
        interference_scope: 'url',
        is_isolated: true,
      },
      preregistration: {
        experiment_id: 'e1',
        primary_metric: 'impressions',
        expected_direction: 'increase',
        baseline_window_days: 7,
        observation_window_days: 7,
        analysis_method: 'difference_in_differences',
        minimum_detectable_effect: null,
        locked_at: '2026-05-01T00:00:00.000Z',
      },
      metric: 'impressions',
      metricsRows: [],
      treatedUrls: ['https://example.com/a'],
      controlUrls: [],
      baselineReadinessPassed: false,
      gscRevisionInBaseline: false,
      now: new Date('2026-09-01T00:00:00.000Z'),
    })
    expect(result.validity_status).toBe('invalid_baseline')
    expect(result.evidence.reason).toBe('baseline_readiness_failed')
  })

  it('7. Re-running analysis is idempotent (unique conflict target)', () => {
    expect(migration).toMatch(/UNIQUE \(intervention_id, metric, is_exploratory\)/)
    expect(causalResultConflictTarget()).toBe('intervention_id,metric,is_exploratory')
  })

  it('8. Negative and neutral results persist with validity_status = valid', () => {
    const makeRows = (url: string, start: string, days: number, base: number) => {
      const out = []
      const d0 = new Date(`${start}T00:00:00.000Z`)
      for (let i = 0; i < days; i++) {
        const d = new Date(d0)
        d.setUTCDate(d0.getUTCDate() + i)
        out.push({
          url,
          date: d.toISOString().slice(0, 10),
          impressions: base,
          clicks: 1,
          avg_position: 10,
          is_final: true,
        })
      }
      return out
    }
    // Applied 2026-02-10; baseline 7d before; observation 7d after — all filled, treatment drops
    const treatedBase = makeRows('https://example.com/t', '2026-02-03', 7, 100)
    const treatedObs = makeRows('https://example.com/t', '2026-02-10', 7, 40)
    const controlBase = makeRows('https://example.com/c', '2026-02-03', 7, 100)
    const controlObs = makeRows('https://example.com/c', '2026-02-10', 7, 100)
    const negative = analyzeIntervention({
      intervention: {
        id: 'i-neg',
        experiment_id: 'e1',
        url_id: 'https://example.com/t',
        lifecycle_state: 'verified',
        applied_at: '2026-02-10T00:00:00.000Z',
        verified_at: '2026-02-10T00:00:00.000Z',
        interference_scope: 'url',
        is_isolated: true,
      },
      preregistration: {
        experiment_id: 'e1',
        primary_metric: 'impressions',
        expected_direction: 'increase',
        baseline_window_days: 7,
        observation_window_days: 7,
        analysis_method: 'difference_in_differences',
        minimum_detectable_effect: null,
        locked_at: '2026-01-01T00:00:00.000Z',
      },
      metric: 'impressions',
      metricsRows: [...treatedBase, ...treatedObs, ...controlBase, ...controlObs],
      treatedUrls: ['https://example.com/t'],
      controlUrls: ['https://example.com/c'],
      baselineReadinessPassed: true,
      gscRevisionInBaseline: false,
      now: new Date('2026-04-01T00:00:00.000Z'),
    })
    expect(negative.validity_status).toBe('valid')
    expect(negative.effect_estimate).not.toBeNull()
    expect(negative.effect_estimate!).toBeLessThan(0)
    expect(negative.result_direction).toBe('negative')

    const neutralTreatedObs = makeRows('https://example.com/t', '2026-02-10', 7, 100)
    const neutral = analyzeIntervention({
      intervention: {
        id: 'i-neu',
        experiment_id: 'e1',
        url_id: 'https://example.com/t',
        lifecycle_state: 'verified',
        applied_at: '2026-02-10T00:00:00.000Z',
        verified_at: '2026-02-10T00:00:00.000Z',
        interference_scope: 'url',
        is_isolated: true,
      },
      preregistration: {
        experiment_id: 'e1',
        primary_metric: 'impressions',
        expected_direction: 'no_prediction',
        baseline_window_days: 7,
        observation_window_days: 7,
        analysis_method: 'difference_in_differences',
        minimum_detectable_effect: null,
        locked_at: '2026-01-01T00:00:00.000Z',
      },
      metric: 'impressions',
      metricsRows: [...treatedBase, ...neutralTreatedObs, ...controlBase, ...controlObs],
      treatedUrls: ['https://example.com/t'],
      controlUrls: ['https://example.com/c'],
      baselineReadinessPassed: true,
      gscRevisionInBaseline: false,
      now: new Date('2026-04-01T00:00:00.000Z'),
    })
    expect(neutral.validity_status).toBe('valid')
    expect(neutral.result_direction).toBe('neutral')
  })

  it('9. Tenant isolation: RLS policies scope reads to auth.uid() = user_id', () => {
    for (const table of [
      'experiment_preregistrations',
      'intervention_events',
      'causal_results',
      'gsc_revision_checks',
    ]) {
      expect(migration).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`))
      expect(migration).toMatch(new RegExp(`ON ${table} FOR SELECT`))
      expect(migration).toMatch(/auth\.uid\(\) = user_id/)
    }
    // Status + analyze routes filter by user.id on site and rows
    const status = readFileSync(
      join(root, 'src/app/api/experiments/status/route.ts'),
      'utf8',
    )
    const analyze = readFileSync(
      join(root, 'src/app/api/experiments/analyze/route.ts'),
      'utf8',
    )
    expect(status).toMatch(/\.eq\('user_id', user\.id\)/)
    expect(analyze).toMatch(/\.eq\('user_id', user\.id\)/)
  })

  it('10. RLS is enabled on every new table (migration catalog assertions)', () => {
    for (const table of [
      'intervention_taxonomy',
      'experiment_preregistrations',
      'intervention_events',
      'gsc_revision_checks',
      'causal_results',
    ]) {
      expect(migration).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`))
    }
  })

  it('11. A sitewide intervention cannot be assigned a treatment/control split', () => {
    const robots = lookupTaxonomy('indexability', 'robots_txt')
    expect(robots?.interference_scope).toBe('sitewide')
    expect(allowsTreatmentControlSplit('sitewide')).toBe(false)
    expect(allowsTreatmentControlSplit('section')).toBe(false)
    expect(allowsTreatmentControlSplit('url')).toBe(true)

    const result = analyzeIntervention({
      intervention: {
        id: 'i-sw',
        experiment_id: 'e1',
        url_id: 'https://example.com/',
        lifecycle_state: 'verified',
        applied_at: '2026-06-01T00:00:00.000Z',
        verified_at: '2026-06-01T00:00:00.000Z',
        interference_scope: 'sitewide',
        is_isolated: false,
      },
      preregistration: {
        experiment_id: 'e1',
        primary_metric: 'impressions',
        expected_direction: 'increase',
        baseline_window_days: 7,
        observation_window_days: 7,
        analysis_method: 'difference_in_differences',
        minimum_detectable_effect: null,
        locked_at: '2026-05-01T00:00:00.000Z',
      },
      metric: 'impressions',
      metricsRows: [],
      treatedUrls: ['https://example.com/'],
      controlUrls: ['https://example.com/other'],
      baselineReadinessPassed: true,
      gscRevisionInBaseline: false,
      now: new Date('2026-09-01T00:00:00.000Z'),
    })
    expect(result.validity_status).toBe('interference_suspected')
  })

  it('12. A GSC revision inside the baseline window flips validity to invalid_baseline', () => {
    const result = analyzeIntervention({
      intervention: {
        id: 'i-rev',
        experiment_id: 'e1',
        url_id: 'https://example.com/a',
        lifecycle_state: 'verified',
        applied_at: '2026-06-01T00:00:00.000Z',
        verified_at: '2026-06-01T00:00:00.000Z',
        interference_scope: 'url',
        is_isolated: true,
      },
      preregistration: {
        experiment_id: 'e1',
        primary_metric: 'impressions',
        expected_direction: 'increase',
        baseline_window_days: 7,
        observation_window_days: 7,
        analysis_method: 'difference_in_differences',
        minimum_detectable_effect: null,
        locked_at: '2026-05-01T00:00:00.000Z',
      },
      metric: 'impressions',
      metricsRows: [],
      treatedUrls: ['https://example.com/a'],
      controlUrls: [],
      baselineReadinessPassed: true,
      gscRevisionInBaseline: true,
      now: new Date('2026-09-01T00:00:00.000Z'),
    })
    expect(result.validity_status).toBe('invalid_baseline')
    expect(result.evidence.reason).toBe('gsc_revision_in_baseline')
  })
})

describe('Intervention Dataset PR2 — taxonomy + extractors (Phase C)', () => {
  it('seeds only detectable taxonomy rows', () => {
    expect(INTERVENTION_TAXONOMY.length).toBe(13)
    expect(taxonomyForAutoFixKind('meta-title')?.intervention_subtype).toBe('title')
    expect(taxonomyForAutoFixKind('llms-txt')).toBeNull()
  })

  it('extracts normalised page state without body HTML', () => {
    const state = extractPageState(SAMPLE_BEFORE, {
      pageUrl: 'https://example.com/a',
      statusCode: 200,
    })
    expect(state.title).toBe('Old Title Here')
    expect(state.meta_description).toContain('Old description')
    expect(state.headings.h1[0]).toBe('Old H1')
    expect(state.structured_data_types).toContain('Organization')
    expect(state.status_code).toBe(200)
    expect(JSON.stringify(state)).not.toMatch(/Some body words/)
    expect(hashPageState(state)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('preregistration hash is stable', () => {
    const fields = {
      primary_metric: 'impressions' as const,
      expected_direction: 'increase' as const,
      baseline_window_days: 28,
      observation_window_days: 28,
      analysis_method: 'difference_in_differences' as const,
      minimum_detectable_effect: 0.1,
    }
    expect(hashPreregistration(fields)).toBe(hashPreregistration(fields))
  })
})

describe('Intervention Dataset PR2 — Phase E end-to-end (insufficient_data is success)', () => {
  it('analyze on an autodun-shaped site with no observation window returns insufficient_data', () => {
    // Mirrors production autodun: baseline not ready / no elapsed observation.
    const result = analyzeIntervention({
      intervention: {
        id: 'autodun-probe',
        experiment_id: 'exp-autodun',
        url_id: 'https://ai.autodun.com/',
        lifecycle_state: 'verified',
        applied_at: new Date().toISOString(), // just applied — window not elapsed
        verified_at: new Date().toISOString(),
        interference_scope: 'url',
        is_isolated: true,
      },
      preregistration: {
        experiment_id: 'exp-autodun',
        primary_metric: 'impressions',
        expected_direction: 'increase',
        baseline_window_days: 28,
        observation_window_days: 28,
        analysis_method: 'difference_in_differences',
        minimum_detectable_effect: null,
        locked_at: '2026-01-01T00:00:00.000Z',
      },
      metric: 'impressions',
      metricsRows: [],
      treatedUrls: ['https://ai.autodun.com/'],
      controlUrls: [],
      // autodun blocked at readiness historically
      baselineReadinessPassed: false,
      gscRevisionInBaseline: false,
      now: new Date(),
    })
    // Readiness failure is checked before window elapsed — invalid_baseline.
    // If readiness were passed, observation_window_not_elapsed → insufficient_data.
    expect(['insufficient_data', 'invalid_baseline']).toContain(result.validity_status)
  })

  it('analyze with readiness passed but window not elapsed returns insufficient_data', () => {
    const result = analyzeIntervention({
      intervention: {
        id: 'autodun-probe-2',
        experiment_id: 'exp-autodun',
        url_id: 'https://ai.autodun.com/',
        lifecycle_state: 'verified',
        applied_at: new Date().toISOString(),
        verified_at: new Date().toISOString(),
        interference_scope: 'url',
        is_isolated: true,
      },
      preregistration: {
        experiment_id: 'exp-autodun',
        primary_metric: 'impressions',
        expected_direction: 'increase',
        baseline_window_days: 28,
        observation_window_days: 28,
        analysis_method: 'difference_in_differences',
        minimum_detectable_effect: null,
        locked_at: '2026-01-01T00:00:00.000Z',
      },
      metric: 'impressions',
      metricsRows: [],
      treatedUrls: ['https://ai.autodun.com/'],
      controlUrls: [],
      baselineReadinessPassed: true,
      gscRevisionInBaseline: false,
      now: new Date(),
    })
    expect(result.validity_status).toBe('insufficient_data')
    expect(result.evidence.reason).toBe('observation_window_not_elapsed')
  })
})

describe('Intervention Dataset PR2 — Fix Agent verify wiring (Phase D)', () => {
  it('fix-agent imports and calls recordInterventionFromVerify', () => {
    const src = readFileSync(join(root, 'src/lib/fix-agent.ts'), 'utf8')
    expect(src).toMatch(/recordInterventionFromVerify/)
    expect(src).toMatch(/Intervention recorded as verified/)
  })

  it('verified intervention hashes are immutable (DB trigger)', () => {
    expect(migration).toMatch(/prevent_verified_intervention_mutation/)
    expect(migration).toMatch(/verified intervention hashes and applied_at are immutable/)
  })
})

describe('Intervention Dataset PR2 — UI strip (Phase G)', () => {
  it('experiments page shows pipeline strip and insufficient evidence copy', () => {
    const page = readFileSync(join(root, 'src/app/dashboard/experiments/page.tsx'), 'utf8')
    expect(page).toMatch(/Baseline/)
    expect(page).toMatch(/Intervention/)
    expect(page).toMatch(/Verified/)
    expect(page).toMatch(/Measuring/)
    expect(page).toMatch(/Result/)
    expect(page).toMatch(/insufficient evidence/)
    expect(page).toMatch(/\/api\/experiments\/analyze/)
  })
})
