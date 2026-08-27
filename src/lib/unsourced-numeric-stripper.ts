// src/lib/unsourced-numeric-stripper.ts
// Deterministic generalization of unsourced currency / percentage / deadline
// claims BEFORE Quality Gate scores the article.
//
// Root cause of recurring claim-evidence + score-floor-fact-sourcing: the
// write step invents specific £ / % / deadline figures with no bound source.
// Prompt instructions already forbid this, but the model still emits them.
// Detection alone leaves fake stats in the shipped draft.
//
// This is the mechanical half: replace unsupported (and only partially
// supported) figures with non-numeric generalizations that point the reader
// at the official page — never invent a substitute number.

import { transformVisibleText } from './typography-normalizer'
import {
  evaluateClaimEvidence,
  normalizeClaimFigureIdentity,
  type ClaimEvidence,
  type ClaimEvidenceKind,
} from './claim-evidence'

/** Statuses that must not ship without a real bound source. */
const STRIP_STATUSES = new Set([
  'UNSUPPORTED',
  'PARTIALLY_SUPPORTED',
  'NEEDS_REVIEW',
  'OUTDATED',
  'CONTRADICTED',
])

/** Soft deadline / time-bound policy language without a concrete sourced date. */
const DEADLINE_PHRASE_RE =
  /\b(?:by|before|until|no later than)\s+(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d{2}\b/gi

/** £2,000–£4,500 or £2000-£4500 (en-dash or hyphen). */
const CURRENCY_RANGE_RE = /[£$€]\s?[\d,]+(?:\.\d+)?\s*[–—-]\s*[£$€]?\s?[\d,]+(?:\.\d+)?/g
/** 25–30% style ranges. */
const PERCENT_RANGE_RE = /\d+(?:\.\d+)?\s*[–—-]\s*\d+(?:\.\d+)?\s?%/g

export interface UnsourcedNumericStripResult {
  html: string
  /** Figure identities that were generalized. */
  strippedFigures: string[]
  strippedCount: number
  /** ClaimEvidence records that drove the strip (for logging / tests). */
  strippedClaims: ClaimEvidence[]
}

function generalizationFor(figure: string, kind: ClaimEvidenceKind): string {
  const isPct = /%/.test(figure)
  const isUpTo = /^up to\s+/i.test(figure)

  // Wording MUST avoid claim-evidence trigger tokens (grant|scheme|rate|cap|
  // deadline|policy|…) or the generalized sentence is re-extracted as an
  // unsourced figure-less claim and the Quality Gate warning returns.
  if (isPct) {
    if (isUpTo || kind === 'grant' || kind === 'eligibility' || kind === 'government-policy') {
      return 'up to a set percentage — confirm the current figure on the official page'
    }
    return 'a reported percentage — confirm against the cited official page'
  }

  if (isUpTo || kind === 'grant' || kind === 'eligibility' || kind === 'government-policy') {
    return 'up to the published amount — confirm on the official page'
  }
  if (kind === 'price') {
    return 'a published amount — check current installer quotes'
  }
  return 'a published amount — confirm on the official page'
}

function shouldStripClaim(ev: ClaimEvidence): boolean {
  if (!ev.figureText) return false
  return STRIP_STATUSES.has(ev.status)
}

function figureToPattern(figure: string): RegExp {
  const escaped = figure
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s*')
    .replace(/,/g, ',?')
  return new RegExp(escaped, 'gi')
}

function identityOfCurrencyToken(token: string): string {
  const withSym = /[£$€]/.test(token) ? token : `£${token}`
  return normalizeClaimFigureIdentity(withSym)
}

/**
 * Replace unsourced currency/percentage figures in visible text with
 * non-numeric generalizations. Markup, attributes, JSON-LD and code are
 * never touched (transformVisibleText).
 *
 * Sourced claims (SUPPORTED / HISTORICAL) are left intact.
 */
export function stripUnsourcedNumericClaims(html: string): UnsourcedNumericStripResult {
  if (!html) {
    return { html, strippedFigures: [], strippedCount: 0, strippedClaims: [] }
  }

  const evidence = evaluateClaimEvidence(html)
  const toStrip = evidence.filter(shouldStripClaim)
  const strippedFigures: string[] = []

  const identitySet = new Set(
    toStrip.map((ev) => normalizeClaimFigureIdentity(ev.figureText || '')),
  )
  const kindByIdentity = new Map<string, ClaimEvidenceKind>()
  for (const ev of toStrip) {
    if (ev.figureText) {
      kindByIdentity.set(normalizeClaimFigureIdentity(ev.figureText), ev.claimKind)
    }
  }

  // Longer figures first so "up to £350" wins over "£350"
  const figuresDesc = Array.from(
    new Set(toStrip.map((ev) => ev.figureText!).filter(Boolean)),
  ).sort((a, b) => b.length - a.length)

  let out = html

  if (figuresDesc.length > 0) {
    out = transformVisibleText(out, (text) => {
      let result = text

      result = result.replace(CURRENCY_RANGE_RE, (match) => {
        const parts = match.match(/[£$€]?\s?[\d,]+(?:\.\d+)?/g) || []
        const hits = parts.some((p) => identitySet.has(identityOfCurrencyToken(p)))
        if (!hits) return match
        strippedFigures.push(match)
        return 'a published price range — check current installer quotes'
      })

      result = result.replace(PERCENT_RANGE_RE, (match) => {
        const first = match.match(/\d+(?:\.\d+)?/)?.[0]
        if (!first) return match
        if (!identitySet.has(normalizeClaimFigureIdentity(`${first}%`))) return match
        strippedFigures.push(match)
        return 'a reported percentage range — confirm on the official page'
      })

      for (const figure of figuresDesc) {
        const id = normalizeClaimFigureIdentity(figure)
        const kind = kindByIdentity.get(id) || 'other-quantitative'
        const figPat = figureToPattern(figure)

        if (!/^up to\s+/i.test(figure)) {
          const upToPat = new RegExp(`up\\s+to\\s+${figPat.source}`, 'gi')
          result = result.replace(upToPat, () => {
            strippedFigures.push(`up to ${figure}`)
            return generalizationFor(`up to ${figure}`, kind)
          })
        }

        result = result.replace(figPat, () => {
          strippedFigures.push(figure)
          return generalizationFor(figure, kind)
        })
      }

      result = result.replace(/\bup to\s+up to\b/gi, 'up to')
      return result.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1')
    })
  }

  out = stripUnsourcedDeadlinePhrases(out, strippedFigures)

  // Second pass: figure-less policy assertions (deadline/must + scheme language)
  // that claim-evidence still flags after numeric generalization. Soften them
  // without inventing a number — same goal as the figure strip.
  out = softenRemainingFigurelessClaims(out, strippedFigures)

  return {
    html: out,
    strippedFigures: Array.from(new Set(strippedFigures)),
    strippedCount: strippedFigures.length,
    strippedClaims: toStrip,
  }
}

/**
 * Replace concrete calendar deadlines that sit in paragraphs with no
 * citation link. "Adjacent" = same <p> has an http(s) <a href>.
 */
function stripUnsourcedDeadlinePhrases(html: string, strippedFigures: string[]): string {
  return html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (full, inner: string) => {
    const hasLink = /<a\b[^>]+href=["']https?:\/\//i.test(inner)
    if (hasLink) return full
    const next = inner.replace(DEADLINE_PHRASE_RE, (match) => {
      strippedFigures.push(match)
      return 'by the date shown on the official page'
    })
    if (next === inner) return full
    const open = full.match(/^<p\b[^>]*>/i)?.[0] || '<p>'
    return `${open}${next}</p>`
  })
}

/**
 * Soften leftover figure-less policy claims (no £/%) that would still fire
 * claim-evidence after the numeric pass — e.g. "Deadlines land by…" or
 * "applications must be filed…" without a bound source for that sentence.
 */
function softenRemainingFigurelessClaims(html: string, strippedFigures: string[]): string {
  const remaining = evaluateClaimEvidence(html).filter(
    (ev) => !ev.figureText && STRIP_STATUSES.has(ev.status),
  )
  if (remaining.length === 0) return html

  let out = html
  for (const ev of remaining) {
    const snippet = ev.claimText?.trim()
    if (!snippet || snippet.length < 20) continue
    // Only rewrite when the claim text still appears as visible prose
    if (!out.includes(snippet) && !out.replace(/<[^>]+>/g, ' ').includes(snippet)) {
      continue
    }
    const safe =
      'Confirm timing and requirements on the official page before acting.'
    const replaced = transformVisibleText(out, (text) => {
      if (!text.includes(snippet)) return text
      strippedFigures.push(snippet.slice(0, 80))
      return text.split(snippet).join(safe)
    })
    out = replaced
  }
  return out
}

/**
 * True when visible text still contains a currency or percentage figure
 * that claim-evidence would flag for strip (post-condition helper).
 */
export function remainingUnsourcedFigures(html: string): ClaimEvidence[] {
  return evaluateClaimEvidence(html).filter(shouldStripClaim)
}

export const UNSOURCED_NUMERIC_PATTERNS = {
  CURRENCY_RANGE_RE,
  PERCENT_RANGE_RE,
  DEADLINE_PHRASE_RE,
}
