import { describe, expect, it } from 'vitest'
import {
  compareFindingsExact,
  loadExpectedAutoFixable,
  loadExpectedFindings,
  expectedReadmeDiff,
} from './compare'
import { E2E_STEP_ORDER } from './constants'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('fix-agent-e2e expected.json', () => {
  it('loads planted auto-fixable rows from README topics', () => {
    const autos = loadExpectedAutoFixable()
    const topics = new Set(autos.map((a) => a.topicId))
    for (const t of ['14', '17', '22', '26', '42', '49']) {
      expect(topics.has(t)).toBe(true)
    }
    expect(autos.every((a) => a.autoFixable && a.surfaceClass === 'auto-fixable')).toBe(
      true,
    )
  })

  it('exact compare passes for a clone of expected', () => {
    const expected = loadExpectedFindings()
    expect(compareFindingsExact(expected, expected)).toEqual({ ok: true })
  })

  it('exact compare fails on missing or extra', () => {
    const expected = loadExpectedFindings()
    const missing = expected.slice(1)
    const miss = compareFindingsExact(missing, expected)
    expect(miss.ok).toBe(false)
    if (!miss.ok) expect(miss.reason).toMatch(/missing/)

    const extra = [
      ...expected,
      {
        topicId: '99',
        verdict: 'auto-fake',
        pageUrl: 'https://seoranko-fixture.vercel.app/x',
        surfaceClass: 'auto-fixable',
        autoFixable: true,
      },
    ]
    const ex = compareFindingsExact(extra, expected)
    expect(ex.ok).toBe(false)
    if (!ex.ok) expect(ex.reason).toMatch(/extra/)
  })

  it('documents README diffs', () => {
    expect(Array.isArray(expectedReadmeDiff())).toBe(true)
    expect((expectedReadmeDiff() as unknown[]).length).toBeGreaterThan(0)
  })

  it('ENGINEERING_RULES.md requires fixture + expected before auto-fixable', () => {
    const md = readFileSync(join(process.cwd(), 'docs/ENGINEERING_RULES.md'), 'utf8')
    expect(md).toMatch(/expected\.json/)
    expect(md).toMatch(/regression test/)
    expect(md).toMatch(/apply-registry/)
  })

  it('e2e step order covers reset through finalize', () => {
    expect(E2E_STEP_ORDER[0]).toBe('reset_seed')
    expect(E2E_STEP_ORDER[E2E_STEP_ORDER.length - 1]).toBe('finalize')
  })
})
