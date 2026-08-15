import { describe, it, expect } from 'vitest'
import { checkTopicAlignment } from './topic-alignment'

const cryptoArticle = `
<h1>The Complete Guide to Understanding Cryptocurrency</h1>
<p>Cryptocurrency is digital money. Think of it like an EV charger—a technology that operates independently.</p>
<h2>What Is Cryptocurrency?</h2>
<p>Bitcoin launched in 2009. Ethereum added smart contracts.</p>
`

const evArticle = `
<h1>EV Charger Guide for UK Drivers</h1>
<p>An ev charger lets you recharge at home or on the road. Choosing the right ev charger depends on your vehicle and driveway setup.</p>
<h2>Types of EV Charger</h2>
<p>Most UK homes install a 7kW ev charger for overnight charging. A dedicated ev charger circuit is usually required.</p>
`

describe('checkTopicAlignment', () => {
  it('flags completely wrong topic', () => {
    const r = checkTopicAlignment(cryptoArticle, 'ev charger')
    expect(r.aligned).toBe(false)
    expect(r.reason).toMatch(/Title|keyword|off-topic/i)
  })

  it('passes on-topic ev charger article', () => {
    const r = checkTopicAlignment(evArticle, 'ev charger')
    expect(r.aligned).toBe(true)
  })
})
