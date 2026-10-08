/**
 * Exact comparison of crawl findings vs fixtures/seoranko-fixture-site/expected.json
 */

import expectedJson from '../../../fixtures/seoranko-fixture-site/expected.json'

export type ExpectedFinding = {
  topicId: string
  verdict: string
  pageUrl: string | null
  surfaceClass: string
  autoFixable: boolean
  bucket?: string
}

export type ObservedFinding = {
  topicId: string
  verdict: string
  pageUrl: string | null
  surfaceClass: string
  autoFixable: boolean
  postFixStatus?: string | null
}

function key(f: { topicId: string; verdict: string; pageUrl: string | null }) {
  return `${f.topicId}\0${f.verdict}\0${normalizeUrl(f.pageUrl)}`
}

function normalizeUrl(u: string | null | undefined): string {
  if (!u) return ''
  try {
    const parsed = new URL(u)
    let path = parsed.pathname
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    // Keep trailing slash for blog/ home variants that are meaningful
    if (parsed.pathname === '/blog/' || parsed.pathname === '/') {
      path = parsed.pathname
    }
    return `${parsed.origin}${parsed.pathname === '/' ? '/' : path === '/blog' ? '/blog/' : parsed.pathname}`
  } catch {
    return u.replace(/\/$/, '')
  }
}

export function loadExpectedFindings(): ExpectedFinding[] {
  return (expectedJson.findings as ExpectedFinding[]).map((f) => ({
    ...f,
    pageUrl: f.pageUrl,
  }))
}

export function loadExpectedAutoFixable(): ExpectedFinding[] {
  return loadExpectedFindings().filter((f) => f.autoFixable)
}

export function compareFindingsExact(
  observed: ObservedFinding[],
  expected: ExpectedFinding[] = loadExpectedFindings(),
): { ok: true } | { ok: false; reason: string } {
  const expMap = new Map(expected.map((f) => [key(f), f]))
  const obsMap = new Map(observed.map((f) => [key(f), f]))

  const missing: string[] = []
  const extra: string[] = []
  const mismatch: string[] = []

  for (const [k, e] of expMap) {
    const o = obsMap.get(k)
    if (!o) {
      missing.push(`${e.topicId}/${e.verdict} @ ${e.pageUrl}`)
      continue
    }
    if (o.surfaceClass !== e.surfaceClass || Boolean(o.autoFixable) !== e.autoFixable) {
      mismatch.push(
        `${e.topicId}/${e.verdict}: expected surface=${e.surfaceClass} auto=${e.autoFixable}, got surface=${o.surfaceClass} auto=${o.autoFixable}`,
      )
    }
  }
  for (const [k, o] of obsMap) {
    if (!expMap.has(k)) {
      extra.push(`${o.topicId}/${o.verdict} @ ${o.pageUrl}`)
    }
  }

  if (missing.length || extra.length || mismatch.length) {
    return {
      ok: false,
      reason: [
        missing.length ? `missing: ${missing.slice(0, 8).join('; ')}` : '',
        extra.length ? `extra: ${extra.slice(0, 8).join('; ')}` : '',
        mismatch.length ? `mismatch: ${mismatch.slice(0, 8).join('; ')}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    }
  }
  return { ok: true }
}

export function expectedReadmeDiff(): unknown {
  return (expectedJson as { readmeDiff?: unknown }).readmeDiff ?? []
}
