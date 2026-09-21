import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  useMemoryFixFlowStore,
  resetMemoryFixFlowStore,
} from '../fix-flow/persist'
import { approveFix, commitFix, verifyFix } from '../fix-flow/orchestrate'
import { applyTopic49AutoSetDimensions } from '../fix-flow/apply-topic-49'
import { previewPageUrl } from '../fix-flow/wait-vercel-deploy'
import { setImgDimensions } from '@/lib/fix-strategies/topic-49/fix-set-dimensions'

describe('topic 49 apply', () => {
  it('sets height from intrinsic when width present and height:auto CSS', async () => {
    const html = `<!doctype html><html><head><style>img{height:auto;width:100%}</style></head>
<body>
<img src="/images/a.jpg" width="1200" style="width:100%;height:auto">
</body></html>`

    // Mock fetch for image headers — return a minimal JPEG SOF with 1200x675
    const jpeg = buildJpeg(1200, 675)
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('a.jpg')) {
        return new Response(jpeg, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

    const result = await applyTopic49AutoSetDimensions(
      html,
      'https://example.com/blog/page.html',
      fetchImpl,
    )
    expect(result.updated).toBeGreaterThanOrEqual(1)
    expect(result.html).toMatch(/width="1200"/)
    expect(result.html).toMatch(/height="675"/)
  })

  it('setImgDimensions is deterministic', () => {
    const { html, updated } = setImgDimensions(
      '<img class="x" src="/a.png">',
      '/a.png',
      100,
      50,
    )
    expect(updated).toBe(1)
    expect(html).toBe('<img width="100" height="50" class="x" src="/a.png">')
  })
})

describe('fix-flow orchestrate (memory)', () => {
  beforeEach(() => {
    resetMemoryFixFlowStore()
    useMemoryFixFlowStore()
  })

  it('approve → requires credentials for commit (no stub pass)', async () => {
    const finding = {
      id: 'f1',
      siteId: null,
      detectOrigin: null,
      userId: 'u1',
      topicId: '49',
      kind: 'performance/img-missing-dimensions',
      bucket: 'actionable' as const,
      verdict: 'auto-set-dimensions',
      severity: 'moderate',
      rollupKey: '49|auto-set-dimensions|x',
      declarationSite: null,
      affectedUrlCount: 1,
      pageUrl: 'https://example.com/blog/x.html',
      detail: 'missing height',
      autoFixable: true,
      reportOnly: false,
      surfaceClass: 'auto-fixable',
      proposedDiff: {
        summary: 'Set dims',
        before: '<img src="/a.jpg" width="1200">',
        after: '<img width="1200" height="675" src="/a.jpg">',
      },
      evidenceValues: null,
      sourceRows: [],
      firstSeenRunId: null,
      lastSeenRunId: null,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    }

    const approved = await approveFix('f1', 'u1')
    expect(approved.step).toBe('approved')
    expect(approved.commitStub).toBe(false)

    const committed = await commitFix({
      findingId: 'f1',
      userId: 'u1',
      finding,
    })
    expect(committed.step).toBe('failed')
    expect(committed.commitStub).toBe(false)
    expect(committed.commitDetail).toMatch(/credentials|GitHub/i)
  })

  it('verify refuses before commit', async () => {
    const finding = {
      id: 'f2',
      siteId: null,
      detectOrigin: null,
      userId: 'u1',
      topicId: '49',
      kind: 'performance/img-missing-dimensions',
      bucket: 'actionable' as const,
      verdict: 'auto-set-dimensions',
      severity: 'moderate',
      rollupKey: 'k',
      declarationSite: null,
      affectedUrlCount: 1,
      pageUrl: 'https://example.com/x.html',
      detail: 'd',
      autoFixable: true,
      reportOnly: false,
      surfaceClass: 'auto-fixable',
      proposedDiff: null,
      evidenceValues: null,
      sourceRows: [],
      firstSeenRunId: null,
      lastSeenRunId: null,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    }
    const v = await verifyFix({
      findingId: 'f2',
      userId: 'u1',
      finding,
    })
    expect(v.step).toBe('failed')
    expect(v.verifyOk).toBe(false)
  })
})

describe('previewPageUrl', () => {
  it('joins preview origin with production path', () => {
    expect(
      previewPageUrl(
        'https://fix-49-xyz.vercel.app',
        'https://autodun.com/blog/mot-advisories-explained-uk.html',
      ),
    ).toBe(
      'https://fix-49-xyz.vercel.app/blog/mot-advisories-explained-uk.html',
    )
  })
})

/** Minimal JPEG with SOF0 width/height for intrinsic reader. */
function buildJpeg(width: number, height: number): Uint8Array {
  const sof = [
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01, 0x11, 0x00, 0x02,
  ]
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ...sof,
    0xff, 0xd9,
  ])
}
