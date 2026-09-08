/**
 * Normalised page-state extraction for intervention before/after records.
 * Only the fields listed in the Intervention Dataset spec — never full HTML,
 * body prose, credentials, or tokens.
 */

import { createHash } from 'crypto'
import { validateSchema } from '@/lib/schema-validator'

export type InterventionPageState = {
  title: string
  meta_description: string
  canonical: string
  meta_robots: string
  headings: {
    h1: string[]
    h2: string[]
    h3: string[]
  }
  structured_data_types: string[]
  internal_outlink_count: number
  internal_outlink_targets: string[]
  status_code: number | null
  word_count: number
}

export type PageStateChangeDiff = {
  fields: string[]
  before: Partial<InterventionPageState>
  after: Partial<InterventionPageState>
}

const EMPTY: InterventionPageState = {
  title: '',
  meta_description: '',
  canonical: '',
  meta_robots: '',
  headings: { h1: [], h2: [], h3: [] },
  structured_data_types: [],
  internal_outlink_count: 0,
  internal_outlink_targets: [],
  status_code: null,
  word_count: 0,
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function extractHeadings(html: string, tag: 'h1' | 'h2' | 'h3'): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const out: string[] = []
  const matches = Array.from(html.matchAll(re))
  for (const m of matches) {
    const text = stripTags(m[1] || '')
    if (text) out.push(text)
  }
  return out.slice(0, 50)
}

function extractMetaRobots(html: string): string {
  const m =
    html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']robots["']/i)
  return (m?.[1] || '').trim().toLowerCase()
}

function extractCanonical(html: string): string {
  const m =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)
  return (m?.[1] || '').trim()
}

function extractInternalOutlinks(html: string, pageUrl?: string | null): string[] {
  let baseHost = ''
  try {
    if (pageUrl) baseHost = new URL(pageUrl).hostname.replace(/^www\./, '')
  } catch {
    /* ignore */
  }
  const targets = new Set<string>()
  const linkMatches = Array.from(html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi))
  for (const m of linkMatches) {
    const href = (m[1] || '').trim()
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
      continue
    }
    try {
      if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) {
        targets.add(href.split('?')[0]!)
        continue
      }
      const u = new URL(href, pageUrl || 'https://example.invalid')
      const host = u.hostname.replace(/^www\./, '')
      if (!baseHost || host === baseHost) {
        targets.add(`${u.pathname}${u.search}`.replace(/\?$/, '') || '/')
      }
    } catch {
      /* skip bad hrefs */
    }
  }
  return Array.from(targets).sort().slice(0, 200)
}

function estimateWordCount(html: string): number {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  const text = stripTags(withoutScripts)
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * Extract the normalised intervention page state from HTML.
 * `statusCode` is optional — pass the live HTTP status when known.
 */
export function extractPageState(
  html: string,
  opts?: { statusCode?: number | null; pageUrl?: string | null },
): InterventionPageState {
  if (!html || typeof html !== 'string') {
    return {
      ...EMPTY,
      status_code: opts?.statusCode ?? null,
      headings: { h1: [], h2: [], h3: [] },
      structured_data_types: [],
      internal_outlink_targets: [],
    }
  }

  const title = stripTags(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  const metaDescription =
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim() ||
    html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i)?.[1]?.trim() ||
    ''

  const schemaTypes = [...validateSchema(html).schemasFound]
    .map((t) => String(t).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))

  const internalTargets = extractInternalOutlinks(html, opts?.pageUrl)

  return {
    title,
    meta_description: metaDescription,
    canonical: extractCanonical(html),
    meta_robots: extractMetaRobots(html),
    headings: {
      h1: extractHeadings(html, 'h1'),
      h2: extractHeadings(html, 'h2'),
      h3: extractHeadings(html, 'h3'),
    },
    structured_data_types: schemaTypes,
    internal_outlink_count: internalTargets.length,
    internal_outlink_targets: internalTargets,
    status_code: opts?.statusCode ?? null,
    word_count: estimateWordCount(html),
  }
}

/** Stable canonical JSON for hashing (sorted keys, deterministic arrays). */
export function canonicalizePageState(state: InterventionPageState): string {
  const normalized: InterventionPageState = {
    title: state.title || '',
    meta_description: state.meta_description || '',
    canonical: state.canonical || '',
    meta_robots: state.meta_robots || '',
    headings: {
      h1: [...(state.headings?.h1 || [])],
      h2: [...(state.headings?.h2 || [])],
      h3: [...(state.headings?.h3 || [])],
    },
    structured_data_types: [...(state.structured_data_types || [])].sort((a, b) =>
      a.localeCompare(b),
    ),
    internal_outlink_count: state.internal_outlink_count || 0,
    internal_outlink_targets: [...(state.internal_outlink_targets || [])].sort(),
    status_code: state.status_code ?? null,
    word_count: state.word_count || 0,
  }
  return JSON.stringify(normalized)
}

export function hashPageState(state: InterventionPageState): string {
  return createHash('sha256').update(canonicalizePageState(state)).digest('hex')
}

function fieldEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Which normalised fields differ between before and after. */
export function diffPageStates(
  before: InterventionPageState,
  after: InterventionPageState,
): PageStateChangeDiff {
  const fields: string[] = []
  const beforePartial: Partial<InterventionPageState> = {}
  const afterPartial: Partial<InterventionPageState> = {}

  const keys: (keyof InterventionPageState)[] = [
    'title',
    'meta_description',
    'canonical',
    'meta_robots',
    'headings',
    'structured_data_types',
    'internal_outlink_count',
    'internal_outlink_targets',
    'status_code',
    'word_count',
  ]

  for (const key of keys) {
    if (!fieldEqual(before[key], after[key])) {
      fields.push(key)
      ;(beforePartial as Record<string, unknown>)[key] = before[key]
      ;(afterPartial as Record<string, unknown>)[key] = after[key]
    }
  }

  return { fields, before: beforePartial, after: afterPartial }
}

/** Fields that must match on an independent re-crawl for a given subtype. */
export function verificationFieldsForSubtype(subtype: string): (keyof InterventionPageState)[] {
  switch (subtype) {
    case 'title':
      return ['title']
    case 'meta_description':
      return ['meta_description']
    case 'canonical':
      return ['canonical']
    case 'meta_robots':
    case 'robots_txt':
      return ['meta_robots']
    case 'schema_added':
    case 'schema_modified':
    case 'schema_removed':
      return ['structured_data_types']
    case 'inlink_added':
    case 'inlink_removed':
    case 'anchor_changed':
      return ['internal_outlink_targets', 'internal_outlink_count']
    case 'h1_changed':
      return ['headings']
    case 'hierarchy_fixed':
      return ['headings']
    default:
      return ['title', 'meta_description', 'canonical', 'meta_robots', 'headings', 'structured_data_types']
  }
}

export function projectPageState(
  state: InterventionPageState,
  fields: (keyof InterventionPageState)[],
): Partial<InterventionPageState> {
  const out: Partial<InterventionPageState> = {}
  for (const f of fields) {
    ;(out as Record<string, unknown>)[f] = state[f]
  }
  return out
}

export function hashPageStateFields(
  state: InterventionPageState,
  fields: (keyof InterventionPageState)[],
): string {
  return createHash('sha256')
    .update(JSON.stringify(projectPageState(state, fields)))
    .digest('hex')
}

/**
 * Independent re-crawl matches expected after_state when the subtype-relevant
 * field hash matches. Full-page hash is too brittle (scripts, CSRF, dates).
 */
export function liveMatchesExpectedAfter(
  expectedAfter: InterventionPageState,
  liveState: InterventionPageState,
  subtype?: string,
): boolean {
  const fields = verificationFieldsForSubtype(subtype || '')
  return (
    hashPageStateFields(expectedAfter, fields) === hashPageStateFields(liveState, fields)
  )
}
