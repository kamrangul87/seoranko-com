import { describe, expect, it } from 'vitest'
import {
  RELEVANCE_DROP_THRESHOLD,
  RELEVANCE_WEAK_THRESHOLD,
  buildIdf,
  scoreLinkRelevance,
  tokenizeForRelevance,
  type RelevancePage,
} from './relevance'

function page(
  url: string,
  extra: Partial<RelevancePage> & { title?: string; h1?: string; text?: string } = {},
): RelevancePage {
  const title = extra.title ?? extra.h1 ?? url
  return {
    url,
    title,
    h1: extra.h1 ?? title,
    headings: extra.headings ?? [],
    text: extra.text ?? `${title} ${extra.h1 ?? title}`,
    clusterId: extra.clusterId ?? 'blog',
  }
}

const EV = page('https://example.com/blog/ev-charging-on-uk-motorways', {
  title: 'EV charging on UK motorways',
  h1: 'EV charging on UK motorways',
  headings: ['Rapid chargers at service stations', 'CCS and Tesla stalls'],
  text: 'Electric vehicle charge points along motorway services. RAPID CCS Tesla Supercharger queues.',
})

const MOT_COST = page('https://example.com/blog/mot-cost-uk-2026', {
  title: 'MOT cost UK 2026',
  h1: 'MOT cost UK 2026',
  headings: ['Class 4 test fee', 'Garage prices this year'],
  text: 'MOT test fee for cars in 2026. DVSA class 4 garage prices and retest charges.',
})

const MOT_HISTORY = page('https://example.com/blog/mot-history-check-uk', {
  title: 'How to check a vehicle MOT history in the UK',
  h1: 'How to check a vehicle MOT history in the UK',
  headings: ['DVSA MOT check', 'Mileage records'],
  text: 'Look up MOT history and mileage on the DVSA service. Free vehicle test records.',
})

const EV_HOME = page('https://example.com/blog/home-ev-charger-installation', {
  title: 'Home EV charger installation',
  h1: 'Home EV charger installation',
  headings: ['Wallbox grant', 'Tethered cables'],
  text: 'Install a home electric vehicle charger. Wallbox grant, tethered Type 2 cable, off-peak charging.',
})

const CORPUS = [EV, MOT_COST, MOT_HISTORY, EV_HOME]

describe('tokenizeForRelevance', () => {
  it('drops stop words and short tokens', () => {
    const tokens = tokenizeForRelevance('The MOT cost in the UK 2026')
    expect(tokens).toContain('mot')
    expect(tokens).toContain('cost')
    expect(tokens).not.toContain('the')
    expect(tokens).not.toContain('uk')
  })
})

describe('scoreLinkRelevance', () => {
  const idf = buildIdf(CORPUS)

  it('drops EV charging on UK motorways → MOT cost UK 2026 as unrelated', () => {
    const scored = scoreLinkRelevance(EV, MOT_COST, { idf })
    expect(scored.score).toBeLessThan(RELEVANCE_DROP_THRESHOLD)
    expect(scored.band).toBe('drop')
    expect(scored.reason.toLowerCase()).toMatch(/different topic|little topical|not closely related/)
    expect(scored.reason).not.toMatch(/keyword/i)
  })

  it('keeps MOT cost → MOT history as the same intent', () => {
    const scored = scoreLinkRelevance(MOT_COST, MOT_HISTORY, { idf })
    expect(scored.score).toBeGreaterThanOrEqual(RELEVANCE_WEAK_THRESHOLD)
    expect(scored.band).toBe('strong')
    expect(scored.reason.toLowerCase()).toMatch(/mot/)
  })

  it('keeps two EV charging pages', () => {
    const scored = scoreLinkRelevance(EV, EV_HOME, { idf })
    expect(scored.score).toBeGreaterThanOrEqual(RELEVANCE_DROP_THRESHOLD)
    expect(scored.band).not.toBe('drop')
    expect(scored.reason.toLowerCase()).toMatch(/charg|electric|ev/)
  })

  it('flags a mid-band pair as a weak match', () => {
    const loose = page('https://example.com/cars/winter-tyres', {
      title: 'Winter tyres for UK drivers',
      h1: 'Winter tyres for UK drivers',
      headings: ['Tread depth'],
      text: 'Fit winter tyres before the frost. Grip, tread depth, and tyre pressure.',
      clusterId: 'cars',
    })
    const scored = scoreLinkRelevance(loose, { ...MOT_COST, clusterId: 'cars' }, {
      idf: buildIdf([...CORPUS, loose]),
    })
    expect(scored.score).toBeGreaterThanOrEqual(RELEVANCE_DROP_THRESHOLD)
    expect(scored.score).toBeLessThan(RELEVANCE_WEAK_THRESHOLD)
    expect(scored.band).toBe('weak')
    expect(scored.reason.toLowerCase()).toMatch(/weak|loose/)
  })
})
