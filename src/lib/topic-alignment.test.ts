import { describe, it, expect } from 'vitest'
import {
  checkTopicAlignment,
  assertNonEmptyKeyword,
  getKeywordTokens,
  coreKeywordPhrase,
  primaryTopicPhrase,
  filterRelatedKeywords,
} from './topic-alignment'
import { outlineMatchesKeyword, type ArticleOutline } from './article-outline'

const cryptoArticle = `
<h1>The Complete Guide to Understanding Cryptocurrency</h1>
<p>Cryptocurrency is digital money. Think of it like an EV charger—a technology that operates independently.</p>
<h2>What Is Cryptocurrency?</h2>
<p>Bitcoin launched in 2009. Ethereum added smart contracts.</p>
`

const stressArticle = `
<h1>The Impact of Stress on Physical Health</h1>
<p>Chronic stress affects your heart, sleep, and immune system.</p>
`

const evArticle = `
<h1>EV Charger Guide for UK Drivers</h1>
<p>An ev charger lets you recharge at home or on the road. Choosing the right ev charger depends on your vehicle and driveway setup.</p>
<h2>Types of EV Charger</h2>
<p>Most UK homes install a 7kW ev charger for overnight charging. A dedicated ev charger circuit is usually required.</p>
`

const longKeywordArticle = `
<h1>EV Charger Types Comparison: Level 1, Level 2 and DC Fast Charging</h1>
<p>Choosing between EV charger types matters for home and public charging. Level 1, Level 2 and DC fast charging each suit different drivers.</p>
<h2>Level 1 EV Charger Basics</h2>
<p>A Level 1 EV charger plugs into a standard socket and is slow but simple.</p>
<h2>Level 2 EV Charger</h2>
<p>Level 2 is the most common home EV charger type for overnight top-ups.</p>
<h2>DC Fast Charging</h2>
<p>DC fast charging tops up long journeys quickly at public hubs.</p>
`

describe('keyword normalisation', () => {
  it('strips parentheticals from long keywords', () => {
    expect(coreKeywordPhrase('EV charger types comparison (Level 1, 2, DC fast charging)'))
      .toBe('EV charger types comparison')
    expect(primaryTopicPhrase('EV charger types comparison (Level 1, 2, DC fast charging)'))
      .toContain('charger')
  })

  it('tokenises multi-word keywords including short terms like ev', () => {
    expect(getKeywordTokens('ev charger')).toEqual(['ev', 'charger'])
  })
})

describe('checkTopicAlignment', () => {
  it('flags crypto article for ev charger', () => {
    const r = checkTopicAlignment(cryptoArticle, 'ev charger')
    expect(r.aligned).toBe(false)
  })

  it('flags stress/health article for ev charger', () => {
    const r = checkTopicAlignment(stressArticle, 'ev charger')
    expect(r.aligned).toBe(false)
  })

  it('passes on-topic ev charger article', () => {
    const r = checkTopicAlignment(evArticle, 'ev charger')
    expect(r.aligned).toBe(true)
  })

  it('passes long parenthetical keyword without requiring exact full-phrase density', () => {
    const kw = 'EV charger types comparison (Level 1, 2, DC fast charging)'
    const r = checkTopicAlignment(longKeywordArticle, kw)
    expect(r.aligned).toBe(true)
  })

  it('rejects empty keyword', () => {
    expect(checkTopicAlignment(evArticle, '').aligned).toBe(false)
    expect(() => assertNonEmptyKeyword('')).toThrow('KEYWORD_REQUIRED')
    expect(assertNonEmptyKeyword('  ev charger  ')).toBe('ev charger')
  })
})

describe('filterRelatedKeywords', () => {
  it('drops unrelated near-me secondaries from a types-comparison brief', () => {
    const kept = filterRelatedKeywords(
      'EV charger types comparison (Level 1, 2, DC fast charging)',
      ['ev chargers stations near me', 'ev charger types', 'mot check']
    )
    expect(kept).toContain('ev charger types')
    expect(kept).not.toContain('mot check')
    expect(kept.some(k => /near me/i.test(k))).toBe(false)
  })
})

describe('outlineMatchesKeyword', () => {
  it('accepts EV charger outline', () => {
    const outline: ArticleOutline = {
      h1: 'EV Charger Guide for UK Homes',
      h2s: [
        'What Is an EV Charger?',
        'Types of EV Charger',
        'Installation Costs',
        'Driveway Rules',
        'FAQ',
      ],
    }
    expect(outlineMatchesKeyword(outline, 'ev charger')).toBe(true)
  })

  it('rejects stress outline for ev charger', () => {
    const outline: ArticleOutline = {
      h1: 'The Impact of Stress on Physical Health',
      h2s: ['What Is Stress?', 'Physical Symptoms', 'Coping Tips', 'FAQ'],
    }
    expect(outlineMatchesKeyword(outline, 'ev charger')).toBe(false)
  })
})
