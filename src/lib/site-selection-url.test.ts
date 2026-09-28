import { afterEach, describe, expect, it } from 'vitest'
import { readParamFromUrl, writeParamToUrl } from './site-selection-url'

// No jsdom in this repo's vitest config (environment: 'node') — stub just
// enough of `window` for these two functions. URL/URLSearchParams are
// real Node globals, not mocked.
function stubWindow(href: string) {
  const state = { href }
  ;(globalThis as unknown as { window: unknown }).window = {
    get location() {
      const u = new URL(state.href)
      return { href: state.href, search: u.search }
    },
    history: {
      replaceState: (_data: unknown, _title: string, url: string) => {
        state.href = new URL(url, state.href).toString()
      },
    },
  }
  return state
}

describe('site-selection-url', () => {
  const ORIGINAL_WINDOW = (globalThis as unknown as { window?: unknown }).window

  afterEach(() => {
    ;(globalThis as unknown as { window?: unknown }).window = ORIGINAL_WINDOW
  })

  it('reads an absent param as null', () => {
    stubWindow('https://seoranko.com/dashboard/findings')
    expect(readParamFromUrl('site')).toBeNull()
  })

  it('reads a present param', () => {
    stubWindow('https://seoranko.com/dashboard/findings?site=abc-123')
    expect(readParamFromUrl('site')).toBe('abc-123')
  })

  it('writes a param without discarding the rest of the URL', () => {
    const state = stubWindow('https://seoranko.com/dashboard/findings?tab=x')
    writeParamToUrl('site', 'abc-123')
    expect(state.href).toBe('https://seoranko.com/dashboard/findings?tab=x&site=abc-123')
    expect(readParamFromUrl('site')).toBe('abc-123')
  })

  it('a second write replaces the first rather than appending a duplicate param', () => {
    stubWindow('https://seoranko.com/dashboard/findings')
    writeParamToUrl('site', 'site-a')
    writeParamToUrl('site', 'site-b')
    expect(readParamFromUrl('site')).toBe('site-b')
  })

  it('writing null removes the param', () => {
    stubWindow('https://seoranko.com/dashboard/findings?site=abc-123')
    writeParamToUrl('site', null)
    expect(readParamFromUrl('site')).toBeNull()
  })

  it('does nothing when window is unavailable (SSR-safe)', () => {
    ;(globalThis as unknown as { window?: unknown }).window = undefined
    expect(readParamFromUrl('site')).toBeNull()
    expect(() => writeParamToUrl('site', 'x')).not.toThrow()
  })
})
