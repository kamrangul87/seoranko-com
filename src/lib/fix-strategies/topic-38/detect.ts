/**
 * Topic 38 — structured data contradicting the visible page.
 *
 * 38a only is provable: structured-vs-structured comparisons.
 * 38b is observation-only — never assert a spam-policy violation.
 * No prose parsing, no semantic similarity.
 */

import {
  extractStructuredData,
  getProp,
  type StructuredDataExtraction,
  type StructuredDataNode,
} from '@/lib/fix-strategies/shared/structured-data-extract'
import { parseHtml } from '@/lib/fix-strategies/shared/html-parser'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared/url-normalize'

export type Topic38Verdict =
  | 'human-review-date-ordering'
  | 'human-review-future-datePublished'
  | 'human-review-rating-inconsistent'
  | 'human-review-item-count-mismatch'
  | 'human-review-structured-vs-structured'
  | 'human-review-event-date-ordering'
  | 'human-review-entity-url-mismatch'
  | 'observation-38b'
  | 'suppress-format-only-date-diff'
  | 'suppress-dateModified-equals-datePublished'
  | 'suppress-paywalled-permitted'
  | 'ok'

export type Topic38Finding = {
  kind: 'structured-data/contradicts-visible-page'
  verdict: Topic38Verdict
  severity: 'high' | null
  pageUrl: string
  detail: string
  autoFixable: boolean
  /**
   * Always null for entity-url mismatches — choosing self vs the declared
   * URL is intent (syndication may be deliberate). Kept for type stability.
   */
  proposedEntityUrl: string | null
  /** For entity-url: left = entity `url`, right = page URL carrying markup. */
  values: { left: string; right: string } | null
  /** Topic 70 / caller-resolved declaration site for register-wide rollup. */
  declarationSite: string | null
}

export type DetectTopic38Result = {
  findings: Topic38Finding[]
  observations: Topic38Finding[]
  suppressed: Array<{ verdict: Topic38Verdict; detail: string }>
  extraction: StructuredDataExtraction
}

export type DetectTopic38Options = {
  html: string
  pageUrl: string
  extraction?: StructuredDataExtraction
  /** Caller flags paywalled-content markup (guard 6). */
  paywalledContentMarkup?: boolean
  /**
   * 38b observation hook — never a policy violation. Method must be stated.
   */
  observation38b?: { detail: string; method: string } | null
  /** "now" for future datePublished checks (ISO or ms). */
  nowMs?: number
  /**
   * Repo path or logical id of the declaring layout/component/generator
   * (topic 70). When set, register-wide rollup can collapse N pages to one.
   */
  declarationSite?: string | null
}

function asString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  return null
}

function parseDateMs(raw: string): number | null {
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : null
}

/** Normalize date strings for equality ignoring display format. */
export function normalizeDateForCompare(raw: string): string | null {
  const ms = parseDateMs(raw)
  if (ms == null) return null
  return new Date(ms).toISOString()
}

function collectTimeDatetimes(html: string): string[] {
  const parsed = parseHtml(html)
  const out: string[] = []
  for (const el of parsed.bodyElements('time')) {
    const dt = el.attrs.datetime?.trim()
    if (dt) out.push(dt)
  }
  return out
}

function collectItempropValues(
  html: string,
  prop: string,
): string[] {
  const parsed = parseHtml(html)
  const out: string[] = []
  for (const tag of ['meta', 'span', 'div', 'p', 'time', 'a', 'data']) {
    for (const el of [
      ...parsed.headElements(tag),
      ...parsed.bodyElements(tag),
    ]) {
      if ((el.attrs.itemprop ?? '').trim() !== prop) continue
      const content =
        el.attrs.content?.trim() ||
        el.attrs.datetime?.trim() ||
        el.attrs.value?.trim() ||
        (el.textContent ?? '').trim()
      if (content) out.push(content)
    }
  }
  return out
}

function ratingOutOfScale(node: StructuredDataNode): {
  bad: boolean
  detail: string
} | null {
  const value =
    getProp(node, 'aggregateRating.ratingValue') ??
    getProp(node, 'ratingValue')
  const count =
    getProp(node, 'aggregateRating.reviewCount') ??
    getProp(node, 'reviewCount')
  const best =
    getProp(node, 'aggregateRating.bestRating') ??
    getProp(node, 'bestRating')
  const worst =
    getProp(node, 'aggregateRating.worstRating') ??
    getProp(node, 'worstRating')

  // Also accept nested object form if not flattened
  const rating = getProp(node, 'aggregateRating')
  const nested =
    rating && typeof rating === 'object' && !Array.isArray(rating)
      ? (rating as Record<string, unknown>)
      : null
  const vRaw = value ?? nested?.ratingValue
  const cRaw = count ?? nested?.reviewCount
  const bestRaw = best ?? nested?.bestRating
  const worstRaw = worst ?? nested?.worstRating

  if (vRaw == null && cRaw == null) return null
  const c = Number(cRaw)
  if (cRaw != null && c === 0) {
    return {
      bad: true,
      detail: 'aggregateRating present with reviewCount of zero (D19)',
    }
  }
  const v = Number(vRaw)
  const hi = bestRaw != null ? Number(bestRaw) : 5
  const lo = worstRaw != null ? Number(worstRaw) : 1
  if (vRaw != null && Number.isFinite(v) && (v < lo || v > hi)) {
    return {
      bad: true,
      detail: `ratingValue ${v} outside declared scale ${lo}–${hi} (D19)`,
    }
  }
  return null
}

/** Never assert spam-policy violation. */
export function rejectedSpamPolicyAccusation(): never {
  throw new Error(
    'topic 38: never assert a spam-policy violation — observation language only (D23)',
  )
}

/** Never parse prose or use semantic similarity. */
export function rejectedProseOrSemanticCompare(): never {
  throw new Error(
    'topic 38: 38a compares structured values only — no prose / semantic similarity',
  )
}

export function detectStructuredDataContradictsVisible(
  options: DetectTopic38Options,
): DetectTopic38Result {
  const extraction =
    options.extraction ??
    extractStructuredData(options.html, options.pageUrl)
  const findings: Topic38Finding[] = []
  const observations: Topic38Finding[] = []
  const suppressed: DetectTopic38Result['suppressed'] = []
  const now = options.nowMs ?? Date.now()
  const pageNorm =
    normalizeFixStrategyUrl(options.pageUrl) ?? options.pageUrl
  const declarationSite = options.declarationSite ?? null

  if (options.paywalledContentMarkup) {
    suppressed.push({
      verdict: 'suppress-paywalled-permitted',
      detail: 'Paywalled content markup is permitted — never raise as hidden',
    })
  }

  const timeDts = collectTimeDatetimes(options.html)

  for (const node of extraction.nodes) {
    const published = asString(getProp(node, 'datePublished'))
    const modified = asString(getProp(node, 'dateModified'))

    if (published && modified) {
      const p = parseDateMs(published)
      const m = parseDateMs(modified)
      if (p != null && m != null) {
        if (m === p) {
          suppressed.push({
            verdict: 'suppress-dateModified-equals-datePublished',
            detail: 'dateModified equals datePublished — valid',
          })
        } else if (m < p) {
          findings.push({
            kind: 'structured-data/contradicts-visible-page',
            verdict: 'human-review-date-ordering',
            severity: 'high',
            pageUrl: options.pageUrl,
            detail: `dateModified (${modified}) earlier than datePublished (${published})`,
            autoFixable: false,
            proposedEntityUrl: null,
            declarationSite,
            values: { left: modified, right: published },
          })
        }
      }
    }

    if (published) {
      const p = parseDateMs(published)
      if (p != null && p > now) {
        findings.push({
          kind: 'structured-data/contradicts-visible-page',
          verdict: 'human-review-future-datePublished',
          severity: 'high',
          pageUrl: options.pageUrl,
          detail: `datePublished is in the future: ${published}`,
          autoFixable: false,
          proposedEntityUrl: null,
          declarationSite,
          values: { left: published, right: new Date(now).toISOString() },
        })
      }
    }

    // Structured datePublished vs <time datetime>
    if (published && timeDts.length > 0) {
      const pubNorm = normalizeDateForCompare(published)
      for (const dt of timeDts) {
        const dtNorm = normalizeDateForCompare(dt)
        if (pubNorm && dtNorm && pubNorm === dtNorm) {
          if (published !== dt) {
            suppressed.push({
              verdict: 'suppress-format-only-date-diff',
              detail: `datePublished and <time datetime> differ only by format (${published} vs ${dt})`,
            })
          }
        } else if (pubNorm && dtNorm && pubNorm !== dtNorm) {
          findings.push({
            kind: 'structured-data/contradicts-visible-page',
            verdict: 'human-review-structured-vs-structured',
            severity: 'high',
            pageUrl: options.pageUrl,
            detail: `Marked-up datePublished (${published}) disagrees with <time datetime> (${dt})`,
            autoFixable: false,
            proposedEntityUrl: null,
            declarationSite,
            values: { left: published, right: dt },
          })
        }
      }
    }

    // price: JSON-LD vs itemprop
    const price = asString(getProp(node, 'offers.price')) ?? asString(getProp(node, 'price'))
    if (price) {
      const itemPrices = collectItempropValues(options.html, 'price')
      for (const ip of itemPrices) {
        const a = price.replace(/[^\d.]/g, '')
        const b = ip.replace(/[^\d.]/g, '')
        if (a && b && a !== b) {
          findings.push({
            kind: 'structured-data/contradicts-visible-page',
            verdict: 'human-review-structured-vs-structured',
            severity: 'high',
            pageUrl: options.pageUrl,
            detail: `offers.price (${price}) disagrees with itemprop=price (${ip})`,
            autoFixable: false,
            proposedEntityUrl: null,
            declarationSite,
            values: { left: price, right: ip },
          })
        }
      }
    }

    const ratingBad = ratingOutOfScale(node)
    if (ratingBad?.bad) {
      findings.push({
        kind: 'structured-data/contradicts-visible-page',
        verdict: 'human-review-rating-inconsistent',
        severity: 'high',
        pageUrl: options.pageUrl,
        detail: ratingBad.detail,
        autoFixable: false,
        proposedEntityUrl: null,
        declarationSite,
        values: null,
      })
    }

    // Event dates
    if (node.types.some((t) => /Event/i.test(t))) {
      const start = asString(getProp(node, 'startDate'))
      const end = asString(getProp(node, 'endDate'))
      if (start && end) {
        const s = parseDateMs(start)
        const e = parseDateMs(end)
        if (s != null && e != null && e < s) {
          findings.push({
            kind: 'structured-data/contradicts-visible-page',
            verdict: 'human-review-event-date-ordering',
            severity: 'high',
            pageUrl: options.pageUrl,
            detail: `Event endDate (${end}) before startDate (${start})`,
            autoFixable: false,
            proposedEntityUrl: null,
            declarationSite,
            values: { left: end, right: start },
          })
        }
      }
    }

    // ItemList / Carousel numberOfItems
    if (
      node.types.some((t) => /ItemList|Carousel/i.test(t))
    ) {
      const declared = getProp(node, 'numberOfItems')
      const elements = getProp(node, 'itemListElement')
      if (declared != null && Array.isArray(elements)) {
        const n = Number(declared)
        if (Number.isFinite(n) && n !== elements.length) {
          findings.push({
            kind: 'structured-data/contradicts-visible-page',
            verdict: 'human-review-item-count-mismatch',
            severity: 'high',
            pageUrl: options.pageUrl,
            detail: `numberOfItems (${n}) disagrees with itemListElement length (${elements.length})`,
            autoFixable: false,
            proposedEntityUrl: null,
            declarationSite,
            values: {
              left: String(n),
              right: String(elements.length),
            },
          })
        }
      }
    }

    // Entity url mismatch (D6) — human-review: both sides are site claims
    // (syndication / cross-page entity url may be deliberate). Never auto-fix.
    const entityUrl = asString(getProp(node, 'url'))
    if (entityUrl) {
      const entNorm = normalizeFixStrategyUrl(entityUrl, options.pageUrl)
      if (entNorm && entNorm !== pageNorm) {
        findings.push({
          kind: 'structured-data/contradicts-visible-page',
          verdict: 'human-review-entity-url-mismatch',
          severity: 'high',
          pageUrl: options.pageUrl,
          detail: `Entity url (${entNorm}) ≠ page url (${pageNorm}) carrying the markup (D6). Both are site claims — syndication may be deliberate; human review.`,
          autoFixable: false,
          proposedEntityUrl: null,
          declarationSite,
          values: { left: entNorm, right: pageNorm },
        })
      }
    }
  }

  if (options.observation38b) {
    observations.push({
      kind: 'structured-data/contradicts-visible-page',
      verdict: 'observation-38b',
      severity: null,
      pageUrl: options.pageUrl,
      detail: `Observation (${options.observation38b.method}): ${options.observation38b.detail}. Not a spam-policy violation (D23).`,
      autoFixable: false,
      proposedEntityUrl: null,
      declarationSite,
      values: null,
    })
  }

  return { findings, observations, suppressed, extraction }
}
