/**
 * Report-only live crawl of autodun.com through topic-1 detect path.
 * No fixes applied.
 *
 *   npx tsx scripts/topic1-live-crawl-report.mjs
 */
import { spawn } from 'node:child_process'
import { copyFileSync, writeFileSync } from 'node:fs'
import {
  extractAnchors,
  detectBrokenInternalLinks,
  isInternalHref,
  isSkippableHref,
} from '../src/lib/fix-strategies/topic-1/index.ts'
import {
  detectRouteRoots,
  primaryAppRouterDir,
  resolvePath,
  middlewareMayRewrite,
} from '../src/lib/fix-strategies/site-model/index.ts'
import { FETCH_EVIDENCE_CONFIG } from '../src/lib/fix-strategies/fetch/index.ts'

const ORIGIN = 'https://autodun.com'
const REPO = '/tmp/autodun-ai'

const SEED_URLS = [
  `${ORIGIN}/`,
  `${ORIGIN}/blog`,
  `${ORIGIN}/blog/index.html`,
  `${ORIGIN}/blog/mot-cost-uk-2026.html`,
  `${ORIGIN}/blog/electric-car-charger-map-uk.html`,
  `${ORIGIN}/blog/ev-charging-on-uk-motorways.html`,
  `${ORIGIN}/blog/mot-history-check-uk.html`,
  `${ORIGIN}/blog/ulez-checker-uk.html`,
  `${ORIGIN}/blog/mot-advisories-explained-uk.html`,
  `${ORIGIN}/blog/mot-changes-2026-dvsa-updates.html`,
  `${ORIGIN}/blog/uk-vehicle-data-tools.html`,
  `${ORIGIN}/blog/why-uk-councils-are-flying-blind-on-ev-charging-infrastructure.html`,
  `${ORIGIN}/blog/ev-charging-reliability-uk.html`,
  `${ORIGIN}/contact`,
  `${ORIGIN}/about`,
  `${ORIGIN}/privacy`,
  `${ORIGIN}/cookies`,
  `${ORIGIN}/terms`,
  `${ORIGIN}/mot-predictor`,
]

const BROAD_A_RE = /<a\b([^>]*)>/gi
const HREF_ATTR_RE =
  /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|[\u201C\u201D]([^\u201C\u201D]*)[\u201C\u201D]|[\u2018\u2019]([^\u2018\u2019]*)[\u2018\u2019]|([^\s>]+))/i

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })
    child.on('close', (code) =>
      resolve({ stdout, stderr, code: code ?? 1 }),
    )
  })
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'SEORANKO-topic1-live-report/1.0',
      'cache-control': 'no-cache',
    },
  })
  return { finalUrl: res.url, status: res.status, html: await res.text() }
}

function broadExtract(html) {
  const out = []
  for (const m of html.matchAll(BROAD_A_RE)) {
    const attrs = m[1] ?? ''
    const hm = attrs.match(HREF_ATTR_RE)
    if (!hm) {
      out.push({ kind: 'no-href', attrs: attrs.slice(0, 120) })
      continue
    }
    const raw = hm[1] ?? hm[2] ?? hm[3] ?? hm[4] ?? hm[5] ?? ''
    const quote =
      hm[1] != null
        ? 'double'
        : hm[2] != null
          ? 'single'
          : hm[3] != null
            ? 'curly-double'
            : hm[4] != null
              ? 'curly-single'
              : 'unquoted'
    out.push({ kind: 'href', raw, quote, attrs: attrs.slice(0, 200) })
  }
  return out
}

function classifyHrefShape(raw) {
  const shapes = []
  if (/^\/(?!\/)/.test(raw)) shapes.push('root-relative')
  if (/^\.\.?\//.test(raw)) shapes.push('dot-relative')
  if (/^\/\//.test(raw)) shapes.push('protocol-relative')
  if (/^https?:\/\//i.test(raw)) shapes.push('absolute')
  if (raw.includes('?')) shapes.push('has-query')
  if (raw.includes('#')) shapes.push('has-fragment')
  return shapes
}

async function main() {
  try {
    copyFileSync(
      '/tmp/topic1-live-report.json',
      '/tmp/topic1-live-report-before.json',
    )
  } catch {
    /* first run */
  }

  const routeRoots = detectRouteRoots(REPO)
  const APP_DIR =
    routeRoots.find((r) => r.kind === 'app-router')?.absDir ??
    primaryAppRouterDir(REPO) ??
    `${REPO}/src/app`

  const shallowProbe = await runGit(
    ['rev-parse', '--is-shallow-repository'],
    REPO,
  )
  const middlewareRewrite = middlewareMayRewrite(APP_DIR)

  const pages = []
  for (const seed of SEED_URLS) {
    try {
      const page = await fetchHtml(seed)
      pages.push({ seed, ...page })
      process.stderr.write(
        `fetched ${page.status} ${seed} -> ${page.finalUrl}\n`,
      )
    } catch (err) {
      process.stderr.write(`FETCH FAIL ${seed}: ${err}\n`)
      pages.push({ seed, finalUrl: seed, status: 0, html: '' })
    }
  }

  const sourcePages = pages.filter((p) => p.html.length > 0)

  const shapes = {
    'root-relative': 0,
    'dot-relative': 0,
    'protocol-relative': 0,
    absolute: 0,
    'has-query': 0,
    'has-fragment': 0,
    'single-quoted': 0,
    'double-quoted': 0,
    'curly-double': 0,
    'curly-single': 0,
    unquoted: 0,
    'uppercase-HREF-attr': 0,
  }
  let productExtractedTotal = 0
  const productUniqueHref = new Set()
  let broadHrefTags = 0
  let noHrefAnchors = 0
  const missedByProduct = []
  const mangled = []
  const extractorPerPage = []

  for (const page of sourcePages) {
    const product = extractAnchors(page.html)
    productExtractedTotal += product.length
    for (const a of product) productUniqueHref.add(a.href)

    const broad = broadExtract(page.html)
    let pageMisses = 0
    for (const b of broad) {
      if (b.kind === 'no-href') {
        noHrefAnchors++
        continue
      }
      broadHrefTags++
      if (b.quote === 'single') shapes['single-quoted']++
      if (b.quote === 'double') shapes['double-quoted']++
      if (b.quote === 'curly-double') shapes['curly-double']++
      if (b.quote === 'curly-single') shapes['curly-single']++
      if (b.quote === 'unquoted') shapes.unquoted++
      if (/\bHREF\s*=/.test(b.attrs) || /\bHref\s*=/.test(b.attrs)) {
        shapes['uppercase-HREF-attr']++
      }
      for (const s of classifyHrefShape(b.raw)) {
        shapes[s] = (shapes[s] ?? 0) + 1
      }

      const found = product.some(
        (p) => p.raw === b.raw || p.href === b.raw.trim(),
      )
      if (!found) {
        pageMisses++
        missedByProduct.push({
          page: page.finalUrl,
          raw: b.raw,
          quote: b.quote,
          reason:
            b.quote === 'unquoted'
              ? 'unquoted-href-not-supported'
              : b.quote.startsWith('curly')
                ? 'curly-quoted-href-miss'
                : 'unknown-miss',
        })
      }

      const prod = product.find((p) => p.raw === b.raw)
      if (prod && prod.href !== b.raw.trim()) {
        mangled.push({ page: page.finalUrl, raw: b.raw, href: prod.href })
      }
    }

    extractorPerPage.push({
      page: page.finalUrl,
      status: page.status,
      productCount: product.length,
      broadHrefCount: broad.filter((x) => x.kind === 'href').length,
      misses: pageMisses,
      sampleHrefs: product.map((a) => a.href).slice(0, 25),
    })
  }

  const siteByKind = {}
  const siteIndeterminate = []
  const siteSamples = []
  const internalPaths = new Set()

  for (const page of sourcePages) {
    for (const a of extractAnchors(page.html)) {
      if (isSkippableHref(a.href)) continue
      if (!isInternalHref(a.href, page.finalUrl)) continue
      try {
        internalPaths.add(new URL(a.href, page.finalUrl).pathname)
      } catch {
        /* ignore */
      }
    }
  }

  for (const path of [...internalPaths].sort()) {
    const resolved = resolvePath(APP_DIR, path)
    siteByKind[resolved.kind] = (siteByKind[resolved.kind] || 0) + 1
    siteSamples.push({
      path,
      kind: resolved.kind,
      routeFile: resolved.routeFile,
    })
    if (resolved.kind === 'indeterminate') {
      siteIndeterminate.push({
        path,
        why: middlewareRewrite
          ? 'middlewareMayRewrite=true'
          : 'indeterminate (unexpected without rewrite middleware)',
      })
    }
  }

  const livePages = sourcePages
    .filter((p) => p.status === 200)
    .map((p) => ({
      url: p.finalUrl,
      path: new URL(p.finalUrl).pathname,
      html: p.html,
    }))

  const deps = {
    fetch: globalThis.fetch.bind(globalThis),
    sleep,
    now: () => Date.now(),
    config: { ...FETCH_EVIDENCE_CONFIG },
  }

  const allFindings = []
  const allSuppressed = []
  const statusBuckets = {}
  const gitStatusCounts = {
    deleted: 0,
    'no-deletion-found': 0,
    'history-unavailable': 0,
  }
  const perPage = []

  const detectSources = sourcePages.filter(
    (p) => p.status >= 200 && p.status < 400,
  )

  for (const page of detectSources) {
    process.stderr.write(`detect ${page.finalUrl}\n`)
    const result = await detectBrokenInternalLinks(page.html, page.finalUrl, {
      deps,
      repoRoot: REPO,
      runGit,
      routeRoots,
      livePages,
    })

    for (const f of result.findings) {
      allFindings.push({ ...f, sourcePage: page.finalUrl })
      if (String(f.kind).includes('410')) {
        statusBuckets['410'] = (statusBuckets['410'] || 0) + 1
      } else if (String(f.kind).includes('404')) {
        statusBuckets['404'] = (statusBuckets['404'] || 0) + 1
        if (f.git?.status) {
          gitStatusCounts[f.git.status] =
            (gitStatusCounts[f.git.status] || 0) + 1
        }
      }
    }
    for (const s of result.suppressed) {
      allSuppressed.push({ ...s, sourcePage: page.finalUrl })
      statusBuckets[s.reason] = (statusBuckets[s.reason] || 0) + 1
    }

    perPage.push({
      source: page.finalUrl,
      seed: page.seed,
      httpStatus: page.status,
      findings: result.findings.length,
      suppressed: result.suppressed.length,
      findingSummaries: result.findings.map((f) => ({
        href: f.href,
        kind: f.kind,
        action: f.action,
        verdict: f.verdict,
        routeKind: f.routeKind ?? null,
        git: f.git?.status ?? null,
        reason: f.reason ?? null,
        successorCount: f.successors?.length ?? 0,
      })),
      suppressByReason: result.suppressed.reduce((acc, s) => {
        acc[s.reason] = (acc[s.reason] || 0) + 1
        return acc
      }, {}),
    })
  }

  const suppressByGuard = allSuppressed.reduce((acc, s) => {
    acc[s.reason] = (acc[s.reason] || 0) + 1
    return acc
  }, {})

  const falsePositiveCandidates = []
  for (const f of allFindings) {
    if (!String(f.kind).includes('404')) continue
    let path = String(f.href)
    try {
      path = new URL(String(f.targetUrl)).pathname
    } catch {
      /* keep */
    }
    const norm = path.replace(/\/$/, '') || '/'
    if (f.action === 'recreate-scaffold' && f.routeKind === 'no-route') {
      falsePositiveCandidates.push({
        href: f.href,
        targetUrl: f.targetUrl,
        action: f.action,
        git: f.git?.status,
        routeKind: f.routeKind,
        reason:
          'BUG: recreate-scaffold with no-route violates guard 9 — should be no-action',
      })
    }
    const spa = ['/privacy', '/cookies', '/terms', '/data-usage', '/about']
    if (spa.includes(norm) && f.action === 'recreate-scaffold') {
      falsePositiveCandidates.push({
        href: f.href,
        targetUrl: f.targetUrl,
        action: f.action,
        git: f.git?.status,
        reason:
          'SPA/client route under src/pages — recreate-scaffold without static/dynamic site-model evidence is wrong',
      })
    }
  }

  const report = {
    meta: {
      site: ORIGIN,
      connectedRepo: 'kamrangul87/autodun-ai (homepage=https://autodun.com)',
      repoPath: REPO,
      appDir: APP_DIR,
      routeRoots: routeRoots.map((r) => ({
        relDir: r.relDir,
        kind: r.kind,
      })),
      shallow: shallowProbe.stdout.trim(),
      crawledAt: new Date().toISOString(),
      seedCount: SEED_URLS.length,
      pagesFetched: pages.length,
      detectSourceCount: detectSources.length,
      note: 'Report-only. Path: extractAnchors → fetchWithEvidence → findDeletedRouteEvidence(site-model roots) → decide404Branch. No fixes applied.',
      caveats: [
        'Homepage SSR HTML is a Vite shell with ~0 crawlable anchors; blog/static HTML carries the real link graph.',
        'Git deletion probe uses site-model detectRouteRoots (src/app + secondary dirs such as src/pages), not a hard-coded app/ list.',
        'no-route + no-deletion-found → no-action (guard 9); recreate-scaffold only with positive static/dynamic route evidence.',
      ],
    },
    pageFetchStatuses: pages.map((p) => ({
      seed: p.seed,
      status: p.status,
      finalUrl: p.finalUrl,
    })),
    extractor: {
      productExtractedTotal,
      productUniqueHrefCount: productUniqueHref.size,
      broadHrefTags,
      noHrefAnchors,
      missedCount: missedByProduct.length,
      missedByProduct: missedByProduct.slice(0, 40),
      mangled,
      shapes,
      perPage: extractorPerPage,
    },
    statusBuckets,
    siteModel: {
      middlewareMayRewrite: middlewareRewrite,
      routeRoots: routeRoots.map((r) => ({
        relDir: r.relDir,
        kind: r.kind,
      })),
      pathCount: internalPaths.size,
      byKind: siteByKind,
      indeterminateCount: siteIndeterminate.length,
      indeterminate: siteIndeterminate,
      samples: siteSamples,
    },
    findings: {
      total: allFindings.length,
      byAction: allFindings.reduce((acc, f) => {
        const k = f.action || f.kind
        acc[k] = (acc[k] || 0) + 1
        return acc
      }, {}),
      items: allFindings,
    },
    suppressed: {
      total: allSuppressed.length,
      byGuard: suppressByGuard,
    },
    gitEvidence: gitStatusCounts,
    falsePositiveCandidates,
    perPage,
  }

  writeFileSync('/tmp/topic1-live-report.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
