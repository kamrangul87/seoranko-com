import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyPrForReceiptRecovery } from './recover-stale-prs'

describe('classifyPrForReceiptRecovery', () => {
  it('maps merged / closed / open without merging anything', () => {
    expect(classifyPrForReceiptRecovery({ ok: true, merged: true, state: 'closed' })).toBe(
      'merged',
    )
    expect(classifyPrForReceiptRecovery({ ok: true, merged: false, state: 'closed' })).toBe(
      'closed',
    )
    expect(classifyPrForReceiptRecovery({ ok: true, merged: false, state: 'open' })).toBe(
      'open',
    )
    expect(classifyPrForReceiptRecovery({ ok: false })).toBe('unknown')
  })

  it('does not call merge on customer PRs', () => {
    const src = readFileSync(join(__dirname, 'recover-stale-prs.ts'), 'utf8')
    expect(src).not.toMatch(/mergePullRequest/)
  })
})
