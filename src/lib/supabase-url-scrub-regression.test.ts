import { describe, expect, it } from 'vitest'
import {
  assertImageUrlsPreserved,
  collectImageUrls,
  isSupabaseStorageUrl,
  transformHtmlTextNodes,
} from '@/lib/html-text-transform'
import { scrubInsertionCorruption, hasInsertionCorruption } from '@/lib/sentence-integrity'
import { qualityGateStageStatus, recomputeQualityGateTotals } from '@/lib/article-quality-gate'

const SUPABASE_HERO =
  'https://ddfboapzwclecbdjoqex.supabase.co/storage/v1/object/public/article-images/hero.webp'
const SUPABASE_BODY =
  'https://ddfboapzwclecbdjoqex.supabase.co/storage/v1/object/public/article-images/body-1.webp'

function sampleArticleHtml(): string {
  return `
<article>
  <h1>Home EV charger guide</h1>
  <p>Drivers may receive grants of up to £350 (verify at GOV.UK).350. That is something vehicles require.ehicles need a circuit.</p>
  <figure><img src="${SUPABASE_HERO}" alt="Hero" /></figure>
  <figure><img src="${SUPABASE_BODY}" alt="Body" /></figure>
  <meta property="og:image" content="${SUPABASE_HERO}" />
  <meta name="twitter:image" content="${SUPABASE_HERO}" />
  <script type="application/ld+json">{"@type":"Article","image":"${SUPABASE_HERO}"}</script>
</article>`
}

describe('Supabase image URL preservation through scrub/autofix', () => {
  it('does NOT strip "supabase" from Storage hostnames (regression)', () => {
    const html = sampleArticleHtml()
    // Pre-fix bug: whole-HTML replace turned project.supabase.co → project.co
    const { html: out, fixes } = scrubInsertionCorruption(html)
    expect(fixes).toBeGreaterThan(0) // still fixes prose corruption
    expect(out).toContain(SUPABASE_HERO)
    expect(out).toContain(SUPABASE_BODY)
    expect(out).not.toContain('ddfboapzwclecbdjoqex.co/storage')
    expect(out.match(/supabase\.co/g)?.length).toBeGreaterThanOrEqual(5)
    expect(hasInsertionCorruption(out)).toBe(false)
    expect(() => assertImageUrlsPreserved(html, out)).not.toThrow()
  })

  it('assertImageUrlsPreserved fails loudly when supabase is stripped', () => {
    const before = sampleArticleHtml()
    const corrupted = before.replace(/\.supabase\.co/g, '.co')
    expect(() => assertImageUrlsPreserved(before, corrupted)).toThrow(/Image URL was altered/)
  })

  it('transformHtmlTextNodes never rewrites src/href/script bodies', () => {
    const html = `<p>Hello</p><img src="${SUPABASE_HERO}" /><script type="application/ld+json">{"image":"${SUPABASE_HERO}"}</script>`
    const out = transformHtmlTextNodes(html, (t) => t.replace(/Hello/g, 'Hi').replace(/supabase/gi, 'GONE'))
    expect(out).toContain('Hi')
    expect(out).toContain(SUPABASE_HERO)
    expect(out).not.toContain('GONE')
  })

  it('collectImageUrls + isSupabaseStorageUrl recognise Storage URLs', () => {
    const urls = collectImageUrls(sampleArticleHtml())
    expect(urls).toContain(SUPABASE_HERO)
    expect(urls).toContain(SUPABASE_BODY)
    expect(urls.every(isSupabaseStorageUrl)).toBe(true)
  })

  it('does not flag a full Supabase Storage URL as insertion corruption', () => {
    expect(hasInsertionCorruption(`<p>See ${SUPABASE_HERO} for the hero.</p>`)).toBe(false)
  })
})

describe('Quality Gate score single source of truth', () => {
  it('recomputeQualityGateTotals matches score formula from open issues', () => {
    const gate = recomputeQualityGateTotals({
      issues: [
        {
          id: 'hedging-typically',
          severity: 'warning',
          category: 'hedging',
          title: 'Typically still high',
          description: 'still above target',
          autoFixable: true,
        },
        {
          id: 'ai-slop-1',
          severity: 'warning',
          category: 'ai-slop',
          title: 'Slop',
          description: 'x',
          autoFixable: false,
        },
        {
          id: 'dated-claim-0',
          severity: 'warning',
          category: 'dated-policy',
          title: 'Dated',
          description: 'x',
          autoFixable: false,
        },
      ],
      autoFixedCount: 8,
      articleAfterAutoFix: '<p>ok</p>',
    })
    // 3 warnings × 5 = 15 → score 85
    expect(gate.score).toBe(85)
    expect(gate.warningCount).toBe(3)
    expect(gate.criticalCount).toBe(0)
    expect(gate.readyToPublish).toBe(false) // any warning → NEEDS_REVIEW (Phase 10)
  })

  it('qualityGateStageStatus reports partial when autofix left open issues', () => {
    const stage = qualityGateStageStatus({
      autoFixedCount: 8,
      criticalCount: 0,
      warningCount: 3,
      passed: true,
    })
    expect(stage.status).toBe('partial')
    expect(stage.detailSuffix).toMatch(/partially fixed, 3 issue/)
  })

  it('qualityGateStageStatus does not claim Complete/fixed when issues remain', () => {
    expect(
      qualityGateStageStatus({
        autoFixedCount: 8,
        criticalCount: 0,
        warningCount: 1,
        passed: true,
      }).status,
    ).toBe('partial')
    expect(
      qualityGateStageStatus({
        autoFixedCount: 8,
        criticalCount: 0,
        warningCount: 0,
        passed: true,
      }).status,
    ).toBe('fixed')
  })
})
