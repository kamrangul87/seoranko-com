import { describe, expect, it } from 'vitest'
import { crawlFetchInit, CRAWL_FETCH_CACHE } from './crawl-fetch'

describe('crawlFetchInit', () => {
  it('forces Next.js no-store and no-cache headers', () => {
    const init = crawlFetchInit({
      headers: { 'User-Agent': 'test' },
      redirect: 'manual',
    })
    expect(init.cache).toBe(CRAWL_FETCH_CACHE)
    expect(init.cache).toBe('no-store')
    const headers = new Headers(init.headers)
    expect(headers.get('Cache-Control')).toBe('no-cache')
    expect(headers.get('Pragma')).toBe('no-cache')
    expect(headers.get('User-Agent')).toBe('test')
    expect(init.redirect).toBe('manual')
  })
})
