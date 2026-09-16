import { describe, expect, it } from 'vitest'
import { hasNoindexDirective } from './response-signals'

describe('hasNoindexDirective', () => {
  it('detects x-robots-tag noindex', () => {
    const headers = new Headers({ 'x-robots-tag': 'noindex, nofollow' })
    expect(hasNoindexDirective(headers, '', 'text/html')).toBe(true)
  })

  it('detects meta robots noindex in HTML', () => {
    const body =
      '<!doctype html><html><head><meta name="robots" content="noindex"></head><body></body></html>'
    expect(hasNoindexDirective(new Headers(), body, 'text/html')).toBe(true)
  })

  it('returns false when neither header nor meta carries noindex', () => {
    const body =
      '<!doctype html><html><head><title>Ok</title></head><body></body></html>'
    expect(hasNoindexDirective(new Headers(), body, 'text/html')).toBe(false)
  })
})
