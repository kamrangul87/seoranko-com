import { describe, it, expect } from 'vitest'
import {
  jaccardSimilarity,
  ruleBasedJudgement,
  detectCannibalization,
} from '@/lib/cannibalization-detector'

describe('cannibalization-detector', () => {
  it('handles null/empty keywords without throwing', () => {
    expect(jaccardSimilarity('', 'ev charger')).toBe(0)
    expect(jaccardSimilarity('ev charger installation', 'ev charger installation cost')).toBeGreaterThan(40)
  })

  it('ruleBasedJudgement maps overlap bands', () => {
    expect(ruleBasedJudgement(80, 'A', 'B').recommendation).toBe('merge')
    expect(ruleBasedJudgement(60, 'A', 'B').recommendation).toBe('differentiate')
    expect(ruleBasedJudgement(45, 'A', 'B').recommendation).toBe('monitor')
  })

  it('detectCannibalization works without Anthropic for overlapping keywords', async () => {
    const prev = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const result = await detectCannibalization([
        { id: '1', title: 'EV Charger Installation Guide', keyword: 'ev charger installation' },
        { id: '2', title: 'Home EV Charger Install Costs', keyword: 'ev charger installation cost' },
        { id: '3', title: 'MOT Check Changes 2026', keyword: 'mot check' },
      ])
      expect(result.totalConflicts).toBeGreaterThanOrEqual(1)
      expect(result.pairs[0].article1Keyword).toContain('ev charger')
      expect(result.pairs.every(p => p.fixPlan.length > 0)).toBe(true)
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev
    }
  })
})
