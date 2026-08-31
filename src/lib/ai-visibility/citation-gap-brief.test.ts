import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { generateContentBrief } from '../content-brief-generator'
import {
  applyCitationGapToBrief,
  canFixCitationGap,
  citationGapBadgeText,
} from './citation-gap-brief'

const comparedDiagnostic = {
  status: 'compared' as const,
  finding: 'Another site was cited for this query. Their page has FAQ schema and a direct answer in the first paragraph. Your equivalent page is missing those.',
  gaps: ['FAQ schema', 'direct answer in the first paragraph'],
}

describe('canFixCitationGap', () => {
  it('is true only for a real compared diagnostic with named gaps', () => {
    expect(canFixCitationGap(false, comparedDiagnostic)).toBe(true)
  })

  it('is false for insufficient-data diagnostics even when a gap placeholder exists', () => {
    expect(
      canFixCitationGap(false, {
        status: 'insufficient_data',
        finding: 'Insufficient data to diagnose why — could not fetch both pages for comparison.',
        gaps: ['Not mentioned or cited'],
      }),
    ).toBe(false)
    expect(
      canFixCitationGap(false, {
        status: 'no_competitor',
        finding: 'No competitor sources were returned for this prompt — gap only; insufficient data to diagnose why.',
        gaps: ['Not mentioned or cited'],
      }),
    ).toBe(false)
    expect(
      canFixCitationGap(false, {
        status: 'compared',
        finding: 'Another site was cited. Compared pages did not show a clear gap — insufficient data to diagnose why.',
        gaps: [],
      }),
    ).toBe(false)
  })

  it('is false for cited rows, failed checks, and missing diagnostics', () => {
    expect(canFixCitationGap(true, comparedDiagnostic)).toBe(false)
    expect(canFixCitationGap(false, { status: 'check_failed', finding: 'OPENAI_API_KEY not configured', error: 'missing' })).toBe(false)
    expect(canFixCitationGap(false, null)).toBe(false)
  })
})

describe('applyCitationGapToBrief', () => {
  it('injects H2 guidance that names the missing FAQ and first-paragraph signals', async () => {
    const base = await generateContentBrief({
      seedKeyword: 'best EV charger installer UK',
      mode: 'content',
    })
    const withGap = applyCitationGapToBrief(base, {
      resultId: 'res-1',
      prompt: 'best EV charger installer UK',
      engine: 'perplexity',
      finding: comparedDiagnostic.finding,
      gaps: comparedDiagnostic.gaps,
    })
    const blob = JSON.stringify(withGap)
    expect(blob).toMatch(/FAQ schema|FAQPage/i)
    expect(blob).toMatch(/first 2-3 sentences/)
    expect(blob).toMatch(/specific gap that let a competitor get cited/)
    expect(blob).toMatch(/best EV charger installer UK/)
    expect(withGap.strategistNotes[0]).toMatch(/citation gap/)
  })
})

describe('generateContentBrief citation-gap pre-fill', () => {
  it('ordinary seed briefs are unchanged (no citation-gap copy)', async () => {
    const brief = await generateContentBrief({ seedKeyword: 'home EV charger installation', mode: 'content' })
    const blob = JSON.stringify(brief)
    expect(blob).not.toMatch(/specific gap that let a competitor/)
    expect(brief.sections.length).toBeGreaterThanOrEqual(3)
  })

  it('pre-filled gap briefs mechanically reference the detected signals', async () => {
    const brief = await generateContentBrief({
      seedKeyword: 'best EV charger installer UK',
      mode: 'content',
      citationGap: {
        resultId: 'res-1',
        prompt: 'best EV charger installer UK',
        engine: 'openai',
        finding: comparedDiagnostic.finding,
        gaps: comparedDiagnostic.gaps,
      },
    })
    const blob = JSON.stringify(brief)
    expect(blob).toMatch(/FAQPage|FAQ schema/i)
    expect(blob).toMatch(/first 2-3 sentences/)
    expect(blob).toMatch(/best EV charger installer UK/)
    expect(blob).toMatch(/specific gap that let a competitor get cited/)
  })
})

describe('citation gap badge + UI wiring', () => {
  it('badge names the prompt and engine, not a competitor domain', () => {
    const text = citationGapBadgeText('best widgets', 'perplexity')
    expect(text).toMatch(/best widgets/)
    expect(text).toMatch(/Perplexity/)
    expect(text).not.toMatch(/gov\.uk|zapmap|autodun\.com/i)
  })

  it('AI Visibility only offers Fix this gap through canFixCitationGap', () => {
    const src = readFileSync(join(__dirname, '../../app/dashboard/ai-visibility/page.tsx'), 'utf8')
    expect(src).toMatch(/canFixCitationGap/)
    expect(src).toMatch(/Fix this gap/)
    expect(src).toMatch(/aiVisibilityResultId/)
  })

  it('Briefs page shows the citation-gap badge when a brief was generated from a gap', () => {
    const src = readFileSync(join(__dirname, '../../app/dashboard/briefs/page.tsx'), 'utf8')
    expect(src).toMatch(/citationGap\?\.badge/)
    expect(src).toMatch(/Recent briefs/)
  })

  it('briefs are persisted with ai_visibility_result_id', () => {
    const api = readFileSync(join(__dirname, '../../app/api/copilot/brief/route.ts'), 'utf8')
    expect(api).toMatch(/ai_visibility_result_id/)
    expect(api).toMatch(/content_briefs/)
    expect(api).toMatch(/canFixCitationGap/)
    const mig = readFileSync(
      join(__dirname, '../../../supabase/migrations/20260831150000_content_briefs_citation_gap.sql'),
      'utf8',
    )
    expect(mig).toMatch(/ai_visibility_result_id UUID REFERENCES ai_visibility_results/)
  })
})
