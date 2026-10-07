import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
} from './index'
import { withStepTimeout, StepTimeoutError } from './step-timeout'
import { detectImgMissingDimensions } from '@/lib/fix-strategies/topic-49'
import { detectWwwNonWwwDuplicates } from '@/lib/fix-strategies/topic-10'
import { readImageIntrinsicSize } from '@/lib/fix-strategies/shared/image-intrinsic-size'

const FIXTURE_ROOT = join(
  process.cwd(),
  'fixtures/seoranko-fixture-site',
)

const crawlOneUrlMock = vi.hoisted(() => vi.fn())

vi.mock('./fetch-page', () => ({
  crawlOneUrl: (...args: unknown[]) => crawlOneUrlMock(...args),
}))

vi.mock('./run-detectors', async () => {
  const actual = await vi.importActual<typeof import('./run-detectors')>(
    './run-detectors',
  )
  return {
    ...actual,
    runDetectorsOnPages: vi.fn(async () => []),
    rollupAndClassify: vi.fn(() => ({ findings: [], internalEvidence: [] })),
  }
})

function okPage(url: string) {
  return {
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    html: '<html><body><h1>ok</h1><p>content</p></body></html>',
    rawHtml: '<html><body><h1>ok</h1><p>content</p></body></html>',
    headers: new Headers({ 'content-type': 'text/html' }),
    streamComplete: true,
    clientOnly: false,
    stable: true,
    crawlerCausedBackoff: false,
    evidence: { attempts: [] },
    errorDetail: null,
    renderMode: 'http' as const,
    rawHtmlHash: null,
    renderedHtmlHash: null,
    renderEvidence: null,
  }
}

describe('crawl stall guards', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    crawlOneUrlMock.mockReset()
  })

  it('reads the fixture 1×1 JPEG and topic-49 does not hang', async () => {
    const jpeg = readFileSync(join(FIXTURE_ROOT, 'images/hero.jpg'))
    const html = readFileSync(join(FIXTURE_ROOT, 'blog/index.html'), 'utf8')
    const size = readImageIntrinsicSize(jpeg)
    expect(size).toEqual({ width: 1, height: 1, format: 'jpeg' })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input)
      if (u.includes('/images/hero.jpg')) {
        return new Response(jpeg, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      }
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })

    const t0 = Date.now()
    const result = await detectImgMissingDimensions(
      html,
      'https://seoranko-fixture.vercel.app/blog/',
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(result.findings[0]?.intrinsic).toEqual({
      width: 1,
      height: 1,
      format: 'jpeg',
    })
  })

  it('cuts off a hanging page step and completes the run with that URL failed', async () => {
    await expect(
      withStepTimeout(
        'fetch',
        40,
        () =>
          new Promise(() => {
            /* hang */
          }),
      ),
    ).rejects.toBeInstanceOf(StepTimeoutError)

    const { processCrawlTick } = await import('./orchestrator')
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-stall',
      userId: 'u',
      origin: 'https://example.com',
    })
    await store.enqueueUrls(run.id, [
      'https://example.com/ok',
      'https://example.com/hang',
    ])

    crawlOneUrlMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/hang')) {
        await new Promise(() => {
          /* never resolves — step timeout must cut this off */
        })
      }
      return okPage(String(url))
    })

    await processCrawlTick(run.id, {
      store,
      chunkSize: 2,
      deadlineMs: 5_000,
      stepTimeoutMs: 80,
    })
    const jobs = await store.listJobsForRun(run.id)
    const hang = jobs.find((j) => j.url.endsWith('/hang'))
    const ok = jobs.find((j) => j.url.endsWith('/ok'))
    expect(ok?.status).toBe('crawled')
    expect(hang?.status).toBe('failed')
    expect(hang?.errorDetail).toMatch(/^step_timeout:fetch:/)
    const after = await store.getRun(run.id)
    expect(after?.urlsCrawled).toBeGreaterThanOrEqual(1)
    expect(after?.urlsFailed).toBeGreaterThanOrEqual(1)
    // Hang was cut off — remaining queued work is zero (both jobs terminal).
    expect(jobs.every((j) => j.status !== 'running')).toBe(true)
    expect(jobs.every((j) => j.status !== 'queued')).toBe(true)
  })

  it('advances run counters after each job, not only at tick end', async () => {
    const { processCrawlTick } = await import('./orchestrator')
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-counters',
      userId: 'u',
      origin: 'https://example.com',
    })
    await store.enqueueUrls(run.id, [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ])

    const seenCrawled: number[] = []
    const realUpdate = store.updateRun.bind(store)
    store.updateRun = async (runId, patch) => {
      const next = await realUpdate(runId, patch)
      if (patch.urlsCrawled != null) seenCrawled.push(patch.urlsCrawled)
      return next
    }

    crawlOneUrlMock.mockImplementation(async (url: string) => okPage(String(url)))

    await processCrawlTick(run.id, {
      store,
      chunkSize: 3,
      deadlineMs: 10_000,
      stepTimeoutMs: 2_000,
    })
    // Per-job flushes: 1, then 2, then 3 (before final tick update)
    expect(seenCrawled).toEqual(expect.arrayContaining([1, 2, 3]))
    expect(seenCrawled.indexOf(1)).toBeLessThan(seenCrawled.indexOf(2))
    expect(seenCrawled.indexOf(2)).toBeLessThan(seenCrawled.indexOf(3))
    const after = await store.getRun(run.id)
    expect(after?.urlsCrawled).toBe(3)
  })

  it('topic-10 www peer TLS/network failure does not throw', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      if (u.hostname.startsWith('www.')) {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
        })
      }
      return new Response('<html><body>ok</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })
    const result = await detectWwwNonWwwDuplicates(
      [
        {
          url: 'https://seoranko-fixture.vercel.app/blog/',
          body: '<html><body>ok</body></html>',
        },
      ],
      { deps: { fetch: fetchMock as unknown as typeof fetch } },
    )
    expect(
      result.suppressed.some((s) => s.verdict === 'suppress-not-applicable'),
    ).toBe(true)
    expect(result.findings).toHaveLength(0)
  })
})
