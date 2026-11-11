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

const SITE_NAV =
  'Home Blog About Contact Privacy MOT cost UK 2026 motorbike fees guide check EV charging UK Vehicle Data Tools'

const TOOLS = page('https://example.com/blog/uk-vehicle-data-tools.html', {
  title: 'UK Vehicle Data Tools',
  h1: 'UK Vehicle Data Tools',
  headings: ['Popular tools'],
  text: `${SITE_NAV} Directory of vehicle lookup tools. MOT history, EV charging map, insurance quotes, and motorbike fees.`,
})

const MOT_BIKE = page('https://example.com/blog/motorbike-mot-cost-uk-2026.html', {
  title: 'Motorbike MOT cost UK 2026',
  h1: 'Motorbike MOT cost UK 2026',
  headings: ['Class 1 and 2 test fees'],
  text: `${SITE_NAV} Motorbike MOT test fee for class 1 and 2. DVSA garage prices and retest charges.`,
})

const MOT_CHANGES = page('https://example.com/blog/mot-changes-2026-dvsa-updates.html', {
  title: 'MOT changes 2026 DVSA updates',
  h1: 'MOT changes 2026 DVSA updates',
  headings: ['New inspection rules'],
  text: `${SITE_NAV} DVSA MOT test rule changes for 2026. Retest policy and inspection updates for cars.`,
})

const EV_MAP = page('https://example.com/blog/electric-car-charger-map-uk.html', {
  title: 'Electric car charger map UK',
  h1: 'Electric car charger map UK',
  headings: ['Rapid CCS chargers'],
  text: `${SITE_NAV} Public electric vehicle charge point map. RAPID CCS Tesla Supercharger locations.`,
})

const SITE = [
  EV,
  EV_HOME,
  EV_MAP,
  MOT_COST,
  MOT_HISTORY,
  MOT_BIKE,
  MOT_CHANGES,
  TOOLS,
  page('https://example.com/blog/mot-advisories-explained-uk.html', {
    title: 'MOT advisories explained UK',
    h1: 'MOT advisories explained UK',
    headings: ['Advisory vs fail'],
    text: `${SITE_NAV} MOT advisory items versus fails. DVSA handbook examples.`,
  }),
  page('https://example.com/blog/free-mot-history-check-uk.html', {
    title: 'Free MOT history check UK',
    h1: 'Free MOT history check UK',
    headings: ['Mileage records'],
    text: `${SITE_NAV} Look up MOT history and mileage on the DVSA service.`,
  }),
]

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

  it('does not link MOT cost articles to UK Vehicle Data Tools via generic site-wide words', () => {
    const idfSite = buildIdf(SITE)
    for (const source of [MOT_COST, MOT_BIKE, MOT_CHANGES]) {
      const scored = scoreLinkRelevance(source, TOOLS, { idf: idfSite })
      expect(scored.score, source.url).toBeLessThan(RELEVANCE_DROP_THRESHOLD)
      expect(scored.band, source.url).toBe('drop')
      expect(scored.reason.toLowerCase(), source.url).not.toMatch(/ev charging/)
    }
  })

  it('reasons EV charger articles from shared EV terms, never a false cluster label', () => {
    const idfSite = buildIdf(SITE)
    const scored = scoreLinkRelevance(EV, EV_HOME, { idf: idfSite })
    expect(scored.score).toBeGreaterThanOrEqual(RELEVANCE_WEAK_THRESHOLD)
    expect(scored.band).toBe('strong')
    expect(scored.reason.toLowerCase()).toMatch(/charg|electric|ev/)
    expect(scored.reason.toLowerCase()).not.toMatch(/mot tests|vehicle history/)
    expect(scored.sharedTerms.join(' ')).toMatch(/charg|electric|ev|wallbox|tesla|ccs/)
  })

  it('down-weights terms that appear on most pages so they cannot dominate cosine', () => {
    const idfSite = buildIdf(SITE)
    expect(idfSite.get('mot') ?? 0).toBeLessThan(idfSite.get('wallbox') ?? 1)
    expect(idfSite.get('fees') ?? 0).toBeLessThan(idfSite.get('supercharger') ?? 1)
    expect(idfSite.get('guide') ?? 0).toBeLessThan(0.4)
  })

  it('flags a mid-band pair as a weak match', () => {
    const loose = page('https://example.com/cars/winter-tyres', {
      title: 'Winter tyres for UK drivers',
      h1: 'Winter tyres for UK drivers',
      headings: ['Garage prices', 'Tread depth'],
      text: 'Fit winter tyres before the frost. Garage prices, tread depth, and tyre pressure.',
      clusterId: 'cars',
    })
    const scored = scoreLinkRelevance(loose, { ...MOT_COST, clusterId: 'cars' }, {
      idf: buildIdf([...CORPUS, loose]),
    })
    expect(scored.score).toBeGreaterThanOrEqual(RELEVANCE_DROP_THRESHOLD)
    expect(scored.score).toBeLessThan(RELEVANCE_WEAK_THRESHOLD)
    expect(scored.band).toBe('weak')
    expect(scored.reason.toLowerCase()).toMatch(/weak|loose/)
    expect(scored.reason.toLowerCase()).not.toMatch(/ev charging/)
  })
})
