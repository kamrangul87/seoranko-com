import { describe, expect, it, vi } from 'vitest'
import {
  fetchAndInspectRobotsTxt,
  inspectRobotsTxtBody,
  isPathAllowedFromInspection,
} from './robots-txt-inspect'

describe('robots-txt-inspect', () => {
  it('404 → not-found permits crawling; 5xx → complete disallow', async () => {
    const r404 = await fetchAndInspectRobotsTxt('https://example.com', {
      fetch: vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch,
    })
    expect(r404.fetchStatus).toBe('not-found')
    expect(isPathAllowedFromInspection(r404, 'Googlebot', '/any').allowed).toBe(
      true,
    )

    const r5 = await fetchAndInspectRobotsTxt('https://example.com', {
      fetch: vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch,
    })
    expect(r5.fetchStatus).toBe('server-error')
    expect(isPathAllowedFromInspection(r5, 'Googlebot', '/any').allowed).toBe(
      false,
    )
  })

  it('parses crawl-delay and noindex lines once for topic 21 reuse', () => {
    const insp = inspectRobotsTxtBody(
      'User-agent: *\nCrawl-delay: 5\nnoindex: /x\nDisallow: /blocked.css\n',
      {
        url: 'https://example.com/robots.txt',
        status: 200,
        contentType: 'text/plain',
        fetchStatus: 'ok',
      },
    )
    expect(insp.crawlDelayLines).toHaveLength(1)
    expect(insp.noindexLines).toHaveLength(1)
    expect(
      isPathAllowedFromInspection(insp, 'Googlebot', '/blocked.css').allowed,
    ).toBe(false)
  })
})
