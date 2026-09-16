import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FetchDeps } from '@/lib/fix-strategies/fetch'
import {
  detectSitemapNotIndexable,
  planSitemapFixes,
  verifyLiveSitemapIndexable,
} from './index'

const ORIGIN = 'https://example.com'

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
    : `<link rel="canonical" href="${ORIGIN}/healthy">`
  return `<!doctype html><html><head><title>${opts.title ?? 'Page'}</title>${robots}${canonical}</head><body>${opts.body ?? '<p>Hello</p>'}</body></html>`
}

function sitemapListing(locs: string[]): string {
  const urls = locs
    .map((loc) => `  <url>\n    <loc>${loc}</loc>\n  </url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

describe('topic 26 — sitemap not indexable', () => {
  it('classifies the dossier fixture set and applies only auto-fixable rows', async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topic26-app-'))
    const noindexDir = path.join(appDir, 'noindex-page')
    fs.mkdirSync(noindexDir, { recursive: true })
    fs.writeFileSync(
      path.join(noindexDir, 'page.tsx'),
      `export const metadata = { robots: { index: false } }\nexport default function Page(){return null}\n`,
    )
    fs.writeFileSync(
      path.join(appDir, 'page.tsx'),
      `export default function Home(){return null}\n`,
    )
    // Injected-noindex route exists but does NOT declare noindex in repo
    const injectedDir = path.join(appDir, 'injected-gone')
    fs.mkdirSync(injectedDir, { recursive: true })
    fs.writeFileSync(
      path.join(injectedDir, 'page.tsx'),
      `export default function Page(){return null}\n`,
    )
    const elsewhereDir = path.join(appDir, 'elsewhere')
    fs.mkdirSync(elsewhereDir, { recursive: true })
    fs.writeFileSync(
      path.join(elsewhereDir, 'page.tsx'),
      `export default function Page(){return null}\n`,
    )
    const healthyDir = path.join(appDir, 'healthy')
    fs.mkdirSync(healthyDir, { recursive: true })
    fs.writeFileSync(
      path.join(healthyDir, 'page.tsx'),
      `export default function Page(){return null}\n`,
    )

    const locs = {
      missing: `${ORIGIN}/missing`,
      flaky: `${ORIGIN}/flaky-5xx`,
      old: `${ORIGIN}/old`,
      final: `${ORIGIN}/final`,
      noindex: `${ORIGIN}/noindex-page`,
      injected: `${ORIGIN}/injected-gone`,
      elsewhere: `${ORIGIN}/elsewhere`,
      healthy: `${ORIGIN}/healthy`,
      pdf: `${ORIGIN}/guide.pdf`,
    }

    const xml = sitemapListing([
      locs.missing,
      locs.flaky,
      locs.old,
      locs.noindex,
      locs.injected,
      locs.elsewhere,
      locs.healthy,
      locs.pdf,
    ])

    const callCount = new Map<string, number>()
    const bump = (url: string) => {
      const n = (callCount.get(url) ?? 0) + 1
      callCount.set(url, n)
      return n
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const n = bump(url)

      if (url === locs.missing) {
        return new Response('gone', { status: 404 })
      }
      if (url === locs.flaky) {
        // hop + evidence first attempt 503; evidence second 200 → transient
        if (n <= 2) return new Response('busy', { status: 503 })
        return new Response(
          htmlPage({ title: 'Recovered', canonical: locs.flaky }),
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === locs.old) {
        return new Response(null, {
          status: 301,
          headers: { location: locs.final },
        })
      }
      if (url === locs.final) {
        return new Response(
          htmlPage({ title: 'Final', canonical: locs.final }),
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === locs.noindex) {
        return new Response(
          htmlPage({
            title: 'Noindex',
            robots: 'noindex',
            canonical: locs.noindex,
          }),
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === locs.injected) {
        return new Response(
          htmlPage({
            title: 'Injected',
            robots: 'noindex',
            canonical: locs.injected,
          }),
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === locs.elsewhere) {
        return new Response(
          htmlPage({
            title: 'Elsewhere',
            canonical: locs.healthy,
          }),
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === locs.healthy) {
        return new Response(
          htmlPage({ title: 'Healthy', canonical: locs.healthy }),
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === locs.pdf) {
        return new Response('%PDF-1.4', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      }
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

    const detected = await detectSitemapNotIndexable(
      xml,
      {
        artefactPath: 'public/sitemap.xml',
        isGenerated: false,
        generatorPath: null,
        appDir,
        siteOrigin: ORIGIN,
      },
      deps,
    )

    const byLoc = Object.fromEntries(
      detected.findings.map((f) => [f.loc, f.verdict]),
    )

    expect(byLoc[locs.missing]).toBe('auto-remove-confirmed-4xx')
    expect(byLoc[locs.flaky]).toBe('route-topic-3-transient-5xx')
    expect(byLoc[locs.old]).toBe('auto-replace-single-hop-redirect')
    expect(
      detected.findings.find((f) => f.loc === locs.old)?.replaceWith,
    ).toBe(locs.final)
    expect(byLoc[locs.noindex]).toBe('auto-remove-repo-noindex')
    expect(byLoc[locs.injected]).toBe('auto-remove-injected-noindex')
    expect(byLoc[locs.elsewhere]).toBe('human-review-canonical-elsewhere')
    expect(detected.ok).toEqual(expect.arrayContaining([locs.healthy, locs.pdf]))
    expect(detected.ok).toHaveLength(2)

    const plan = planSitemapFixes(xml, detected.findings, {
      artefactPath: 'public/sitemap.xml',
      isGenerated: false,
      generatorPath: null,
    })

    expect(plan.action).toBe('fix-artefact')
    expect(plan.nextSitemapXml).toBeTruthy()
    const next = plan.nextSitemapXml!
    expect(next).not.toContain(locs.missing)
    expect(next).not.toContain(locs.noindex)
    expect(next).not.toContain(locs.injected)
    expect(next).not.toContain(`<loc>${locs.old}</loc>`)
    expect(next).toContain(`<loc>${locs.final}</loc>`)
    // Deferred rows remain until human-review / topic 3
    expect(next).toContain(locs.flaky)
    expect(next).toContain(locs.elsewhere)
    expect(next).toContain(locs.healthy)
    expect(next).toContain(locs.pdf)

    // Verifier does not import the fixer — check source separation
    const verifySrc = fs.readFileSync(
      path.join(__dirname, 'verify-live-sitemap.ts'),
      'utf8',
    )
    expect(verifySrc).not.toMatch(/fix-sitemap-entry/)
    expect(verifySrc).not.toMatch(/planSitemapFixes/)

    // Live postcondition against the fixed sitemap served as the live document
    const liveXml = next
    const liveFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `${ORIGIN}/sitemap.xml`) {
        return new Response(liveXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        })
      }
      // Remaining locs after auto-fix — still include deferred flaky/elsewhere
      if (url === locs.final || url === locs.healthy) {
        return new Response(
          htmlPage({ title: 'Ok', canonical: url }),
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === locs.pdf) {
        return new Response('%PDF', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      }
      if (url === locs.flaky) {
        return new Response('busy', { status: 503 })
      }
      if (url === locs.elsewhere) {
        return new Response(
          htmlPage({ title: 'Else', canonical: locs.healthy }),
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      throw new Error(`live unexpected ${url}`)
    })

    const liveResult = await verifyLiveSitemapIndexable(`${ORIGIN}/sitemap.xml`, {
      fetch: liveFetch as unknown as typeof fetch,
      sleep: async () => {},
      now: () => 0,
    })
    // Postcondition fails while deferred bad locs remain — expected until review
    expect(liveResult.ok).toBe(false)
    expect(liveResult.failures.some((f) => f.loc === locs.flaky)).toBe(true)
    expect(liveResult.failures.some((f) => f.loc === locs.elsewhere)).toBe(true)

    // After only healthy locs remain, live verify passes
    const cleanXml = sitemapListing([locs.healthy, locs.pdf, locs.final])
    const cleanFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `${ORIGIN}/sitemap.xml`) {
        return new Response(cleanXml, { status: 200 })
      }
      if (url === locs.pdf) {
        return new Response('%PDF', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      }
      return new Response(htmlPage({ title: 'Ok', canonical: url }), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })
    const clean = await verifyLiveSitemapIndexable(`${ORIGIN}/sitemap.xml`, {
      fetch: cleanFetch as unknown as typeof fetch,
      sleep: async () => {},
      now: () => 0,
    })
    expect(clean.ok).toBe(true)

    fs.rmSync(appDir, { recursive: true, force: true })
  })

  it('targets the generator, never emitted XML, when the sitemap is generated', async () => {
    const xml = sitemapListing([`${ORIGIN}/missing`])
    const deps: FetchDeps = {
      fetch: vi.fn(async () => new Response('x', { status: 404 })) as unknown as typeof fetch,
      sleep: async () => {},
      now: () => 0,
      config: { fallbackDelayMs: 1, maxAttempts: 2, maxRetryAfterMs: 10, timeoutMs: 50 },
    }
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topic26-gen-'))
    fs.writeFileSync(path.join(appDir, 'page.tsx'), 'export default function P(){return null}')

    const detected = await detectSitemapNotIndexable(
      xml,
      {
        artefactPath: 'public/sitemap.xml',
        isGenerated: true,
        generatorPath: 'app/sitemap.ts',
        appDir,
        siteOrigin: ORIGIN,
      },
      deps,
    )
    expect(detected.fixTarget.action).toBe('fix-generator')
    expect(detected.fixTarget.targetPath).toBe('app/sitemap.ts')

    const plan = planSitemapFixes(xml, detected.findings, {
      artefactPath: 'public/sitemap.xml',
      isGenerated: true,
      generatorPath: 'app/sitemap.ts',
    })
    expect(plan.action).toBe('fix-generator')
    expect(plan.targetPath).toBe('app/sitemap.ts')
    expect(plan.nextSitemapXml).toBeNull()
    expect(plan.applied[0]?.note).toMatch(/Generator must omit/)

    fs.rmSync(appDir, { recursive: true, force: true })
  })

  it('human-review when generated sitemap has no known generator', () => {
    const plan = planSitemapFixes(sitemapListing([`${ORIGIN}/x`]), [], {
      artefactPath: 'public/sitemap.xml',
      isGenerated: true,
      generatorPath: null,
    })
    expect(plan.action).toBe('human-review')
    expect(plan.nextSitemapXml).toBeNull()
  })
})
