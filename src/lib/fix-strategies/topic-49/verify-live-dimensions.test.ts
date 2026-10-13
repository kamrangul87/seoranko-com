/**
 * Topic 49 live dimension postcondition — exact blog/index.html + hero.jpg case.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readImageIntrinsicSize } from '@/lib/fix-strategies/shared/image-intrinsic-size'
import { verifyLiveImgDimensions } from './verify-live-dimensions'

const FIX = join(__dirname, '__fixtures__')
const BLOG_HTML = readFileSync(join(FIX, 'blog-index-fixed.html'), 'utf8')
const HERO = readFileSync(join(FIX, 'hero-1200x675.jpg'))

const PREVIEW_ORIGIN = 'https://seoranko-fixture-158c8b6-preview.vercel.app'
const PROD_ORIGIN = 'https://seoranko-fixture.vercel.app'

describe('verifyLiveImgDimensions — blog/index.html + hero.jpg', () => {
  it('fixture JPEG is intrinsically 1200×675', () => {
    const size = readImageIntrinsicSize(HERO)
    expect(size).toEqual({ width: 1200, height: 675, format: 'jpeg' })
  })

  it('passes when page HTML and image are fetched from the same preview deployment', async () => {
    const fetches: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      fetches.push(url)
      if (url === `${PREVIEW_ORIGIN}/images/hero.jpg`) {
        return new Response(HERO, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      }
      return new Response('missing', { status: 404 })
    }) as unknown as typeof fetch

    const live = await verifyLiveImgDimensions(
      BLOG_HTML,
      `${PREVIEW_ORIGIN}/blog/`,
      fetchImpl,
    )
    expect(live.ok).toBe(true)
    expect(live.detail).toMatch(/match/i)
    expect(fetches).toEqual([`${PREVIEW_ORIGIN}/images/hero.jpg`])
    expect(live.diagnostics?.deploymentUrl).toBe(`${PREVIEW_ORIGIN}/blog/`)
  })

  it('fails with diagnostics when image is served from production (wrong origin) with mismatched size', async () => {
    // 1×1 JPEG — stands in for a stale production / older preview asset.
    const stale = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
      0x00, ...Array(64).fill(1), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00,
      0x3f, 0x00, 0x00, 0xff, 0xd9,
    ])

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      // Bug class: relative src resolved against production instead of preview.
      if (url === `${PROD_ORIGIN}/images/hero.jpg`) {
        return new Response(stale, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      }
      if (url === `${PREVIEW_ORIGIN}/images/hero.jpg`) {
        return new Response(HERO, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      }
      return new Response('missing', { status: 404 })
    }) as unknown as typeof fetch

    // Intentionally wrong base (production) — must fail and name the mismatch.
    const live = await verifyLiveImgDimensions(
      BLOG_HTML,
      `${PROD_ORIGIN}/blog/`,
      fetchImpl,
    )
    expect(live.ok).toBe(false)
    expect(live.detail).toMatch(/fail dimension postcondition/)
    expect(live.failures[0]?.reason).toMatch(/intrinsic/)
    const d = live.diagnostics?.images[0]
    expect(d?.resolvedImgUrl).toBe(`${PROD_ORIGIN}/images/hero.jpg`)
    expect(d?.httpStatus).toBe(200)
    expect(d?.intrinsicWidth).toBe(1)
    expect(d?.intrinsicHeight).toBe(1)
    expect(d?.attrWidth).toBe(1200)
    expect(d?.attrHeight).toBe(675)
    expect(d?.heightAuto).toBe(true)
    expect(d?.failedCondition).toMatch(/ratio/i)
  })
})
