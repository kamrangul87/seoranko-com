import { describe, it, expect } from 'vitest'
import {
  maskDomainLikeTokens,
  maskDecimals,
  maskUrls,
  countSentences,
  splitSentences,
  sentenceBoundaryOffsets,
  isDenseParagraph,
  SCANNABILITY_POLICY,
} from './sentence-boundaries'
import { validateArticleStructure } from './structure-validator'
import { autoSplitDenseParagraphs } from './scannability-fixer'
import { splitDenseParagraphs } from './paragraph-splitter'
import { buildFinalArticleArtifact } from './final-article-artifact'

const { denseSentenceThreshold, minDenseParagraphsForWarning } = SCANNABILITY_POLICY

describe('Phase 3 sentence-boundaries (authoritative)', () => {
  it('A. gov.uk tokens do not create false sentence boundaries', () => {
    const text = 'See the rules on gov.uk before you apply for support.'
    expect(countSentences(text)).toBe(1)
    expect(splitSentences(text)).toHaveLength(1)
  })

  it('B. energynetworks.org does not create false sentence boundaries', () => {
    const text = 'Capacity maps live on energynetworks.org for every region.'
    expect(countSentences(text)).toBe(1)
  })

  it('C. example.com does not create false sentence boundaries', () => {
    const text = 'More detail is published on example.com for installers.'
    expect(countSentences(text)).toBe(1)
  })

  it('D. URLs do not create false sentence boundaries', () => {
    const text =
      'Read https://www.gov.uk/guidance/electric-vehicle-chargepoints before booking.'
    expect(maskUrls(text)).not.toContain('https://')
    expect(countSentences(text)).toBe(1)
  })

  it('E. decimal numbers do not create false sentence boundaries', () => {
    const text = 'The charger can deliver 7.4kW. That is different from 22kW.'
    expect(maskDecimals('costs 7.4 percent')).not.toContain('7.4')
    expect(countSentences(text)).toBe(2)
    expect(splitSentences(text)).toHaveLength(2)
  })

  it('F. normal 6+ sentence paragraph is detected', () => {
    const text = Array.from(
      { length: denseSentenceThreshold },
      (_, i) => `Sentence number ${i + 1} covers a point.`,
    ).join(' ')
    expect(countSentences(text)).toBe(denseSentenceThreshold)
    expect(isDenseParagraph(text)).toBe(true)
  })

  it('G. four or more genuinely dense paragraphs produce the expected warning', () => {
    const dense = `<p>${Array.from({ length: denseSentenceThreshold }, (_, i) => `Sentence number ${i + 1} is here.`).join(' ')}</p>`
    const html = `<h1>Guide</h1>${dense}${dense}${dense}${dense}`
    const issues = validateArticleStructure(html)
    const scan = issues.filter(i => i.category === 'scannability')
    expect(scan).toHaveLength(1)
    expect(scan[0].message).toMatch(
      new RegExp(`${minDenseParagraphsForWarning} paragraphs are ${denseSentenceThreshold}\\+ sentences`),
    )
  })

  it('H. fixer and validator produce the same sentence count', () => {
    const para =
      'Visit gov.uk for grants. Energynetworks.org maps capacity. ' +
      'A service head upgrade adds cost. Network reinforcement is rarer. ' +
      'Get figures in writing. Compare three quotes afterwards.'
    const fromCounter = countSentences(para)
    const html = `<p>${para}</p>`
    // Validator path
    let validatorCount = 0
    for (const p of html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []) {
      validatorCount = countSentences(p.replace(/<[^>]+>/g, ''))
    }
    expect(validatorCount).toBe(fromCounter)
    expect(fromCounter).toBe(6)
  })

  it('I. fixer and validator use the same dense threshold', () => {
    expect(SCANNABILITY_POLICY.denseSentenceThreshold).toBe(6)
    const under = Array.from({ length: 5 }, (_, i) => `Point ${i + 1}.`).join(' ')
    const at = Array.from({ length: 6 }, (_, i) => `Point ${i + 1} about charging.`).join(' ')
    expect(isDenseParagraph(under)).toBe(false)
    expect(isDenseParagraph(at)).toBe(true)
    // Fixer leaves 5 alone, splits 6+
    expect((autoSplitDenseParagraphs(`<p>${under}</p>`).match(/<p[\s>]/g) || []).length).toBe(1)
    expect((autoSplitDenseParagraphs(`<p>${at}</p>`).match(/<p[\s>]/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('J. final article is evaluated after paragraph transforms', () => {
    const dense = Array.from(
      { length: 6 },
      (_, i) => `Sentence number ${i + 1} covers installation detail.`,
    ).join(' ')
    const prose = `<h1>Home EV charger guide</h1><p>${dense}</p><h2>Costs</h2><p>Short follow-up paragraph for context.</p>`
    const artifact = buildFinalArticleArtifact({
      proseHtml: prose,
      schemaInput: {
        title: 'Home EV charger guide',
        description: 'Guide.',
        keyword: 'home EV charger',
        authorName: 'Kamran Gul',
        publishDate: '2026-08-20T00:00:00.000Z',
        dateModified: '2026-08-20T00:00:00.000Z',
        articleUrl: 'https://example.com/guide',
        organizationName: 'Example',
        organizationUrl: 'https://example.com',
      },
    })
    // After final paragraph/scannability in the artifact builder, no dense
    // block at/above threshold should remain for the QG structure check.
    const remainingDense = (artifact.html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [])
      .filter(p => !/article-last-verified|article-byline/i.test(p))
      .filter(p => countSentences(p.replace(/<[^>]+>/g, '')) >= denseSentenceThreshold)
    expect(remainingDense).toHaveLength(0)
    const issues = validateArticleStructure(artifact.html)
    expect(issues.filter(i => i.category === 'scannability')).toHaveLength(0)
  })

  it('K. headings, lists, figures, captions, metadata do not create false scannability warnings', () => {
    const html = `
      <h1>Guide</h1>
      <figure><img src="https://cdn.example.com/h.webp" alt="x" /><figcaption>Caption with gov.uk mention.</figcaption></figure>
      <ul><li>One. Item.</li><li>Two. Item.</li></ul>
      <p class="article-last-verified">${Array.from({ length: 6 }, (_, i) => `Meta ${i + 1}.`).join(' ')}</p>
      <p>Short body paragraph citing example.com only once.</p>
    `
    const issues = validateArticleStructure(html)
    expect(issues.filter(i => i.category === 'scannability')).toHaveLength(0)
    expect(autoSplitDenseParagraphs(html)).toContain('article-last-verified')
  })

  it('L. real dense content is still split/flagged correctly', () => {
    const sentences = Array.from(
      { length: 8 },
      (_, i) => `Dense production sentence ${i + 1} about charger installation and grid capacity.`,
    )
    const html = `<h1>Guide</h1><p>${sentences.join(' ')}</p>`
    const fixed = autoSplitDenseParagraphs(html)
    const paras = Array.from(fixed.matchAll(/<p>([\s\S]*?)<\/p>/g)).map(m => m[1])
    expect(paras.length).toBeGreaterThanOrEqual(2)
    for (const p of paras) {
      expect(countSentences(p)).toBeLessThan(denseSentenceThreshold)
    }
    // Four dense blocks still warn when left unsplit
    const fourDense = Array(4)
      .fill(`<p>${sentences.slice(0, 6).join(' ')}</p>`)
      .join('')
    const warn = validateArticleStructure(`<h1>G</h1>${fourDense}`)
    expect(warn.some(i => i.category === 'scannability')).toBe(true)
  })
})

describe('mask helpers', () => {
  it('maskDomainLikeTokens preserves length', () => {
    const text = 'See gov.uk and energynetworks.org for details.'
    const masked = maskDomainLikeTokens(text)
    expect(masked.length).toBe(text.length)
    expect(masked).not.toContain('gov.uk')
  })

  it('sentenceBoundaryOffsets stay aligned after domain masking', () => {
    const text = 'Visit gov.uk today. Then call support.'
    const offsets = sentenceBoundaryOffsets(text)
    expect(offsets.length).toBe(1)
    expect(text.slice(0, offsets[0])).toContain('today.')
  })

  it('splitSentences matches countSentences', () => {
    const text = 'One point. Two point! Three point?'
    expect(splitSentences(text)).toHaveLength(countSentences(text))
  })
})

describe('splitter/fixer parity with policy', () => {
  it('paragraph-splitter uses the same dense threshold as the fixer', () => {
    const five = Array.from({ length: 5 }, (_, i) => `Short ${i + 1}.`).join(' ')
    const six = Array.from({ length: 6 }, (_, i) => `Longer sentence ${i + 1} about chargers.`).join(' ')
    expect((splitDenseParagraphs(`<p>${five}</p>`).match(/<p>/g) || []).length).toBe(1)
    expect((splitDenseParagraphs(`<p>${six}</p>`).match(/<p>/g) || []).length).toBeGreaterThanOrEqual(2)
    expect((autoSplitDenseParagraphs(`<p>${five}</p>`).match(/<p[\s>]/g) || []).length).toBe(1)
    expect((autoSplitDenseParagraphs(`<p>${six}</p>`).match(/<p[\s>]/g) || []).length).toBeGreaterThanOrEqual(2)
  })
})
