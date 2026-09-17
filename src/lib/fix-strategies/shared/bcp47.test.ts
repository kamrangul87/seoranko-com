import { describe, expect, it } from 'vitest'
import { isValidBcp47, isIso6391 } from './bcp47'

describe('isValidBcp47', () => {
  it('accepts empty, regional, and script subtags', () => {
    expect(isValidBcp47('')).toBe(true)
    expect(isValidBcp47('en')).toBe(true)
    expect(isValidBcp47('en-GB')).toBe(true)
    expect(isValidBcp47('zh-Hant')).toBe(true)
    expect(isValidBcp47('pt-BR')).toBe(true)
  })

  it('rejects full language names and malformed tags', () => {
    expect(isValidBcp47('english')).toBe(false)
    expect(isValidBcp47('en-')).toBe(false)
    expect(isValidBcp47('-en')).toBe(false)
  })

  it('ISO 639-1 is exactly two letters', () => {
    expect(isIso6391('en')).toBe(true)
    expect(isIso6391('en-GB')).toBe(false)
  })
})
