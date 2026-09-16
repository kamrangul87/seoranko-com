import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FetchDeps } from '@/lib/fix-strategies/fetch'
import {
  detectLinksThroughRedirects,
  rewriteAnchorHref,
  verifyLiveHrefRewritten,
  type HrefDeclaration,
} from '@/lib/fix-strategies/topic-42'

const ORIGIN = 'https://example.com'

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function htmlPage(opts: {
  title?: string
  robots?: string
  canonical?: string
  body?: string
}): string {
  const robots = opts.robots
    ? `<meta name="robots" content="${opts.robots}">`
    : ''
  const canonical = opts.canonical
    ? `<link rel="canonical" href="${opts.canonical}">`
    : ''
  return `<!doctype html><html><head><title>${opts.title ?? 'Page'}</title>${robots}${canonical}</head><body>${opts.body ?? '<p>ok</p>'}</body></html>`
}

function redirect(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } })
}

function ok(urlPath: string, extra?: { robots?: string }): Response {
  const canonical = `${ORIGIN}${urlPath}`
  return new Response(
    htmlPage({
      title: urlPath,
      canonical,
      robots: extra?.robots,
      body: `<p>${urlPath}</p>`,
    }),
    { status: 200, headers: { 'content-type': 'text/html' } },
  )
}

describe('topic 42 — links pointing at redirects', () => {
  it('classifies the dossier fixture set', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'topic42-'))
    temps.push(repoRoot)

    // Shared nav component declaring /nav-old (appears on 20 pages)
    const componentsDir = path.join(repoRoot, 'components')
    fs.mkdirSync(componentsDir, { recursive: true })
    fs.writeFileSync(
      path.join(componentsDir, 'MainNav.tsx'),
      `export function MainNav(){return <a href="/nav-old">Nav</a>}\n`,
    )
    const appDir = path.join(repoRoot, 'app')
    fs.mkdirSync(appDir, { recursive: true })
    fs.writeFileSync(
      path.join(appDir, 'layout.tsx'),
      `import { MainNav } from '../components/MainNav'\nexport default function L({children}){return <><MainNav/>{children}</>}\n`,
    )

    const locs = {
      single: '/old-single',
      final1: '/final-single',
      hop3a: '/hop3-a',
      hop3b: '/hop3-b',
      hop3c: '/hop3-c',
      hop3final: '/hop3-final',
      hop5: ['/h5-1', '/h5-2', '/h5-3', '/h5-4', '/h5-5'] as const,
      hop5final: '/h5-final',
      temp: '/temp-302',
      tempFinal: '/temp-final',
      locale: '/products',
      localeFinal: '/en/products',
      withQuery: '/old-campaign',
      withQueryFinal: '/new-campaign',
      navOld: '/nav-old',
      navFinal: '/nav-final',
      dead: '/dead-redirect',
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const u = new URL(url)
      const p = u.pathname

      if (p === locs.single) return redirect(301, locs.final1)
      if (p === locs.final1) return ok(locs.final1)

      if (p === locs.hop3a) return redirect(301, locs.hop3b)
      if (p === locs.hop3b) return redirect(301, locs.hop3c)
      if (p === locs.hop3c) return redirect(301, locs.hop3final)
      if (p === locs.hop3final) return ok(locs.hop3final)

      if (p === locs.hop5[0]) return redirect(301, locs.hop5[1])
      if (p === locs.hop5[1]) return redirect(301, locs.hop5[2])
      if (p === locs.hop5[2]) return redirect(301, locs.hop5[3])
      if (p === locs.hop5[3]) return redirect(301, locs.hop5[4])
      if (p === locs.hop5[4]) return redirect(301, locs.hop5final)
      if (p === locs.hop5final) return ok(locs.hop5final)

      if (p === locs.temp) return redirect(302, locs.tempFinal)
      if (p === locs.tempFinal) return ok(locs.tempFinal)

      if (p === locs.locale) return redirect(301, locs.localeFinal)
      if (p === locs.localeFinal) return ok(locs.localeFinal)

      if (p === locs.withQuery) return redirect(301, locs.withQueryFinal)
      if (p === locs.withQueryFinal) return ok(locs.withQueryFinal)

      if (p === locs.navOld) return redirect(301, locs.navFinal)
      if (p === locs.navFinal) return ok(locs.navFinal)

      if (p === locs.dead) return redirect(301, '/missing-now')
      if (p === '/missing-now') return new Response('gone', { status: 404 })

      throw new Error(`unexpected fetch ${url}`)
    })

    const deps: FetchDeps = {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: vi.fn(async () => {}),
      now: () => 1_000_000,
      config: {
        fallbackDelayMs: 1,
        maxAttempts: 2,
        maxRetryAfterMs: 10,
        timeoutMs: 100,
      },
    }

    const bodyPage = (links: string) =>
      `<!doctype html><html><body>${links}</body></html>`

    // 20 pages each including the shared nav link
    const navPages = Array.from({ length: 20 }, (_, i) => ({
      url: `${ORIGIN}/p/${i}`,
      html: bodyPage(`<a href="${locs.navOld}">Nav</a>`),
      artefactPath: `app/p/${i}/page.tsx`,
    }))

    const mainPage = {
      url: `${ORIGIN}/home`,
      html: bodyPage(`
        <a href="${locs.single}">single</a>
        <a href="${locs.hop3a}">three</a>
        <a href="${locs.hop5[0]}">five</a>
        <a href="${locs.temp}">temp</a>
        <a href="${locs.locale}">locale</a>
        <a href="${locs.withQuery}?utm_source=x#section">campaign</a>
        <a href="${locs.dead}">dead</a>
      `),
      artefactPath: 'app/home/page.tsx',
    }

    const declarationByHref: Record<string, HrefDeclaration> = {
      [locs.navOld]: {
        kind: 'shared-nav',
        file: 'components/MainNav.tsx',
        detail: 'declared in shared navigation/layout: components/MainNav.tsx',
      },
    }

    const detected = await detectLinksThroughRedirects(
      [mainPage, ...navPages],
      { deps, repoRoot, declarationByHref },
    )

    const byHref = Object.fromEntries(
      detected.findings.map((f) => {
        // Strip query/hash for lookup key where needed
        const key = f.href.split('?')[0]!.split('#')[0]!
        return [key, f]
      }),
    )

    // 1. Single 301 → auto-rewrite, low
    expect(byHref[locs.single]?.verdict).toBe('auto-rewrite')
    expect(byHref[locs.single]?.severity).toBe('low')
    expect(byHref[locs.single]?.hopCount).toBe(1)
    expect(byHref[locs.single]?.rewriteHref).toBe(locs.final1)
    expect(byHref[locs.single]?.fixTarget.action).toBe('fix-artefact')

    // 2. 3-hop → moderate (still auto if all five hold)
    expect(byHref[locs.hop3a]?.severity).toBe('moderate')
    expect(byHref[locs.hop3a]?.hopCount).toBe(3)
    expect(byHref[locs.hop3a]?.verdict).toBe('auto-rewrite')

    // 3. 5-hop → high
    expect(byHref[locs.hop5[0]]?.severity).toBe('high')
    expect(byHref[locs.hop5[0]]?.hopCount).toBe(5)
    expect(byHref[locs.hop5[0]]?.verdict).toBe('auto-rewrite')

    // 4. 302 → human-review
    expect(byHref[locs.temp]?.verdict).toBe('human-review-temporary-redirect')

    // 5. Locale → human-review conditional
    expect(byHref[locs.locale]?.verdict).toBe(
      'human-review-conditional-redirect',
    )

    // 6. Query + fragment preserved
    const campaign = detected.findings.find((f) =>
      f.href.includes('utm_source=x'),
    )
    expect(campaign).toBeTruthy()
    expect(campaign!.verdict).toBe('auto-rewrite')
    expect(campaign!.rewriteHref).toBe(
      `${locs.withQueryFinal}?utm_source=x#section`,
    )
    expect(campaign!.conditions.queryFragmentPreserved).toBe(true)

    // Apply rewrite and verify condition 5 explicitly
    const rewritten = rewriteAnchorHref(
      mainPage.html,
      `${locs.withQuery}?utm_source=x#section`,
      campaign!.rewriteHref!,
    )
    expect(rewritten.rewritten).toBe(1)
    expect(rewritten.html).toContain(
      `href="${locs.withQueryFinal}?utm_source=x#section"`,
    )
    expect(rewritten.html).not.toContain(`href="${locs.withQuery}?utm_source=x#section"`)

    // 7. Nav link on 20 pages → ONE finding naming the component
    const navFindings = detected.findings.filter(
      (f) => f.href === locs.navOld || f.declaration.kind === 'shared-nav',
    )
    expect(navFindings).toHaveLength(1)
    expect(navFindings[0]?.verdict).toBe('human-review-shared-nav')
    expect(navFindings[0]?.declaration.file).toBe('components/MainNav.tsx')
    expect(navFindings[0]?.observedOn).toHaveLength(20)

    // 8. Redirect to 404 → topic 1
    expect(byHref[locs.dead]?.verdict).toBe('route-topic-1-non-200')

    // Live postcondition for the single-hop auto-fix
    const singleFinding = byHref[locs.single]!
    const fixedHtml = rewriteAnchorHref(
      mainPage.html,
      locs.single,
      singleFinding.rewriteHref!,
    ).html
    const live = await verifyLiveHrefRewritten(
      fixedHtml,
      mainPage.url,
      singleFinding.rewriteHref!,
      locs.single,
      { fetch: deps.fetch },
    )
    expect(live.ok).toBe(true)

    // Verifier must not import the fixer
    const verifySrc = fs.readFileSync(
      path.join(
        __dirname,
        '../../topic-42/verify-live-href.ts',
      ),
      'utf8',
    )
    expect(verifySrc).not.toMatch(/fix-rewrite-href/)
    expect(verifySrc).not.toMatch(/rewriteAnchorHref/)
  })

  it('resolves shared-nav declaration from the repo via topic 70 paths', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'topic42-decl-'))
    temps.push(repoRoot)
    const componentsDir = path.join(repoRoot, 'components')
    fs.mkdirSync(componentsDir, { recursive: true })
    fs.writeFileSync(
      path.join(componentsDir, 'SiteHeader.tsx'),
      `export function SiteHeader(){return <a href="/hdr-old">H</a>}\n`,
    )

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const p = new URL(String(input)).pathname
      if (p === '/hdr-old') return redirect(301, '/hdr-new')
      if (p === '/hdr-new') return ok('/hdr-new')
      throw new Error(`unexpected ${String(input)}`)
    })

    const deps: FetchDeps = {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async () => {},
      now: () => 0,
      config: { fallbackDelayMs: 1, maxAttempts: 2, maxRetryAfterMs: 10, timeoutMs: 50 },
    }

    const pages = Array.from({ length: 5 }, (_, i) => ({
      url: `${ORIGIN}/x/${i}`,
      html: `<a href="/hdr-old">H</a>`,
    }))

    const detected = await detectLinksThroughRedirects(pages, {
      deps,
      repoRoot,
    })

    expect(detected.findings).toHaveLength(1)
    expect(detected.findings[0]?.declaration.kind).toBe('shared-nav')
    expect(detected.findings[0]?.declaration.file).toMatch(/SiteHeader/)
    expect(detected.findings[0]?.verdict).toBe('human-review-shared-nav')
    expect(detected.findings[0]?.observedOn).toHaveLength(5)
  })
})
