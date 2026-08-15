import { describe, it, expect } from 'vitest'
import {
  buildStockSearchQuery,
  isEvChargingTopic,
  mentionsConsumerElectronics,
  stockRelevanceScore,
  isAcceptableStockPhoto,
} from './stock-image-relevance'

describe('EV charger stock disambiguation', () => {
  it('detects EV charging topics', () => {
    expect(isEvChargingTopic('ev charger')).toBe(true)
    expect(isEvChargingTopic('best gym')).toBe(false)
  })

  it('forces vehicle wording into stock search (not bare charger)', () => {
    const q = buildStockSearchQuery(
      'ev charger',
      'different charger types on a white surface, professional photography, no text'
    )
    expect(q.toLowerCase()).toMatch(/electric vehicle|wallbox|ev/)
    expect(q.toLowerCase()).not.toBe('different charger types on a white surface')
  })

  it('rejects phone/tablet AirPods product shots for EV articles', () => {
    const alt = 'White iPhone, iPad and AirPods with charging cable on desk'
    expect(mentionsConsumerElectronics(alt)).toBe(true)
    expect(isAcceptableStockPhoto(alt, 'ev charger', 'EV home wallbox')).toBe(false)
    expect(stockRelevanceScore(alt, 'ev charger', 'EV home wallbox')).toBeLessThan(0)
  })

  it('accepts real EV charging photos', () => {
    const alt = 'Electric vehicle charging at a home wallbox station'
    expect(isAcceptableStockPhoto(alt, 'ev charger', 'home wallbox overnight charging')).toBe(true)
    expect(stockRelevanceScore(alt, 'ev charger', 'home wallbox overnight charging')).toBeGreaterThan(0)
  })
})
