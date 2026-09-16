import { describe, expect, it, vi } from 'vitest'
import {
  detectImgMissingDimensions,
  setImgDimensions,
  verifyLiveImgDimensions,
} from '@/lib/fix-strategies/topic-49'

const ORIGIN = 'https://example.com'

/** Minimal PNG IHDR header — dimensions only, no pixel data required. */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b[11] = 13
  b.set([0x49, 0x48, 0x44, 0x52], 12)
  b[16] = (width >>> 24) & 0xff
  b[17] = (width >>> 16) & 0xff
  b[18] = (width >>> 8) & 0xff
  b[19] = width & 0xff
  b[20] = (height >>> 24) & 0xff
  b[21] = (height >>> 16) & 0xff
  b[22] = (height >>> 8) & 0xff
  b[23] = height & 0xff
  b[24] = 8
  b[25] = 2
  return b
}

function svgViewBox(): Uint8Array {
  return new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"></svg>',
  )
}

describe('topic 49 — images missing width/height', () => {
  it('classifies the dossier fixture set', async () => {
    const images: Record<string, { status: number; body: Uint8Array; type: string }> = {
      '/a.png': {
        status: 200,
        body: pngHeader(1600, 900), // 16:9
        type: 'image/png',
      },
      '/b.png': {
        status: 200,
        body: pngHeader(1600, 900),
        type: 'image/png',
      },
      '/wrong.png': {
        status: 200,
        body: pngHeader(1920, 1080), // 16:9 intrinsic
        type: 'image/png',
      },
      '/ok.png': {
        status: 200,
        body: pngHeader(800, 600), // 4:3
        type: 'image/png',
      },
      '/icon.svg': {
        status: 200,
        body: svgViewBox(),
        type: 'image/svg+xml',
      },
      '/missing.png': {
        status: 404,
        body: new Uint8Array(),
        type: 'text/plain',
      },
      '/ss-a.png': {
        status: 200,
        body: pngHeader(1600, 900), // 16:9
        type: 'image/png',
      },
      '/ss-b.png': {
        status: 200,
        body: pngHeader(800, 600), // 4:3 — mismatch
        type: 'image/png',
      },
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const path = new URL(url).pathname
      const img = images[path]
      if (!img) return new Response('no', { status: 404 })
      return new Response(img.body, {
        status: img.status,
        headers: { 'content-type': img.type },
      })
    })

    const html = `<!doctype html><html><head>
      <style>
        .fluid { max-width: 100%; height: auto; }
        .fixed { width: 200px; }
      </style>
    </head><body>
      <!-- 1. no dims + height:auto → auto-fix -->
      <img class="fluid" src="/a.png" alt="a">
      <!-- 2. no dims, no height:auto → human-review -->
      <img class="fixed" src="/b.png" alt="b">
      <!-- 3. 4:3 declared on 16:9 intrinsic → HIGH -->
      <img class="fluid" src="/wrong.png" width="400" height="300" alt="wrong">
      <!-- 4. correct dimensions → nothing -->
      <img src="/ok.png" width="800" height="600" alt="ok">
      <!-- 5. SVG viewBox → nothing -->
      <img src="/icon.svg" alt="svg">
      <!-- 6. 404 source → human-review -->
      <img class="fluid" src="/missing.png" alt="missing">
      <!-- 7. srcset mismatched ratios → moderate -->
      <img class="fluid" src="/ss-a.png" srcset="/ss-a.png 1x, /ss-b.png 2x" alt="ss">
    </body></html>`

    const detected = await detectImgMissingDimensions(html, `${ORIGIN}/page`, {
      fetch: fetchMock as unknown as typeof fetch,
      artefactPath: 'app/page.tsx',
    })

    const bySrc = Object.fromEntries(
      detected.findings.map((f) => [new URL(f.src).pathname, f]),
    )

    // 1. auto-fix
    expect(bySrc['/a.png']?.verdict).toBe('auto-set-dimensions')
    expect(bySrc['/a.png']?.severity).toBe('moderate')
    expect(bySrc['/a.png']?.proposed).toEqual({ width: 1600, height: 900 })

    // 2. human-review — no height:auto
    expect(bySrc['/b.png']?.verdict).toBe('human-review-no-height-auto')

    // 3. HIGH severity — wrong ratio
    expect(bySrc['/wrong.png']?.severity).toBe('high')
    expect(bySrc['/wrong.png']?.verdict).toBe('finding-wrong-ratio')

    // 4 + 5 — nothing
    expect(bySrc['/ok.png']).toBeUndefined()
    expect(bySrc['/icon.svg']).toBeUndefined()
    expect(
      detected.ok.some((o) => o.src === '/ok.png' || o.src.includes('ok.png')),
    ).toBe(true)
    expect(
      detected.ok.some((o) => o.src.includes('icon.svg')),
    ).toBe(true)

    // 6. 404 → human-review
    expect(bySrc['/missing.png']?.verdict).toBe(
      'human-review-unreadable-dimensions',
    )

    // 7. srcset mismatch → moderate
    expect(bySrc['/ss-a.png']?.verdict).toBe('finding-srcset-ratio-mismatch')
    expect(bySrc['/ss-a.png']?.severity).toBe('moderate')

    // Apply auto-fix for first; live verify (no CLS claim)
    const fixed = setImgDimensions(
      html,
      '/a.png',
      bySrc['/a.png']!.proposed!.width,
      bySrc['/a.png']!.proposed!.height,
    )
    expect(fixed.updated).toBe(1)
    expect(fixed.html).toMatch(/<img[^>]*width="1600"[^>]*height="900"/)

    // Also correct the wrong-ratio and srcset cases for a clean postcondition
    // on the auto-fixed image alone: verify page after only fixing /a.png still
    // fails overall (other findings remain) — check /a.png specifically via
    // a page with only that img.
    const solo = `<!doctype html><html><head><style>.fluid{height:auto}</style></head><body>
      <img class="fluid" src="/a.png" alt="a">
    </body></html>`
    const soloDetected = await detectImgMissingDimensions(solo, `${ORIGIN}/p`, {
      fetch: fetchMock as unknown as typeof fetch,
    })
    const soloFinding = soloDetected.findings[0]!
    const soloFixed = setImgDimensions(
      solo,
      '/a.png',
      soloFinding.proposed!.width,
      soloFinding.proposed!.height,
    )
    const live = await verifyLiveImgDimensions(
      soloFixed.html,
      `${ORIGIN}/p`,
      fetchMock as unknown as typeof fetch,
    )
    expect(live.ok).toBe(true)
    expect(live.detail.toLowerCase()).not.toContain('cls')
    expect(live.detail.toLowerCase()).not.toContain('cumulative layout')

    // Verifier must not import fixer
    const fs = await import('node:fs')
    const path = await import('node:path')
    const verifySrc = fs.readFileSync(
      path.join(__dirname, '../../topic-49/verify-live-dimensions.ts'),
      'utf8',
    )
    expect(verifySrc).not.toMatch(/fix-set-dimensions/)
    expect(verifySrc).not.toMatch(/setImgDimensions/)
  })
})
