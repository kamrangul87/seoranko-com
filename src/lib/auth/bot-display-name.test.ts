import { describe, expect, it } from 'vitest'
import { looksLikeRandomBotDisplayName } from './bot-display-name'

describe('looksLikeRandomBotDisplayName', () => {
  it('flags 15+ letter no-space mixed-random-case bot names', () => {
    expect(looksLikeRandomBotDisplayName('XFzHtjIybtpBqAkNCCmvqM')).toBe(true)
    expect(looksLikeRandomBotDisplayName('cvtTQuOduRLWDugabmDPOh')).toBe(true)
    expect(looksLikeRandomBotDisplayName('vWVsdasEyCxiRkGAw')).toBe(true)
  })

  it('allows normal human names', () => {
    expect(looksLikeRandomBotDisplayName('Jane Smith')).toBe(false)
    expect(looksLikeRandomBotDisplayName('Alexander Hamilton')).toBe(false)
    expect(looksLikeRandomBotDisplayName('José')).toBe(false)
    expect(looksLikeRandomBotDisplayName('Lee')).toBe(false)
  })

  it('allows long PascalCase compounds without random mid-word flips', () => {
    expect(looksLikeRandomBotDisplayName('AlexanderHamilton')).toBe(false)
    expect(looksLikeRandomBotDisplayName('ChristopherAnderson')).toBe(false)
  })

  it('allows all-lower or all-upper letter strings', () => {
    expect(looksLikeRandomBotDisplayName('abcdefghijklmno')).toBe(false)
    expect(looksLikeRandomBotDisplayName('ABCDEFGHIJKLMNO')).toBe(false)
  })

  it('ignores short mixed-case names', () => {
    expect(looksLikeRandomBotDisplayName('AbCdEfGhIj')).toBe(false)
  })
})
