import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildSiteFollowUpTasks } from './follow-up-tasks'
import { applyCanonicalLiveVerification } from './canonical-postprocess'
import type { IndexDiagnosisResult, PageIndexability } from './types'

function canonPage(
  url: string,
  canonicalUrl: string,
  passed: boolean,
): PageIndexability {
  const evidence = passed
    ? `Canonical self-reference: ${canonicalUrl}`
    : `Canonical points to different same-host URL: ${canonicalUrl} (page ${url})`
  return {
    url,
    verdict: passed ? 'INDEXABLE' : 'AT_RISK',
    decisiveStep: passed ? null : 'canonical',
    decisiveEvidence: evidence,
    steps: [{ step: 'canonical', passed, evidence }],
    httpStatus: 200,
    crawlDepth: 1,
    internalLinksIn: 1,
    inboundLinks: [],
    duplicateClusterId: null,
    duplicateClusterSize: 1,
    mainContentFingerprint: 'fp',
    pathPattern: '/blog',
    depthBand: '1',
    pageTitle: 'Blog',
    pageH1: 'Blog',
  }
}

describe('canonical live verification safeguard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clears index.html misconfiguration when live fetch shows self-referencing canonical', async () => {
    const stalePage = canonPage(
      'https://autodun.com/blog/index.html',
      'https://autodun.com/blog/',
      false,
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        url: 'https://autodun.com/blog/index.html',
        text: async () =>
          '<html><head><link rel="canonical" href="https://autodun.com/blog/index.html"></head><body></body></html>',
      }),
    )

    const { pages } = await applyCanonicalLiveVerification([stalePage])
    const canon = pages[0]!.steps.find((s) => s.step === 'canonical')
    expect(canon?.passed).toBe(true)
    expect(pages[0]!.verdict).toBe('INDEXABLE')
  })

  it('does not create follow-up task for directory → index.html consolidation', () => {
    const pages = [
      canonPage('https://autodun.com/blog', 'https://autodun.com/blog/index.html', true),
      canonPage('https://autodun.com/blog/index.html', 'https://autodun.com/blog/index.html', true),
    ]
    const result = {
      pages,
      coverage: { linkedOnlyUrls: [], excluded: [] },
      cohorts: [],
    } as IndexDiagnosisResult
    const tasks = buildSiteFollowUpTasks(result)
    expect(tasks.filter((t) => t.kind === 'canonical')).toHaveLength(0)
  })

  it('creates follow-up task only for index.html → directory mismatch', () => {
    const pages = [
      canonPage('https://autodun.com/blog/index.html', 'https://autodun.com/blog/', false),
    ]
    const result = {
      pages,
      coverage: { linkedOnlyUrls: [], excluded: [] },
      cohorts: [],
    } as IndexDiagnosisResult
    const tasks = buildSiteFollowUpTasks(result)
    expect(tasks.some((t) => t.kind === 'canonical')).toBe(true)
    expect(tasks.find((t) => t.kind === 'canonical')?.affectedUrls).toEqual([
      'https://autodun.com/blog/index.html',
    ])
  })
})
