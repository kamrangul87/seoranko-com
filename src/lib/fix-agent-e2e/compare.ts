/**
 * Exact comparison of crawl findings vs fixtures/seoranko-fixture-site/expected.json
 *
 * Actionable findings: topic + verdict + pageUrl (exact).
 * Informational group findings: topic + verdict + sorted member set
 * (representative pageUrl must not affect identity).
 */

import expectedJson from '../../../fixtures/seoranko-fixture-site/expected.json'
import { sortMemberUrls } from '@/lib/fix-strategies/shared'

export type ExpectedFinding = {
  topicId: string
  verdict: string
  pageUrl: string | null
  surfaceClass: string
  autoFixable: boolean
  bucket?: string
  memberUrls?: string[]
}

export type ObservedFinding = {
  topicId: string
  verdict: string
  pageUrl: string | null
  surfaceClass: string
  autoFixable: boolean
  postFixStatus?: string | null
  bucket?: string
  memberUrls?: string[]
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

function isInformational(f: { surfaceClass: string; bucket?: string }): boolean {
  return f.bucket === 'informational' || f.surfaceClass === 'informational'
}

function isInformationalGroup(f: {
  surfaceClass: string
  bucket?: string
  memberUrls?: string[]
}): boolean {
  if (!isInformational(f)) return false
  const members = sortMemberUrls((f.memberUrls ?? []).map(normalizeUrl).filter(Boolean))
  return members.length > 1
}

function key(f: {
  topicId: string
  verdict: string
  pageUrl: string | null
  surfaceClass: string
  bucket?: string
  memberUrls?: string[]
}): string {
  if (isInformationalGroup(f)) {
    const members = sortMemberUrls(
      (f.memberUrls ?? []).map(normalizeUrl).filter(Boolean),
    )
    return `${f.topicId}\0${f.verdict}\0members:${members.join('\0')}`
  }
  return `${f.topicId}\0${f.verdict}\0${normalizeUrl(f.pageUrl)}`
}

function describeFinding(f: {
  topicId: string
  verdict: string
  pageUrl: string | null
  memberUrls?: string[]
}): string {
  if (f.memberUrls && f.memberUrls.length > 1) {
    return `${f.topicId}/${f.verdict} @ members[${f.memberUrls.length}]`
  }
  return `${f.topicId}/${f.verdict} @ ${f.pageUrl}`
}

export function loadExpectedFindings(): ExpectedFinding[] {
  return (expectedJson.findings as ExpectedFinding[]).map((f) => ({
    ...f,
    pageUrl: f.pageUrl,
    memberUrls: f.memberUrls,
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
      missing.push(describeFinding(e))
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
      extra.push(describeFinding(o))
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
