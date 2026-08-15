import { describe, it, expect } from 'vitest'
import { checkTopicAlignment, assertNonEmptyKeyword, getKeywordTokens } from './topic-alignment'
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

  it('rejects empty keyword', () => {
    expect(checkTopicAlignment(evArticle, '').aligned).toBe(false)
    expect(() => assertNonEmptyKeyword('')).toThrow('KEYWORD_REQUIRED')
    expect(assertNonEmptyKeyword('  ev charger  ')).toBe('ev charger')
  })

  it('tokenises multi-word keywords including short terms like ev', () => {
    expect(getKeywordTokens('ev charger')).toEqual(['ev', 'charger'])
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
