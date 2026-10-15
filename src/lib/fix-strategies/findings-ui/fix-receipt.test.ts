import { describe, expect, it } from 'vitest'
import { ownerPlainEnglish } from './owner-copy'

describe('fix receipt copy', () => {
  it('uses owner-plain-english for known auto-fix verdicts (no jargon dump)', () => {
    const line = ownerPlainEnglish('auto-set-dimensions')
    expect(line.length).toBeGreaterThan(10)
    expect(line.toLowerCase()).not.toMatch(/\bseo score\b/)
    expect(line.toLowerCase()).not.toMatch(/\branking\b/)
  })

  it('share path shape is /receipt/<token>', () => {
    const token = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    expect(`/receipt/${token}`).toMatch(/^\/receipt\/[a-z0-9-]+$/i)
  })
})
