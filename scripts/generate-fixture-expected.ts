/**
 * Generate fixtures/seoranko-fixture-site/expected.json from detectors
 * against the local fixture tree (+ synthetic 404/redirect URLs).
 *
 * Usage: npx tsx scripts/generate-fixture-expected.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  runDetectorsOnPages,
  runWholeSiteDetectorsOnCrawl,
  rollupAndClassify,
} from '../src/lib/fix-strategies/findings-ui/crawl/run-detectors'
import type { CrawledPage } from '../src/lib/fix-strategies/findings-ui/crawl/fetch-page'
import { isTransformRegistered } from '../src/lib/fix-strategies/findings-ui/fix-run/apply-registry'

const ORIGIN = 'https://seoranko-fixture.vercel.app'
const ROOT = join(process.cwd(), 'fixtures/seoranko-fixture-site')

function listTree(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'README.md' || name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${name}` : name
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listTree(full, rel))
    else out.push(rel)
  }
  return out
}

function page(
  url: string,
  status: number,
  html: string,
  headers?: Record<string, string>,
): CrawledPage {
  const h = new Headers(headers)
  return {
    requestedUrl: url,
    finalUrl: status >= 300 && status < 400 ? url : url,
    status,
    html,
    rawHtml: html,
    headers: h,
    streamComplete: true,
    clientOnly: false,
    stable: true,
    crawlerCausedBackoff: false,
    evidence: {
      stable: true,
      outcome: {
        url,
        finalUrl: url,
        status,
        headers: Object.fromEntries([...h.entries()]),
        body: html,
        errorClass: null,
        errorMessage: null,
        observedAtMs: Date.now(),
        redirectCount: 0,
      },
      attempts: [
        {
          url,
          finalUrl: url,
          status,
          headers: Object.fromEntries([...h.entries()]),
          body: html,
          errorClass: null,
          errorMessage: null,
          observedAtMs: Date.now(),
          redirectCount: 0,
        },
      ],
    } as unknown as CrawledPage['evidence'],
    errorDetail: null,
    renderMode: 'raw',
    rawHtmlHash: null,
    renderedHtmlHash: null,
    renderEvidence: null,
  }
}

async function main() {
  const tree = listTree(ROOT)
  const pages: CrawledPage[] = []

  // HTML / text documents
  for (const rel of tree) {
    if (rel === 'vercel.json' || rel === 'images/hero.jpg') continue
    const body = readFileSync(join(ROOT, rel), 'utf8')
    let url = `${ORIGIN}/`
    if (rel === 'index.html') url = `${ORIGIN}/`
    else if (rel === 'blog/index.html') url = `${ORIGIN}/blog/`
    else if (rel === 'robots.txt') url = `${ORIGIN}/robots.txt`
    else if (rel === 'sitemap.xml') url = `${ORIGIN}/sitemap.xml`
    else url = `${ORIGIN}/${rel}`
    pages.push(page(url, 200, body))
  }

  // Synthetic crawl observations for planted 404 / redirect targets
  pages.push(
    page(`${ORIGIN}/gone.html`, 404, ''),
    page(`${ORIGIN}/dead-canonical.html`, 404, ''),
  )
  // Redirect hop: /old-blog → /blog/ (308)
  const oldBlog = page(`${ORIGIN}/old-blog`, 308, '', {
    location: `${ORIGIN}/blog/`,
  })
  oldBlog.finalUrl = `${ORIGIN}/old-blog`
  pages.push(oldBlog)

  // Mock global fetch for peer probes during detectors
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input)
    if (u.includes('/gone.html') || u.includes('/dead-canonical.html')) {
      return new Response('', { status: 404 })
    }
    if (u.includes('/old-blog')) {
      return new Response('', {
        status: 308,
        headers: { location: `${ORIGIN}/blog/` },
      })
    }
    // Serve local fixture for same-origin
    try {
      const path = new URL(u).pathname
      let rel =
        path === '/'
          ? 'index.html'
          : path === '/blog/' || path === '/blog'
            ? 'blog/index.html'
            : path.replace(/^\//, '')
      if (rel.endsWith('/')) rel = rel + 'index.html'
      const full = join(ROOT, rel)
      const body = readFileSync(full)
      return new Response(body, { status: 200 })
    } catch {
      /* fall through */
    }
    return realFetch(input, init)
  }) as typeof fetch

  const perPage = await runDetectorsOnPages(ORIGIN, pages)
  const wholePages = pages.map((p) => ({
    url: p.finalUrl || p.requestedUrl,
    html: p.html,
    status: p.status,
    clientOnly: p.clientOnly,
    headers: p.headers,
  }))
  const whole = await runWholeSiteDetectorsOnCrawl(ORIGIN, wholePages)
  const { findings } = rollupAndClassify([...perPage, ...whole])

  globalThis.fetch = realFetch

  const expected = findings
    .map((f) => {
      const registered = isTransformRegistered(f.topicId, f.verdict)
      // After resolve_sources, registered auto-* become auto-fixable.
      const mustBeAutoFixable =
        registered &&
        f.autoFixable !== false &&
        /^auto[-_]/.test(f.verdict) &&
        f.bucket === 'actionable'
      return {
        topicId: f.topicId,
        verdict: f.verdict,
        pageUrl: f.pageUrl,
        // Pre-resolve surface from rollup; e2e compares post-resolve class.
        surfaceClass: mustBeAutoFixable ? 'auto-fixable' : f.surfaceClass,
        autoFixable: mustBeAutoFixable,
        bucket: f.bucket,
      }
    })
    .sort((a, b) =>
      `${a.topicId}|${a.verdict}|${a.pageUrl}`.localeCompare(
        `${b.topicId}|${b.verdict}|${b.pageUrl}`,
      ),
    )

  const out = {
    origin: ORIGIN,
    seedBranch: 'seed',
    seedCommitSha: '4e4bbf9',
    generatedAt: new Date().toISOString(),
    notes:
      'surfaceClass auto-fixable = registered transform after source resolve. Compare post-crawl+resolve findings.',
    findings: expected,
    autoFixable: expected.filter((f) => f.autoFixable),
  }

  const path = join(ROOT, 'expected.json')
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n')
  console.log('wrote', path, 'findings=', expected.length, 'auto=', out.autoFixable.length)
  for (const f of expected) {
    console.log(
      `${f.autoFixable ? 'AUTO' : '----'} t${f.topicId} ${f.verdict} ${f.pageUrl} [${f.surfaceClass}]`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
