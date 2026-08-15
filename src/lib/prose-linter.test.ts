import { describe, it, expect } from 'vitest'
import { lintProse } from './prose-linter'

describe('lintProse — apostrophe typography (FIX 4)', () => {
  it('flags a straight apostrophe contraction as info severity only (silent — never a warning/critical)', async () => {
    const findings = await lintProse("We think you'll love this feature once you try it.")
    const apostropheFinding = findings.find(f => f.key === 'apostrophe-style')
    expect(apostropheFinding).toBeDefined()
    expect(apostropheFinding?.severity).toBe('info')
  })

  it('flags a genuinely missing apostrophe as a real warning (not silent)', async () => {
    const findings = await lintProse('The system dont work as expected in this scenario today.')
    const missing = findings.find(f => f.key === 'missing-apostrophe')
    expect(missing).toBeDefined()
    expect(missing?.severity).toBe('warning')
  })

  it('does not surface quote-style findings above info either', async () => {
    const findings = await lintProse('She said "this is a straight-quoted sentence" during the interview.')
    const quoteFinding = findings.find(f => f.key === 'quote-style')
    if (quoteFinding) {
      expect(quoteFinding.severity).toBe('info')
    }
  })
})
