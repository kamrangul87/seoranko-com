import { describe, expect, it } from 'vitest'
import {
  assertSafeToCreateFileAtLiveRoute,
  type LiveRouteCreateContext,
} from './live-route-create-guard'

function ctx(
  partial: Partial<LiveRouteCreateContext> &
    Pick<LiveRouteCreateContext, 'createPath' | 'pageUrl'>,
): LiveRouteCreateContext {
  return {
    treePaths: partial.treePaths ?? ['index.html', 'src/pages/Privacy.tsx'],
    vercelJson: partial.vercelJson ?? null,
    liveStatus: partial.liveStatus ?? 200,
    liveBodySnippet: partial.liveBodySnippet ?? '<h1>Real Privacy Policy</h1><p>Formspree</p>',
    ...partial,
  }
}

describe('assertSafeToCreateFileAtLiveRoute — fail closed', () => {
  it('blocks create when vercel.json rewrites the URL to the SPA shell', () => {
    const r = assertSafeToCreateFileAtLiveRoute(
      ctx({
        createPath: 'public/privacy/index.html',
        pageUrl: 'https://autodun.com/privacy',
        vercelJson: {
          rewrites: [{ source: '/privacy', destination: '/index.html' }],
        },
      }),
    )
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.reason).toMatch(/rewrite|SPA|shell/i)
  })

  it('blocks create when live URL already returns 200 with real content', () => {
    const r = assertSafeToCreateFileAtLiveRoute(
      ctx({
        createPath: 'public/privacy/index.html',
        pageUrl: 'https://autodun.com/privacy',
        // No framework file / rewrite — live 200 alone must fail closed.
        treePaths: ['index.html', 'public/about/index.html'],
        vercelJson: { rewrites: [] },
        liveStatus: 200,
        liveBodySnippet:
          '<html><body><h1>Privacy Policy</h1><p>Formspree processes contact forms</p></body></html>',
      }),
    )
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.reason).toMatch(/live|existing|200/i)
  })

  it('blocks create when a framework route file already exists for the path', () => {
    const r = assertSafeToCreateFileAtLiveRoute(
      ctx({
        createPath: 'public/privacy/index.html',
        pageUrl: 'https://autodun.com/privacy',
        liveStatus: 404,
        liveBodySnippet: '',
        treePaths: ['index.html', 'src/pages/Privacy.tsx', 'vercel.json'],
      }),
    )
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.reason).toMatch(/framework|route|Privacy\.tsx/i)
  })

  it('fixture case: autodun /privacy must fail closed (never create stub)', () => {
    const r = assertSafeToCreateFileAtLiveRoute(
      ctx({
        createPath: 'public/privacy/index.html',
        pageUrl: 'https://autodun.com/privacy',
        treePaths: [
          'index.html',
          'vercel.json',
          'src/pages/Privacy.tsx',
          'src/lib/seo.ts',
          'public/contact/index.html',
        ],
        vercelJson: {
          rewrites: [{ source: '/privacy', destination: '/index.html' }],
        },
        liveStatus: 200,
        liveBodySnippet:
          'Formspree</p> ... Autodun privacy policy ... processors',
      }),
    )
    expect(r.allowed).toBe(false)
  })

  it('allows create only when route is dead, no rewrite, no framework file', () => {
    const r = assertSafeToCreateFileAtLiveRoute(
      ctx({
        createPath: 'public/brand-new/index.html',
        pageUrl: 'https://example.com/brand-new',
        treePaths: ['index.html', 'public/about/index.html'],
        vercelJson: { rewrites: [] },
        liveStatus: 404,
        liveBodySnippet: 'Not Found',
      }),
    )
    expect(r.allowed).toBe(true)
  })
})
