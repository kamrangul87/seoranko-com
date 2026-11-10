/**
 * Site-wide internal linking plan.
 * Deterministic text similarity (path + title + H1). No paid APIs.
 *
 * Follows Google's crawlable-link guidance: real <a href>, descriptive
 * varied anchors from the target title/H1, no hidden links, relevance first.
 */

import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import { LINK_MAP_MAX_PAGES } from './rebuild-edges'
import type { CrawlLinkEdge } from './types'

export const LINK_PLAN_MAX_NEW_PER_SOURCE = 4
export const LINK_PLAN_ORPHAN_INBOUND = 2
const DEEP_CLICKS = 3

const STOP = new Set([
  'www',
  'com',
  'html',
  'php',
  'index',
  'page',
  'blog',
  'post',
  'posts',
  'the',
  'and',
  'for',
  'uk',
])

export type PlanPageInput = {
  url: string
  finalUrl: string | null
  httpStatus: number | null
  jobStatus: string
  title: string | null
  h1: string | null
  text: string
  noindex: boolean
}

export type PlannedLinkKind =
  | 'hub-to-spoke'
  | 'spoke-to-hub'
  | 'sibling'
  | 'orphan-inlink'
  | 'depth-shortcut'

export type PlannedLink = {
  id: string
  sourceUrl: string
  targetUrl: string
  href: string
  anchorText: string
  reason: string
  kind: PlannedLinkKind
}

export type TopicCluster = {
  id: string
  hubUrl: string
  memberUrls: string[]
}

export type SiteLinkPlan = {
  clusters: TopicCluster[]
  links: PlannedLink[]
}

function norm(url: string, base?: string): string {
  return normalizeFixStrategyUrl(url, base) ?? url
}

function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname || '/'
  } catch {
    return url
  }
}

function pathParts(url: string): string[] {
  return pathOf(url).replace(/\/+$/, '').split('/').filter(Boolean)
}

function firstSegment(url: string): string {
  const parts = pathParts(url)
  if (parts.length === 0) return ''
  return parts[0]!.replace(/\.html$/i, '')
}

function extraSegments(hubUrl: string, memberUrl: string): number {
  const hp = pathParts(hubUrl)
  const mp = pathParts(memberUrl)
  if (mp.length < hp.length) return 99
  for (let i = 0; i < hp.length; i++) {
    if (hp[i] !== mp[i]) return 99
  }
  return mp.length - hp.length
}

function tokensOf(s: string): Set<string> {
  const out = new Set<string>()
  for (const part of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length < 2) continue
    if (STOP.has(part)) continue
    out.add(part)
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

function isRedirectPage(p: PlanPageInput): boolean {
  if (p.httpStatus != null && p.httpStatus >= 300 && p.httpStatus < 400) return true
  if (!p.finalUrl) return false
  return norm(p.finalUrl, p.url) !== norm(p.url)
}

function isBrokenPage(p: PlanPageInput): boolean {
  if (p.jobStatus === 'failed') return true
  if (p.httpStatus == null) return false
  return p.httpStatus >= 400
}

function isEligible(p: PlanPageInput): boolean {
  if (p.noindex) return false
  if (isBrokenPage(p)) return false
  if (isRedirectPage(p)) return false
  return true
}

function hrefOf(url: string): string {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}` || '/'
  } catch {
    return url
  }
}

function cleanPhrase(s: string | null | undefined): string {
  return (s || '').replace(/\s+/g, ' ').trim()
}

/** Anchors from the target title/H1 only — never invented marketing copy. */
export function anchorCandidates(h1: string | null, title: string | null): string[] {
  const raw = [cleanPhrase(h1), cleanPhrase(title)].filter(Boolean)
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim()
    if (t.length < 2) return
    const k = t.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(t)
  }
  for (const s of raw) {
    push(s)
    const clause = s.split(/\s*[|—–•]\s*/)[0] || ''
    push(clause)
    const words = s.split(/\s+/).filter(Boolean)
    if (words.length > 3) push(words.slice(0, 3).join(' '))
    if (words.length > 2) push(words.slice(0, 2).join(' '))
  }
  return out
}

function pickAnchor(
  target: PlanPageInput,
  usedForTarget: Set<string>,
): string {
  const cands = anchorCandidates(target.h1, target.title)
  for (const c of cands) {
    if (!usedForTarget.has(c.toLowerCase())) {
      usedForTarget.add(c.toLowerCase())
      return c
    }
  }
  if (cands[0]) {
    usedForTarget.add(cands[0].toLowerCase())
    return cands[0]
  }
  const parts = pathParts(target.url)
  const last = (parts[parts.length - 1] || 'Home').replace(/\.html$/i, '')
  return last.replace(/[-_]+/g, ' ') || 'Home'
}

function pageTokens(p: PlanPageInput): Set<string> {
  return tokensOf(`${pathOf(p.url)} ${p.title || ''} ${p.h1 || ''} ${p.text || ''}`)
}

function parentDir(url: string): string {
  const parts = pathParts(url)
  parts.pop()
  return `/${parts.join('/')}`
}

function uniqueInbound(
  target: string,
  existing: Set<string>,
  planned: PlannedLink[],
): number {
  const src = new Set<string>()
  for (const k of existing) {
    const [s, t] = k.split('\0')
    if (t === target && s !== target) src.add(s!)
  }
  for (const l of planned) {
    if (l.targetUrl === target && l.sourceUrl !== target) src.add(l.sourceUrl)
  }
  return src.size
}

function bfsDepth(
  home: string,
  existing: Set<string>,
  planned: PlannedLink[],
): Map<string, number> {
  const adj = new Map<string, string[]>()
  const add = (s: string, t: string) => {
    if (s === t) return
    const list = adj.get(s) ?? []
    if (!list.includes(t)) list.push(t)
    adj.set(s, list)
  }
  for (const k of existing) {
    const [s, t] = k.split('\0')
    if (s && t) add(s, t)
  }
  for (const l of planned) add(l.sourceUrl, l.targetUrl)
  const depth = new Map<string, number>()
  depth.set(home, 0)
  const q = [home]
  while (q.length) {
    const cur = q.shift()!
    const d = depth.get(cur) ?? 0
    for (const next of adj.get(cur) ?? []) {
      if (depth.has(next)) continue
      depth.set(next, d + 1)
      q.push(next)
    }
  }
  return depth
}

function chooseHub(clusterId: string, members: PlanPageInput[]): PlanPageInput {
  const exact = members.find((m) => {
    const p = pathOf(m.url).replace(/\/+$/, '') || '/'
    return (
      p === `/${clusterId}` ||
      p === `/${clusterId}/index.html` ||
      p === `/${clusterId}.html` ||
      p === `/${clusterId}/index`
    )
  })
  if (exact) return exact
  return [...members].sort((a, b) => {
    const pa = pathOf(a.url).length
    const pb = pathOf(b.url).length
    if (pa !== pb) return pa - pb
    return a.url.localeCompare(b.url)
  })[0]!
}

function reasonFor(kind: PlannedLinkKind, clusterId?: string): string {
  switch (kind) {
    case 'hub-to-spoke':
      return clusterId
        ? `Hub to spoke in the ${clusterId} cluster`
        : 'Hub to spoke'
    case 'spoke-to-hub':
      return clusterId
        ? `Spoke back to the ${clusterId} hub`
        : 'Spoke back to the hub'
    case 'sibling':
      return 'Related page in the same topic cluster'
    case 'orphan-inlink':
      return 'Give this orphan a crawlable inbound link'
    case 'depth-shortcut':
      return 'Bring this page within 3 clicks of home'
  }
}

export function planSitewideInternalLinks(input: {
  originUrl: string
  homepageUrl?: string
  pages: PlanPageInput[]
  edges: CrawlLinkEdge[]
  maxNewLinksPerSource?: number
  maxPages?: number
}): SiteLinkPlan {
  const maxPages = Math.min(input.maxPages ?? LINK_MAP_MAX_PAGES, LINK_MAP_MAX_PAGES)
  const cap = input.maxNewLinksPerSource ?? LINK_PLAN_MAX_NEW_PER_SOURCE
  const home = norm(input.homepageUrl ?? input.originUrl, input.originUrl)

  const eligibleAll = input.pages.filter(isEligible).map((p) => ({
    ...p,
    url: norm(p.url, input.originUrl),
  }))
  const homePage = eligibleAll.find((p) => p.url === home)
  const rest = eligibleAll.filter((p) => p.url !== home).sort((a, b) => a.url.localeCompare(b.url))
  const limited = (homePage ? [homePage, ...rest] : rest).slice(0, maxPages)
  const byUrl = new Map(limited.map((p) => [p.url, p]))

  const existing = new Set<string>()
  for (const e of input.edges) {
    const s = norm(e.sourceUrl, input.originUrl)
    const t = norm(e.targetUrl, input.originUrl)
    if (s !== t) existing.add(`${s}\0${t}`)
  }

  const groups = new Map<string, PlanPageInput[]>()
  for (const p of limited) {
    if (p.url === home) continue
    const id = firstSegment(p.url) || 'site'
    const list = groups.get(id) ?? []
    list.push(p)
    groups.set(id, list)
  }

  const clusters: TopicCluster[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, members]) => {
      const sorted = [...members].sort((a, b) => a.url.localeCompare(b.url))
      const hub = chooseHub(id, sorted)
      return {
        id,
        hubUrl: hub.url,
        memberUrls: sorted.map((m) => m.url),
      }
    })

  const links: PlannedLink[] = []
  const newCount = new Map<string, number>()
  const usedAnchor = new Map<string, Set<string>>()
  const tokenCache = new Map<string, Set<string>>()
  const tokens = (p: PlanPageInput) => {
    let t = tokenCache.get(p.url)
    if (!t) {
      t = pageTokens(p)
      tokenCache.set(p.url, t)
    }
    return t
  }

  const canAdd = (source: string, target: string): boolean => {
    if (source === target) return false
    if (!byUrl.has(source) || !byUrl.has(target)) return false
    if (existing.has(`${source}\0${target}`)) return false
    if (links.some((l) => l.sourceUrl === source && l.targetUrl === target)) return false
    if ((newCount.get(source) ?? 0) >= cap) return false
    return true
  }

  const add = (
    source: string,
    target: string,
    kind: PlannedLinkKind,
    clusterId?: string,
  ): boolean => {
    if (!canAdd(source, target)) return false
    const targetPage = byUrl.get(target)!
    const used = usedAnchor.get(target) ?? new Set<string>()
    const anchorText = pickAnchor(targetPage, used)
    usedAnchor.set(target, used)
    links.push({
      id: `${source}|${target}|${kind}`,
      sourceUrl: source,
      targetUrl: target,
      href: hrefOf(target),
      anchorText,
      reason: reasonFor(kind, clusterId),
      kind,
    })
    newCount.set(source, (newCount.get(source) ?? 0) + 1)
    return true
  }

  // 1. Homepage → each cluster hub (keeps sections within 3 clicks).
  for (const c of clusters) {
    if (c.hubUrl === home) continue
    add(home, c.hubUrl, 'hub-to-spoke', c.id)
  }

  // 2. Hub → direct children; 3. every spoke → hub.
  for (const c of clusters) {
    const hub = byUrl.get(c.hubUrl)
    if (!hub) continue
    const members = c.memberUrls
      .map((u) => byUrl.get(u)!)
      .filter(Boolean)
      .sort((a, b) => {
        const sa = jaccard(tokens(hub), tokens(a))
        const sb = jaccard(tokens(hub), tokens(b))
        if (sb !== sa) return sb - sa
        return a.url.localeCompare(b.url)
      })
    for (const m of members) {
      if (m.url === c.hubUrl) continue
      if (extraSegments(c.hubUrl, m.url) === 1) {
        add(c.hubUrl, m.url, 'hub-to-spoke', c.id)
      }
    }
    for (const m of members) {
      if (m.url === c.hubUrl) continue
      add(m.url, c.hubUrl, 'spoke-to-hub', c.id)
    }
  }

  // 4. Related siblings: URL neighbors in the same directory (O(n), Hobby-safe).
  for (const c of clusters) {
    const members = c.memberUrls.map((u) => byUrl.get(u)!).filter(Boolean)
    const byParent = new Map<string, PlanPageInput[]>()
    for (const m of members) {
      if (m.url === c.hubUrl) continue
      const dir = parentDir(m.url)
      const list = byParent.get(dir) ?? []
      list.push(m)
      byParent.set(dir, list)
    }
    for (const group of byParent.values()) {
      group.sort((a, b) => a.url.localeCompare(b.url))
      for (let i = 0; i < group.length; i++) {
        const m = group[i]!
        const window = group.slice(Math.max(0, i - 4), i + 5).filter((o) => o.url !== m.url)
        window.sort((a, b) => {
          const sa = jaccard(tokens(m), tokens(a))
          const sb = jaccard(tokens(m), tokens(b))
          if (sb !== sa) return sb - sa
          return a.url.localeCompare(b.url)
        })
        let added = 0
        for (const other of window) {
          if (added >= 2) break
          if (add(m.url, other.url, 'sibling', c.id)) added++
        }
        if (added < 2 && i + 1 < group.length) {
          if (add(m.url, group[i + 1]!.url, 'sibling', c.id)) added++
        }
        if (added < 2 && i > 0) {
          add(m.url, group[i - 1]!.url, 'sibling', c.id)
        }
      }
    }
  }

  const nearbySources = (target: PlanPageInput): PlanPageInput[] => {
    const cluster = clusters.find((c) => c.memberUrls.includes(target.url))
    const preferred: PlanPageInput[] = []
    const seen = new Set<string>()
    const push = (u: string | undefined) => {
      if (!u || u === target.url || seen.has(u)) return
      const p = byUrl.get(u)
      if (!p) return
      seen.add(u)
      preferred.push(p)
    }
    push(home)
    push(cluster?.hubUrl)
    const dir = parentDir(target.url)
    const siblings = limited
      .filter((p) => p.url !== target.url && parentDir(p.url) === dir)
      .sort((a, b) => a.url.localeCompare(b.url))
    const idx = siblings.findIndex((p) => p.url > target.url)
    const around = [
      ...siblings.slice(Math.max(0, (idx < 0 ? siblings.length : idx) - 3), (idx < 0 ? siblings.length : idx) + 3),
    ]
    around.sort((a, b) => {
      const sa = jaccard(tokens(target), tokens(a))
      const sb = jaccard(tokens(target), tokens(b))
      if (sb !== sa) return sb - sa
      return a.url.localeCompare(b.url)
    })
    for (const s of around) push(s.url)
    return preferred
  }

  // 5. Pages with no existing inbound links get at least 2 inbound (orphans).
  for (const p of limited) {
    if (p.url === home) continue
    const existingIn = uniqueInbound(p.url, existing, [])
    if (existingIn > 0) continue
    while (uniqueInbound(p.url, existing, links) < LINK_PLAN_ORPHAN_INBOUND) {
      let placed = false
      for (const src of nearbySources(p)) {
        if (add(src.url, p.url, 'orphan-inlink')) {
          placed = true
          break
        }
      }
      if (!placed) break
    }
  }

  // 6. Pages still 3+ clicks deep get a hub/home shortcut. One BFS pass.
  const depths = bfsDepth(home, existing, links)
  for (const p of limited) {
    if (p.url === home) continue
    const d = depths.get(p.url)
    if (d != null && d <= DEEP_CLICKS) continue
    const cluster = clusters.find((c) => c.memberUrls.includes(p.url))
    const preferred = [cluster?.hubUrl, home].filter(
      (u): u is string => Boolean(u) && u !== p.url,
    )
    let placed = false
    for (const src of preferred) {
      if (add(src, p.url, 'depth-shortcut', cluster?.id)) {
        placed = true
        break
      }
    }
    if (!placed) {
      for (const src of nearbySources(p)) {
        if (add(src.url, p.url, 'depth-shortcut', cluster?.id)) break
      }
    }
  }

  return {
    clusters,
    links: links.sort((a, b) => a.id.localeCompare(b.id)),
  }
}
