/**
 * Resumable post-crawl: phases, cursors, persist inspection+graph,
 * never complete with phases outstanding.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  POST_CRAWL_PHASE_IDS,
  type WholeSitePageInput,
} from './index'
import {
  advancePostCrawlPhases,
  isPostCrawlComplete,
  nextPostCrawlPhase,
} from './post-crawl'
import {
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
} from './store'
import { applyPostCrawlTick, wholeSitePagesFromJobs } from './post-crawl'
import { processCrawlTick } from './orchestrator'

vi.mock('@/lib/fix-strategies/topic-26', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/fix-strategies/topic-26')>()
  return {
    ...actual,
    detectSitemapNotIndexableLocs: vi.fn(
      async (locs: string[], ctx: { artefactPath: string }) => ({
        findings: [],
        ok: locs,
        fixTarget: {
          action: 'fix-artefact' as const,
          artefactPath: ctx.artefactPath,
          generatorPath: null,
          targetPath: ctx.artefactPath,
          reason: 'test',
        },
      }),
    ),
  }
})

vi.mock('@/lib/fix-strategies/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fix-strategies/shared')>()
  return {
    ...actual,
    inspectSiteSitemaps: vi.fn(async ({ originUrl }: { originUrl: string }) => {
      const robots = actual.robotsInspectionFromBody(
        'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n',
        { url: `${originUrl}/robots.txt` },
      )
      return actual.buildSitemapInspection({
        originUrl,
        robots,
        documents: [
          actual.documentFromBody(
            `${originUrl}/sitemap.xml`,
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>${originUrl}/</loc></url>
              <url><loc>${originUrl}/a</loc></url>
              <url><loc>${originUrl}/b</loc></url>
            </urlset>`,
            { origin: 'robots-declaration' },
          ),
        ],
      })
    }),
  }
})

function page(url: string, html = '<html><head><title>T</title></head><body><a href="/">home</a><p>hello world content here for words</p></body></html>'): WholeSitePageInput {
  return {
    url,
    html,
    status: 200,
    clientOnly: false,
    inSitemap: true,
  }
}

describe('post-crawl phase machine', () => {
  it('orders phases with resolve_sources after rollup and done terminal', () => {
    expect(POST_CRAWL_PHASE_IDS[0]).toBe('persist_inspection')
    expect(POST_CRAWL_PHASE_IDS[POST_CRAWL_PHASE_IDS.length - 1]).toBe(
      'resolve_sources',
    )
    expect(nextPostCrawlPhase('rollup')).toBe('resolve_sources')
    expect(nextPostCrawlPhase('resolve_sources')).toBe('done')
    expect(isPostCrawlComplete('done')).toBe(true)
    expect(isPostCrawlComplete('full_snapshot')).toBe(false)
    expect(isPostCrawlComplete(null)).toBe(false)
  })

  it('persists inspection once and resumes from phase without rebuilding', async () => {
    const pages = [
      page('https://example.com/'),
      page('https://example.com/a'),
      page('https://example.com/b'),
    ]
    const first = await advancePostCrawlPhases({
      origin: 'https://example.com',
      pages,
      phase: null,
      cursor: null,
      sitemapInspection: null,
      linkGraph: null,
      deadlineAt: Date.now() + 60_000,
    })
    expect(first.sitemapInspection).not.toBeNull()
    expect(first.phase).not.toBe('persist_inspection')

    const shared = first.sitemapInspection
    const second = await advancePostCrawlPhases({
      origin: 'https://example.com',
      pages,
      phase: first.phase,
      cursor: first.cursor,
      sitemapInspection: shared,
      linkGraph: first.linkGraph,
      deadlineAt: Date.now() + 60_000,
    })
    // Same serialized inspection object identity preserved across ticks
    expect(second.sitemapInspection).toBe(shared)
  })

  it('yields before full_snapshot when other work already ran this tick', async () => {
    const pages = [
      page('https://example.com/'),
      page('https://example.com/a'),
    ]
    // Drive to just before full_snapshot
    let phase = null as Parameters<typeof advancePostCrawlPhases>[0]['phase']
    let cursor = null as Parameters<typeof advancePostCrawlPhases>[0]['cursor']
    let sitemapInspection: unknown | null = null
    let linkGraph: unknown | null = null
    for (let i = 0; i < 40; i++) {
      const adv = await advancePostCrawlPhases({
        origin: 'https://example.com',
        pages,
        phase,
        cursor,
        sitemapInspection,
        linkGraph,
        deadlineAt: Date.now() + 120_000,
        // Force yield: pretend URL work already happened when we reach full_snapshot
        sharedTickWithUrlWork: true,
      })
      phase = adv.phase
      cursor = adv.cursor
      sitemapInspection = adv.sitemapInspection
      linkGraph = adv.linkGraph
      if (phase === 'full_snapshot') break
      if (adv.complete) break
    }
    expect(phase).toBe('full_snapshot')
    expect(linkGraph).not.toBeNull()
    expect(sitemapInspection).not.toBeNull()

    // Same tick flag still set → must not enter full_snapshot
    const blocked = await advancePostCrawlPhases({
      origin: 'https://example.com',
      pages,
      phase: 'full_snapshot',
      cursor: null,
      sitemapInspection,
      linkGraph,
      sharedTickWithUrlWork: true,
      deadlineAt: Date.now() + 120_000,
    })
    expect(blocked.phase).toBe('full_snapshot')
    expect(blocked.complete).toBe(false)

    // Fresh tick → full_snapshot + rollup → resolve_sources (caller finishes)
    const finished = await advancePostCrawlPhases({
      origin: 'https://example.com',
      pages,
      phase: 'full_snapshot',
      cursor: null,
      sitemapInspection,
      linkGraph,
      sharedTickWithUrlWork: false,
      deadlineAt: Date.now() + 120_000,
    })
    expect(finished.complete).toBe(false)
    expect(finished.phase).toBe('resolve_sources')
    expect(finished.didRollup).toBe(true)
  })

  it('chunks topic 26 by loc cursor across ticks', async () => {
    const { detectSitemapNotIndexableLocs } = await import(
      '@/lib/fix-strategies/topic-26'
    )
    const pages = [page('https://example.com/')]
    const seeded = await advancePostCrawlPhases({
      origin: 'https://example.com',
      pages,
      phase: null,
      cursor: null,
      sitemapInspection: null,
      linkGraph: null,
      deadlineAt: Date.now() + 120_000,
    })
    expect(seeded.sitemapInspection).not.toBeNull()

    // Slow classify: sleep so only one loc fits in the window
    vi.mocked(detectSitemapNotIndexableLocs).mockImplementation(
      async (locs: string[]) => {
        await new Promise((r) => setTimeout(r, 40))
        return {
          findings: [],
          ok: locs,
          fixTarget: {
            action: 'fix-artefact' as const,
            artefactPath: 'sitemap.xml',
            generatorPath: null,
            targetPath: 'sitemap.xml',
            reason: 'test',
          },
        }
      },
    )

    const chunk = await advancePostCrawlPhases({
      origin: 'https://example.com',
      pages,
      phase: 'topic_26',
      cursor: { locIndex: 0 },
      sitemapInspection: seeded.sitemapInspection,
      linkGraph: seeded.linkGraph,
      deadlineAt: Date.now() + 50,
    })
    expect(chunk.phase).toBe('topic_26')
    expect(chunk.cursor?.locIndex).toBeGreaterThanOrEqual(1)
    expect(chunk.complete).toBe(false)

    // Resume from cursor → finish remaining locs
    const rest = await advancePostCrawlPhases({
      origin: 'https://example.com',
      pages,
      phase: 'topic_26',
      cursor: chunk.cursor,
      sitemapInspection: seeded.sitemapInspection,
      linkGraph: seeded.linkGraph,
      deadlineAt: Date.now() + 120_000,
    })
    expect(rest.phase).not.toBe('topic_26')
  })
})

describe('orchestrator never completes with post-crawl outstanding', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
  })

  it('stays running after frontier drain until post-crawl done', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-pc',
      userId: 'user-pc',
      origin: 'https://example.com',
    })
    await store.enqueueUrls(run.id, ['https://example.com/'])
    await store.updateRun(run.id, {
      status: 'running',
      urlsDiscovered: 1,
      urlsFound: 1,
      startedAt: new Date().toISOString(),
    })
    // Mark the only job crawled with HTML so frontier drains without fetch
    const jobs = await store.listJobsForRun(run.id)
    await store.updateUrlJob(jobs[0]!.id, {
      status: 'crawled',
      httpStatus: 200,
      finalUrl: 'https://example.com/',
      html: page('https://example.com/').html,
      streamComplete: true,
      processedAt: new Date().toISOString(),
    })

    // First tick: frontier empty → enter post-crawl, must not complete yet
    // unless everything fits (with mocks it might). Force phase mid-way.
    await store.updateRun(run.id, { postCrawlPhase: 'topic_26', postCrawlCursor: { locIndex: 0 } })
    // Need inspection+graph persisted for topic_26
    const seeded = await advancePostCrawlPhases({
      origin: 'https://example.com',
      pages: wholeSitePagesFromJobs(await store.listJobsForRun(run.id)),
      phase: null,
      cursor: null,
      sitemapInspection: null,
      linkGraph: null,
      deadlineAt: Date.now() + 60_000,
    })
    // Run until we have artifacts, then set phase to topic_26 mid-way
    await store.updateRun(run.id, {
      sitemapInspection: seeded.sitemapInspection,
      linkGraph: seeded.linkGraph,
      postCrawlPhase: 'topic_26',
      postCrawlCursor: { locIndex: 0 },
    })

    const tick = await processCrawlTick(run.id, {
      store,
      deadlineMs: 5,
    })
    expect(tick.done).toBe(false)
    expect(tick.status).toBe('running')
    const after = await store.getRun(run.id)
    expect(after?.finishedAt).toBeNull()
    expect(isPostCrawlComplete(after?.postCrawlPhase ?? null)).toBe(false)
  })

  it('applyPostCrawlTick persists phase on the run', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-pc2',
      userId: 'user-pc2',
      origin: 'https://example.com',
    })
    await store.enqueueUrls(run.id, ['https://example.com/'])
    const jobs = await store.listJobsForRun(run.id)
    await store.updateUrlJob(jobs[0]!.id, {
      status: 'crawled',
      httpStatus: 200,
      finalUrl: 'https://example.com/',
      html: page('https://example.com/').html,
      streamComplete: true,
      processedAt: new Date().toISOString(),
    })
    const pages = wholeSitePagesFromJobs(await store.listJobsForRun(run.id))
    const adv = await applyPostCrawlTick({
      store,
      run: (await store.getRun(run.id))!,
      pages,
      deadlineAt: Date.now() + 120_000,
    })
    const updated = await store.getRun(run.id)
    expect(updated?.postCrawlPhase).toBe(adv.phase)
    expect(updated?.sitemapInspection).not.toBeNull()
  })
})
