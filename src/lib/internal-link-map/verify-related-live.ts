/**
 * Post-merge / next-crawl checks for Related reading links.
 * Re-fetches the source page (or uses stored crawl HTML) and probes targets.
 */

import { isBareUrlAnchor, isGenericAnchor } from '@/lib/link-graph/generic-anchors'
import {
  anchorsMatchingHref,
  isContentRegion,
  normalizeHrefKey,
} from './link-placement'

export type RelatedVerifyTarget = {
  href: string
  anchorText?: string
}

export type RelatedLinkVerify = {
  href: string
  ok: boolean
  inContent: boolean
  emptyAnchor: boolean
  genericAnchor: boolean
  duplicate: boolean
  nofollow: boolean
  missing: boolean
  targetStatus: number | null
  targetRedirected: boolean
  problems: string[]
}

export type RelatedVerifyResult = {
  ok: boolean
  verifiedAt: string
  links: RelatedLinkVerify[]
  detail: string
}

function uniqueProblems(items: string[]): string[] {
  return [...new Set(items)]
}

function resolveTargetUrl(href: string, pageUrl: string): string {
  try {
    return new URL(href, pageUrl).toString()
  } catch {
    return href
  }
}

export function verifyRelatedLinksInHtml(input: {
  html: string
  pageUrl: string
  targets: RelatedVerifyTarget[]
}): RelatedVerifyResult {
  const links: RelatedLinkVerify[] = input.targets.map((t) => {
    const matches = anchorsMatchingHref(input.html, t.href, input.pageUrl)
    const problems: string[] = []
    const missing = matches.length === 0
    if (missing) problems.push('link is missing from the live page')
    const inContent = matches.some((a) => isContentRegion(a.region))
    if (!missing && !inContent) {
      problems.push('link is not inside article/main (footer, nav, or after the body)')
    }
    const emptyAnchor = matches.some((a) => !a.text)
    if (emptyAnchor) problems.push('anchor text is empty')
    const genericAnchor = matches.some(
      (a) => isGenericAnchor(a.text) || isBareUrlAnchor(a.text),
    )
    if (genericAnchor) {
      problems.push('anchor is generic or a bare URL — write a descriptive phrase')
    }
    const duplicate = matches.length > 1
    if (duplicate) problems.push('the same target is linked more than once on this page')
    const nofollow = matches.some((a) => a.nofollow)
    if (nofollow) problems.push('link is marked nofollow')
    return {
      href: t.href,
      ok: problems.length === 0,
      inContent,
      emptyAnchor,
      genericAnchor,
      duplicate,
      nofollow,
      missing,
      targetStatus: null,
      targetRedirected: false,
      problems: uniqueProblems(problems),
    }
  })
  const ok = links.every((l) => l.ok)
  return {
    ok,
    verifiedAt: new Date().toISOString(),
    links,
    detail: ok
      ? 'Related links are in article/main with descriptive anchors'
      : links
          .filter((l) => !l.ok)
          .map((l) => `${l.href}: ${l.problems.join('; ')}`)
          .join(' · ') || 'Related link checks failed',
  }
}

export async function probeTargetStatus(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ status: number; redirected: boolean }> {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
    })
    const status = res.status
    const redirected = status >= 300 && status < 400
    return { status, redirected }
  } catch {
    return { status: 0, redirected: false }
  }
}

export function applyTargetHttpStatus(
  result: RelatedVerifyResult,
  lookup: (href: string) => { status: number | null; redirected: boolean },
): RelatedVerifyResult {
  const links = result.links.map((link) => {
    const probed = lookup(link.href)
    const problems = [...link.problems]
    const targetStatus = probed.status
    let targetRedirected = probed.redirected
    if (targetStatus != null && targetStatus >= 300 && targetStatus < 400) {
      targetRedirected = true
    }
    if (targetRedirected) {
      problems.push('target URL redirects — point at the final 200 URL')
    }
    if (targetStatus != null && targetStatus >= 400) {
      problems.push(`target returned HTTP ${targetStatus}`)
    }
    if (targetStatus === 0) {
      problems.push('target URL could not be fetched')
    }
    const ok =
      problems.length === 0 &&
      !targetRedirected &&
      (targetStatus == null || targetStatus === 200)
    return {
      ...link,
      ok,
      targetStatus,
      targetRedirected,
      problems: uniqueProblems(problems),
    }
  })
  const ok = links.every((l) => l.ok)
  return {
    ...result,
    ok,
    links,
    detail: ok
      ? 'Related links are in article/main, crawlable, and the targets return 200'
      : links
          .filter((l) => !l.ok)
          .map((l) => `${l.href}: ${l.problems.join('; ')}`)
          .join(' · ') || 'Related link checks failed',
  }
}

export async function verifyRelatedFindingLive(input: {
  pageUrl: string
  targets: RelatedVerifyTarget[]
  html?: string
  fetchImpl?: typeof fetch
  verifiedAt?: string
}): Promise<RelatedVerifyResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  let html = input.html ?? ''
  if (!html) {
    try {
      const res = await fetchImpl(input.pageUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      })
      html = await res.text()
    } catch {
      return {
        ok: false,
        verifiedAt: input.verifiedAt ?? new Date().toISOString(),
        links: input.targets.map((t) => ({
          href: t.href,
          ok: false,
          inContent: false,
          emptyAnchor: true,
          genericAnchor: false,
          duplicate: false,
          nofollow: false,
          missing: true,
          targetStatus: null,
          targetRedirected: false,
          problems: ['source page could not be fetched'],
        })),
        detail: `Could not fetch ${input.pageUrl}`,
      }
    }
  }

  let result = verifyRelatedLinksInHtml({
    html,
    pageUrl: input.pageUrl,
    targets: input.targets,
  })
  const statuses = new Map<string, { status: number; redirected: boolean }>()
  for (const t of input.targets) {
    const url = resolveTargetUrl(t.href, input.pageUrl)
    statuses.set(normalizeHrefKey(t.href, input.pageUrl), await probeTargetStatus(url, fetchImpl))
  }
  result = applyTargetHttpStatus(result, (href) => {
    const hit = statuses.get(normalizeHrefKey(href, input.pageUrl))
    return { status: hit?.status ?? null, redirected: Boolean(hit?.redirected) }
  })
  return { ...result, verifiedAt: input.verifiedAt ?? result.verifiedAt }
}

export function summarizeRelatedVerify(
  result: Pick<RelatedVerifyResult, 'ok'> | null | undefined,
): 'verified' | 'problem' | null {
  if (!result) return null
  return result.ok ? 'verified' : 'problem'
}

export function relatedVerifyFromUnknown(
  raw: unknown,
): RelatedVerifyResult | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as {
    ok?: unknown
    verifiedAt?: unknown
    links?: unknown
    detail?: unknown
  }
  if (typeof rec.ok !== 'boolean') return null
  const links: RelatedLinkVerify[] = []
  if (Array.isArray(rec.links)) {
    for (const item of rec.links) {
      if (!item || typeof item !== 'object') continue
      const l = item as Record<string, unknown>
      if (typeof l.href !== 'string') continue
      links.push({
        href: l.href,
        ok: l.ok === true,
        inContent: l.inContent === true,
        emptyAnchor: l.emptyAnchor === true,
        genericAnchor: l.genericAnchor === true,
        duplicate: l.duplicate === true,
        nofollow: l.nofollow === true,
        missing: l.missing === true,
        targetStatus: typeof l.targetStatus === 'number' ? l.targetStatus : null,
        targetRedirected: l.targetRedirected === true,
        problems: Array.isArray(l.problems)
          ? l.problems.filter((p): p is string => typeof p === 'string')
          : [],
      })
    }
  }
  return {
    ok: rec.ok,
    verifiedAt: typeof rec.verifiedAt === 'string' ? rec.verifiedAt : '',
    links,
    detail: typeof rec.detail === 'string' ? rec.detail : '',
  }
}
