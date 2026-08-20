/**
 * Phases 6–9 regression tests.
 */

import { describe, it, expect } from 'vitest'
import { assessTimeSensitivity } from './time-sensitivity-policy'
import { evaluateHedging } from './hedging-policy'
import { assessEditorialWordCount } from './editorial-word-count'
import { confirmAutoFixOutcomes, scoreFromIssues } from './autofix-confirmation'
import { buildDatedPolicyIssues, runQualityGate } from './article-quality-gate'

describe('Phase 6 — time sensitivity', () => {
  it('"Check the rules now" is instructional, not a factual error', () => {
    const a = assessTimeSensitivity('Check the rules now.')
    expect(a.verdict).toBe('INSTRUCTIONAL')
    expect(a.requiresVerification).toBe(false)
  })

  it('"The grant is currently £500" is factual time-sensitive', () => {
    const a = assessTimeSensitivity('The grant is currently £500 for eligible workplaces.')
    expect(a.verdict).toBe('FACTUAL_TIME_SENSITIVE')
    expect(a.requiresVerification).toBe(true)
    expect(a.domain).toBe('grants')
  })

  it('From April 2026 transition is historical/future, not auto-outdated', () => {
    const a = assessTimeSensitivity('From 1 April 2026 the grant increased to £500.')
    expect(['HISTORICAL_TRANSITION', 'FUTURE_POLICY', 'FACTUAL_TIME_SENSITIVE']).toContain(a.verdict)
    expect(a.requiresVerification).toBe(true)
  })

  it('Quality Gate does not warn on instructional now', () => {
    const issues = buildDatedPolicyIssues('<p>Check the rules now before you apply.</p>', {
      now: new Date('2026-08-18'),
    })
    expect(issues.filter((i) => i.category === 'dated-policy')).toHaveLength(0)
  })
})

describe('Phase 7 — hedging semantics', () => {
  it('appropriate may/can with variability is not actionable', () => {
    const html = `
      <p>Costs may vary depending on your fuse board and driveway layout.</p>
      <p>Installers can often finish a standard job in under a day.</p>
      <p>Prices are approximately £800 for a typical 7kW unit.</p>
    `
    const ev = evaluateHedging(html)
    expect(ev.actionable.filter((a) => a.classification === 'APPROPRIATE_QUALIFICATION')).toHaveLength(0)
    expect(ev.occurrences.some((o) => o.classification === 'APPROPRIATE_QUALIFICATION')).toBe(true)
  })

  it('stacked typically boilerplate is REAL_REPETITION', () => {
    const html = Array.from({ length: 8 }, () =>
      '<p>It is typically important to check your meter before you book.</p>',
    ).join('\n')
    const ev = evaluateHedging(html)
    expect(ev.actionable.some((a) => a.classification === 'REAL_REPETITION')).toBe(true)
  })
})

describe('Phase 8 — editorial word count', () => {
  it('short but complete is ADVISORY info, not a hard SEO fail', () => {
    const a = assessEditorialWordCount(1000, 1500, { coverageIncomplete: false })
    expect(a.classification).toBe('ADVISORY')
    expect(a.severity).toBe('info')
    expect(a.description).toMatch(/filler|advisory|complete/i)
  })

  it('short with missing coverage is CONTENT_COVERAGE warning', () => {
    const a = assessEditorialWordCount(900, 1500, { coverageIncomplete: true })
    expect(a.classification).toBe('CONTENT_COVERAGE')
    expect(a.severity).toBe('warning')
  })

  it('within preferred band emits no issue', () => {
    const a = assessEditorialWordCount(1500, 1500)
    expect(a.classification).toBe('WITHIN_PREFERRED')
    expect(a.severity).toBeNull()
  })
})

describe('Phase 9 — autofix confirmation', () => {
  it('does not mayReportAsFixed when regressions appear and score drops', () => {
    const before = [
      { id: 'ai-slop-1', category: 'ai-slop', severity: 'warning' as const, title: 'slop' },
    ]
    const after = [
      { id: 'grant-1', category: 'grant-figure', severity: 'critical' as const, title: 'grant' },
      { id: 'hedging-1', category: 'hedging', severity: 'warning' as const, title: 'hedge' },
    ]
    const conf = confirmAutoFixOutcomes({
      beforeIssues: before,
      afterIssues: after,
      mutationAttempts: 3,
      scoreBefore: scoreFromIssues(before),
      scoreAfter: scoreFromIssues(after),
    })
    expect(conf.revalidationFoundAdditionalIssues).toBe(true)
    expect(conf.mayReportAsFixed).toBe(false)
    expect(conf.summary).toMatch(/revalidation found additional issues/i)
    expect(conf.scoreAfter).toBeLessThan(conf.scoreBefore)
  })

  it('confirms resolved only when issue gone and no regressions', () => {
    const before = [
      { id: 'ai-slop-1', category: 'ai-slop', severity: 'warning' as const, title: 'slop' },
    ]
    const after: typeof before = []
    const conf = confirmAutoFixOutcomes({
      beforeIssues: before,
      afterIssues: after,
      mutationAttempts: 1,
      scoreBefore: 95,
      scoreAfter: 100,
    })
    expect(conf.confirmedResolved).toHaveLength(1)
    expect(conf.mayReportAsFixed).toBe(true)
  })

  it('runQualityGate autoFixedCount equals confirmed resolutions', async () => {
    const html = `
      <html><head><title>Home EV charger UK</title></head>
      <body><article>
      <h1>Home EV charger UK</h1>
      <p>Written by Kamran Gul of autodun. Home EV charger UK needs a DNO check.</p>
      <p>In today's landscape, Home EV charger UK installs are common.</p>
      <h2>Meter types</h2>
      <p>Home EV charger UK also depends on your fuse rating and cable length for a safe install.</p>
      </article></body></html>
    `
    const qr = await runQualityGate(html, {
      brand: 'autodun',
      keyword: 'Home EV charger UK',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['autodun.com'],
      minWordCount: 40,
      expectOrganizationLogo: false,
    })
    expect(qr.autoFixConfirmation).toBeTruthy()
    expect(qr.autoFixedCount).toBe(qr.autoFixConfirmation!.confirmedResolved.length)
    expect(qr.score).toBe(scoreFromIssues(qr.issues))
  })
})
