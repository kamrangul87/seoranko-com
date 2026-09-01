import { describe, it, expect } from 'vitest'
import { computeRepairPriority, classifyActionability, classifyImpact, scaleWeight } from './repair-priority'

describe('computeRepairPriority', () => {
  it('ranks a critical, widely-affecting, auto-fixable issue above a notice-level one-off', () => {
    const high = computeRepairPriority({
      severity: 'critical',
      affectedUrlCount: 200,
      confidence: 'high',
      effort: '2min',
      autoFixable: true,
    })
    const low = computeRepairPriority({
      severity: 'notice',
      affectedUrlCount: 1,
      confidence: 'low',
      effort: '1hour',
      autoFixable: false,
    })
    expect(high).toBeGreaterThan(low)
    expect(high).toBeLessThanOrEqual(100)
    expect(low).toBeGreaterThanOrEqual(0)
  })

  it('is deterministic — same input always produces the same score', () => {
    const input = { severity: 'warning' as const, affectedUrlCount: 12, confidence: 'medium' as const, effort: '30min' as const, autoFixable: false }
    expect(computeRepairPriority(input)).toBe(computeRepairPriority(input))
  })

  it('does not assume unknown effort is easy', () => {
    const knownEasy = computeRepairPriority({ severity: 'warning', affectedUrlCount: 1, effort: '2min' })
    const unknown = computeRepairPriority({ severity: 'warning', affectedUrlCount: 1 })
    expect(unknown).toBeLessThan(knownEasy)
  })

  it('clamps to [0, 100]', () => {
    const max = computeRepairPriority({ severity: 'critical', affectedUrlCount: 10000, confidence: 'high', effort: '2min', autoFixable: true })
    expect(max).toBeLessThanOrEqual(100)
  })
})

describe('scaleWeight', () => {
  it('saturates instead of scaling linearly with affected URL count', () => {
    const at100 = scaleWeight(100)
    const at100000 = scaleWeight(100000)
    expect(at100000).toBe(at100 + 3) // one more bucket, not proportionally larger
  })
})

describe('classifyActionability', () => {
  it('defers to the real Fix Agent classifier for structural schema/meta fixes', () => {
    expect(classifyActionability({
      issueKey: 'no_schema', category: 'schema', severity: 'critical',
      message: 'No structured data — missing rich result eligibility',
    })).toBe('AUTO_FIXABLE')
    expect(classifyActionability({
      issueKey: 'missing_title', category: 'onpage', severity: 'critical',
      message: 'Missing title tag — fundamental SEO requirement',
    })).toBe('AUTO_FIXABLE')
  })

  it('marks editorial-judgment issues HUMAN_GUIDED, per the spec\'s own example ("thin-content decisions" are human-guided, not non-actionable)', () => {
    expect(classifyActionability({
      issueKey: 'thin_content', category: 'content', severity: 'critical',
      message: 'Thin content: only 90 words — Google actively demotes thin pages',
    })).toBe('HUMAN_GUIDED')
  })

  it('demotes header-level fixes to HUMAN_GUIDED when no site connection is known yet', () => {
    expect(classifyActionability({
      issueKey: 'no_hsts', category: 'security', severity: 'critical',
      message: 'No HSTS header — site vulnerable to downgrade attacks',
    })).toBe('HUMAN_GUIDED')
  })

  it('maps an unclassified low-severity finding to NOT_ACTIONABLE_AUTOMATICALLY', () => {
    expect(classifyActionability({
      issueKey: 'no_author_bio', category: 'ai', severity: 'notice',
      message: 'Author credited but no bio section found — add credentials to strengthen E-E-A-T',
    })).toBe('NOT_ACTIONABLE_AUTOMATICALLY')
  })
})

describe('classifyImpact', () => {
  it('escalates impact when a warning-severity issue affects many URLs', () => {
    const narrow = classifyImpact({ severity: 'warning', affectedUrlCount: 1 })
    const wide = classifyImpact({ severity: 'warning', affectedUrlCount: 50 })
    expect(narrow).toBe('medium')
    expect(wide).toBe('high')
  })
})
