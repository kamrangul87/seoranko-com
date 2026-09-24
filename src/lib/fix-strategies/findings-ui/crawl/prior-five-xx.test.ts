import { describe, expect, it, beforeEach } from 'vitest'
import {
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
} from './index'
import { buildPriorFiveXXByUrl } from './orchestrator'

describe('buildPriorFiveXXByUrl', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
  })

  it('finds the most recent OTHER run\'s 5xx jobs for this scope, keyed by finalUrl', async () => {
    const store = createMemoryFindingsStore()
    const run1 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.enqueueUrls(run1.id, ['https://example.com/down', 'https://example.com/up'])
    const jobs1 = await store.claimUrlChunk(run1.id, 10)
    for (const j of jobs1) {
      if (j.url.endsWith('/down')) {
        await store.updateUrlJob(j.id, { status: 'crawled', httpStatus: 503, finalUrl: j.url })
      } else {
        await store.updateUrlJob(j.id, { status: 'crawled', httpStatus: 200, finalUrl: j.url })
      }
    }

    const run2 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })

    const priorByUrl = await buildPriorFiveXXByUrl(store, run2)
    expect(priorByUrl.get('https://example.com/down')?.status).toBe(503)
    expect(priorByUrl.has('https://example.com/up')).toBe(false)
    expect(typeof priorByUrl.get('https://example.com/down')?.observedAtMs).toBe('number')
  })

  it('returns empty when there is no prior run in this scope', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({ siteId: 'site-fresh', userId: 'user-a', origin: 'https://example.com' })
    const priorByUrl = await buildPriorFiveXXByUrl(store, run)
    expect(priorByUrl.size).toBe(0)
  })

  it('never mixes another site\'s prior 5xx into this scope', async () => {
    const store = createMemoryFindingsStore()
    const otherRun = await store.createRun({ siteId: 'site-b', userId: 'user-b', origin: 'https://other.example.com' })
    await store.enqueueUrls(otherRun.id, ['https://other.example.com/down'])
    const otherJobs = await store.claimUrlChunk(otherRun.id, 10)
    await store.updateUrlJob(otherJobs[0]!.id, { status: 'crawled', httpStatus: 503, finalUrl: otherJobs[0]!.url })

    const run = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    const priorByUrl = await buildPriorFiveXXByUrl(store, run)
    expect(priorByUrl.size).toBe(0)
  })

  it('ignores a prior job that never reached a terminal status (no processedAt)', async () => {
    const store = createMemoryFindingsStore()
    const run1 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.enqueueUrls(run1.id, ['https://example.com/stuck'])
    // Left 'queued' — never transitions to crawled/failed/client_only, so
    // processedAt stays null, exactly like the still-running autodun runs
    // found in production during this investigation.

    const run2 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    const priorByUrl = await buildPriorFiveXXByUrl(store, run2)
    expect(priorByUrl.size).toBe(0)
  })
})
