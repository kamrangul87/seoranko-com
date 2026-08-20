/**
 * Freshness evaluator — single scan that produces FreshnessFinding records.
 *
 * Production code never hard-codes current grant/policy figures; optional
 * `evidenceProvider` supplies live/fixture authoritative values for tests
 * and live verification.
 */

import {
  detectDatedClaims,
  detectTimeAnchoredClaims,
} from '@/lib/dated-claim-detector'
import {
  type FreshnessEvidenceStatus,
  type FreshnessFinding,
  buildFreshnessRecommendedAction,
  classifyClaimType,
  classifyTimeStatus,
  isInstructionalNonFactual,
  severityForFreshnessFinding,
  QUANTITATIVE_FACT_RE,
} from '@/lib/freshness-policy'
import {
  bindSourceToClaim,
  classifyClaimKind,
  extractArticleCitations,
  extractTopicTerms,
} from '@/lib/claim-evidence'

export type FreshnessAuthoritativeEvidence = {
  sourceUrl: string
  sourceAuthority?: string
  sourceUpdatedAt?: string
  /** From live fetch or test fixture — never hard-coded in validators. */
  currentValueText?: string
  supportsHistorical?: boolean
  supportsCurrent?: boolean
  amounts?: string[]
}

export type FreshnessEvidenceProvider = (
  finding: FreshnessFinding,
) => FreshnessAuthoritativeEvidence | null | Promise<FreshnessAuthoritativeEvidence | null>

export type EvaluateFreshnessOptions = {
  now?: Date
  evidenceProvider?: FreshnessEvidenceProvider
}

const AMOUNT_RE =
  /£\s*[\d,]+(?:\.\d+)?|\$\s*[\d,]+(?:\.\d+)?|€\s*[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?%/g
const OFFICIAL_HOST_RE = /gov\.uk|legislation\.gov|europa\.eu|nist\.gov|who\.int|irs\.gov/i

function extractAmounts(text: string): string[] {
  return Array.from(text.matchAll(AMOUNT_RE)).map((m) => m[0].replace(/\s+/g, ''))
}

function normalizeAmount(a: string): string {
  return a.replace(/\s+/g, '').toLowerCase()
}

function amountsMatch(claimAmounts: string[], evidenceAmounts: string[]): boolean {
  if (claimAmounts.length === 0 || evidenceAmounts.length === 0) return false
  const ev = new Set(evidenceAmounts.map(normalizeAmount))
  return claimAmounts.every((a) => ev.has(normalizeAmount(a)))
}

function amountsConflict(claimAmounts: string[], evidenceAmounts: string[]): boolean {
  if (claimAmounts.length === 0 || evidenceAmounts.length === 0) return false
  const ev = new Set(evidenceAmounts.map(normalizeAmount))
  return claimAmounts.some((a) => !ev.has(normalizeAmount(a)))
}

function extractFigure(sentence: string): string | undefined {
  return extractAmounts(sentence)[0]
}

export function isOfficialFreshnessUrl(url: string): boolean {
  try {
    return OFFICIAL_HOST_RE.test(new URL(url).hostname)
  } catch {
    return OFFICIAL_HOST_RE.test(url)
  }
}

/**
 * Bind a citation URL to a sentence using claim-level evidence rules:
 * figure-in-context > topical official — never "any official URL".
 */
export function bindCitationForSentence(
  sentence: string,
  allUrls: string[],
  articleHtml?: string,
): string | undefined {
  if (articleHtml) {
    const citations = extractArticleCitations(articleHtml)
    const claim = {
      text: sentence.slice(0, 80),
      position: 0,
      figureText: extractFigure(sentence),
      claimKind: classifyClaimKind(sentence),
      topicTerms: extractTopicTerms(sentence),
      claimText: sentence,
    }
    const { source } = bindSourceToClaim(claim, citations)
    if (source?.url) return source.url
  }

  const tokens = sentence
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3)

  const officialAll = allUrls.filter(isOfficialFreshnessUrl)
  for (const url of officialAll) {
    const hay = url.toLowerCase()
    if (tokens.some((t) => hay.includes(t))) return url
  }
  if (/\b(grant|scheme|fund|subsid|ozev|policy|eligib|charg)\b/i.test(sentence)) {
    const topical = officialAll.find((u) =>
      /grant|scheme|charg(?:e|ing|epoint)?|eligib|subsid|emission|ozev|low-emission|fund(?:ing)?/i.test(
        u,
      ),
    )
    if (topical) return topical
  }
  return undefined
}

function baseFinding(
  sentence: string,
  detector: string,
  citationUrl: string | undefined,
  now: Date,
  supportTier?: 'figure-in-context' | 'topical-official' | 'topical-secondary' | 'none',
): FreshnessFinding | null {
  const trimmed = sentence.trim()
  if (!trimmed) return null
  if (isInstructionalNonFactual(trimmed)) return null

  const claimType = classifyClaimType(trimmed)
  if (claimType === 'instructional' || claimType === 'non-factual') return null

  const timeStatus = classifyTimeStatus(trimmed, now)

  let evidenceStatus: FreshnessEvidenceStatus
  if (!citationUrl || supportTier === 'none') {
    evidenceStatus = 'UNSUPPORTED'
  } else if (supportTier === 'figure-in-context') {
    evidenceStatus = 'SUPPORTED'
  } else if (supportTier === 'topical-official') {
    // Topical official source for this claim kind — treated as supported for
    // freshness (live verify may still contradict). Claim-evidence issues use
    // PARTIALLY_SUPPORTED separately when the figure is not in citation context.
    evidenceStatus = 'SUPPORTED'
  } else if (supportTier === 'topical-secondary') {
    evidenceStatus = 'PARTIALLY_SUPPORTED'
  } else if (isOfficialFreshnessUrl(citationUrl)) {
    evidenceStatus = 'SUPPORTED'
  } else {
    evidenceStatus =
      timeStatus === 'CURRENT' || timeStatus === 'NEEDS_REVIEW'
        ? 'NEEDS_REVIEW'
        : 'PARTIALLY_SUPPORTED'
  }

  const finding: FreshnessFinding = {
    sentence: trimmed,
    claimType,
    timeStatus,
    evidenceStatus,
    figureText: extractFigure(trimmed),
    citationUrl: evidenceStatus === 'UNSUPPORTED' ? undefined : citationUrl,
    recommendedAction: '',
    detector,
  }
  finding.recommendedAction = buildFreshnessRecommendedAction(finding)
  return finding
}

function bindForHtml(sentence: string, html: string): {
  url?: string
  tier: 'figure-in-context' | 'topical-official' | 'topical-secondary' | 'none'
} {
  const citations = extractArticleCitations(html)
  const claim = {
    text: sentence.slice(0, 80),
    position: 0,
    figureText: extractFigure(sentence),
    claimKind: classifyClaimKind(sentence),
    topicTerms: extractTopicTerms(sentence),
    claimText: sentence,
  }
  const { source, supportTier } = bindSourceToClaim(claim, citations)
  if (source?.url) return { url: source.url, tier: supportTier }
  // No soft fallback to unrelated official URLs — claim-level binding only.
  return { tier: 'none' }
}

function findingKey(f: FreshnessFinding): string {
  // Prefer figure-based dedupe so chrono vs relative scans of the same claim
  // cannot emit two Quality Gate rows when sentence boundaries differ slightly.
  const figure = (f.figureText || '').toLowerCase().replace(/\s+/g, '')
  if (figure) {
    return `fig:${figure}|${f.timeStatus}`
  }
  const norm = f.sentence
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[""]/g, '"')
    .slice(0, 160)
  return `sent:${norm}`
}

function paragraphsPlain(html: string): string[] {
  const out: string[] = []
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text) out.push(text)
  }
  return out
}

function sentenceFromPlain(plain: string, index: number, length: number): string {
  const start = Math.max(0, plain.lastIndexOf('.', Math.max(0, index - 1)) + 1)
  const next = plain.indexOf('.', index + length)
  const end = next === -1 ? plain.length : next + 1
  return plain.slice(start, end).trim()
}

/**
 * Core scan (sync). Apply evidence with evaluateFreshness({ evidenceProvider }).
 */
export function evaluateFreshnessSync(
  html: string,
  opts: { now?: Date } = {},
): FreshnessFinding[] {
  const now = opts.now ?? new Date()
  const findings: FreshnessFinding[] = []
  const seen = new Set<string>()

  const push = (f: FreshnessFinding | null) => {
    if (!f) return
    const key = findingKey(f)
    if (seen.has(key)) return
    seen.add(key)
    findings.push(f)
  }

  try {
    for (const claim of detectDatedClaims(html, now)) {
      if (isInstructionalNonFactual(claim.sentence)) continue
      const bound = bindForHtml(claim.sentence, html)
      push(baseFinding(claim.sentence, 'chrono', bound.url, now, bound.tier))
    }
  } catch {
    /* ignore */
  }

  try {
    for (const claim of detectTimeAnchoredClaims(html, now)) {
      if (isInstructionalNonFactual(claim.sentence)) continue
      if (!QUANTITATIVE_FACT_RE.test(claim.sentence) && !claim.extractedNumericValue) continue
      const bound = bindForHtml(claim.sentence, html)
      push(baseFinding(claim.sentence, 'time-anchored', bound.url, now, bound.tier))
    }
  } catch {
    /* ignore */
  }

  const relativeRe =
    /\b(?:currently|now|today|this year|as of|at present)\b[^.!?]{0,160}?(?:£\s*[\d,]+|\$\s*[\d,]+|€\s*[\d,]+|\b\d+(?:\.\d+)?%|\brequir(?:e|es|ed)\b|\beligible\b|\bmust\b|\bpolicy\b|\bgrant\b)/gi
  const futureRe =
    /\b(?:from|starting|beginning)\s+\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b[^.!?]{0,120}?(?:£\s*[\d,]+|\b\d+(?:\.\d+)?%|\bgrant\b|\bpolicy\b)/gi

  for (const plain of paragraphsPlain(html)) {
    let rm: RegExpExecArray | null
    relativeRe.lastIndex = 0
    while ((rm = relativeRe.exec(plain)) !== null) {
      const sentence = sentenceFromPlain(plain, rm.index, rm[0].length)
      if (isInstructionalNonFactual(sentence)) continue
      if (!QUANTITATIVE_FACT_RE.test(sentence)) continue
      const bound = bindForHtml(sentence, html)
      push(baseFinding(sentence, 'relative-factual', bound.url, now, bound.tier))
    }

    futureRe.lastIndex = 0
    while ((rm = futureRe.exec(plain)) !== null) {
      const sentence = sentenceFromPlain(plain, rm.index, rm[0].length)
      const bound = bindForHtml(sentence, html)
      const f = baseFinding(sentence, 'future', bound.url, now, bound.tier)
      if (f) {
        f.timeStatus = 'FUTURE'
        f.recommendedAction = buildFreshnessRecommendedAction(f)
        push(f)
      }
    }
  }

  return findings
}

export async function applyAuthoritativeEvidence(
  finding: FreshnessFinding,
  evidence: FreshnessAuthoritativeEvidence | null,
): Promise<FreshnessFinding> {
  if (!evidence) return finding

  const next: FreshnessFinding = {
    ...finding,
    citationUrl: evidence.sourceUrl || finding.citationUrl,
  }

  const claimAmounts = extractAmounts(finding.sentence)
  const evidenceAmounts =
    evidence.amounts?.length
      ? evidence.amounts
      : evidence.currentValueText
        ? extractAmounts(evidence.currentValueText)
        : []

  if (finding.timeStatus === 'HISTORICAL') {
    if (
      evidence.supportsHistorical === true ||
      (evidenceAmounts.length > 0 && amountsMatch(claimAmounts, evidenceAmounts))
    ) {
      next.evidenceStatus = 'SUPPORTED'
      next.timeStatus = 'HISTORICAL'
      next.evidenceSummary = evidence.sourceUpdatedAt
        ? `Official historical source (${evidence.sourceUpdatedAt}) supports this past figure.`
        : 'Official source supports this as a historical figure.'
    } else if (evidence.supportsHistorical === false) {
      next.evidenceStatus = 'UNSUPPORTED'
      next.evidenceSummary = 'Cited source does not support this historical claim.'
    }
  } else if (finding.timeStatus === 'FUTURE') {
    next.timeStatus = 'FUTURE'
    next.evidenceStatus =
      evidence.supportsCurrent === true || evidence.supportsHistorical === true
        ? 'SUPPORTED'
        : finding.citationUrl
          ? 'PARTIALLY_SUPPORTED'
          : 'NEEDS_REVIEW'
    next.evidenceSummary =
      'Future-dated policy statement — verify closer to the effective date. Not automatically outdated.'
  } else {
    if (
      evidence.supportsCurrent === true ||
      (evidenceAmounts.length > 0 && amountsMatch(claimAmounts, evidenceAmounts))
    ) {
      next.evidenceStatus = 'SUPPORTED'
      next.timeStatus = 'CURRENT'
      next.evidenceSummary = evidence.sourceUpdatedAt
        ? `Official source updated ${evidence.sourceUpdatedAt} supports current value${
            evidence.currentValueText ? `: ${evidence.currentValueText}` : ''
          }.`
        : `Authoritative source supports the current claim${
            evidence.currentValueText ? ` (${evidence.currentValueText})` : ''
          }.`
    } else if (
      evidence.supportsCurrent === false ||
      (evidenceAmounts.length > 0 && amountsConflict(claimAmounts, evidenceAmounts))
    ) {
      next.evidenceStatus = 'CONTRADICTED'
      next.timeStatus = 'OUTDATED'
      const current = evidence.currentValueText ?? evidenceAmounts[0] ?? null
      next.evidenceSummary = [
        evidence.sourceUpdatedAt
          ? `Official source updated ${evidence.sourceUpdatedAt}`
          : 'Official source',
        current ? `Current value: ${current}` : null,
        `Article claim: ${claimAmounts[0] ?? finding.figureText ?? finding.sentence.slice(0, 80)}`,
      ]
        .filter(Boolean)
        .join('. ')
    } else if (
      finding.citationUrl &&
      evidence.supportsCurrent == null &&
      evidenceAmounts.length === 0
    ) {
      next.evidenceStatus = 'NEEDS_REVIEW'
      next.evidenceSummary =
        'Citation present but claim not confirmed against an authoritative current value.'
    }
  }

  next.recommendedAction = buildFreshnessRecommendedAction(next)
  return next
}

export async function evaluateFreshness(
  html: string,
  opts: EvaluateFreshnessOptions = {},
): Promise<FreshnessFinding[]> {
  const findings = evaluateFreshnessSync(html, { now: opts.now })
  if (!opts.evidenceProvider) return findings
  const out: FreshnessFinding[] = []
  for (const f of findings) {
    const ev = await opts.evidenceProvider(f)
    out.push(await applyAuthoritativeEvidence(f, ev))
  }
  return out
}

/** Findings that become Quality Gate issues (excludes CURRENT+SUPPORTED). */
export function freshnessFindingsRequiringIssues(
  findings: FreshnessFinding[],
): FreshnessFinding[] {
  return findings.filter((f) => severityForFreshnessFinding(f) !== null)
}

export function buildFreshnessIssueDescription(finding: FreshnessFinding): string {
  const parts = [`Claim: "${finding.sentence}"`]
  if (finding.evidenceSummary) {
    parts.push(`Evidence: ${finding.evidenceSummary}`)
  } else if (finding.citationUrl) {
    parts.push(`Citation: ${finding.citationUrl}`)
  } else {
    parts.push('Evidence: no authoritative citation bound to this claim.')
  }
  parts.push(`Recommended action: ${finding.recommendedAction}`)
  parts.push(`Status: ${finding.timeStatus} / ${finding.evidenceStatus}`)
  return parts.join('\n')
}

export function freshnessIssueTitle(finding: FreshnessFinding): string {
  if (finding.evidenceStatus === 'CONTRADICTED' || finding.timeStatus === 'OUTDATED') {
    return `Claim may be outdated${finding.figureText ? `: "${finding.figureText}"` : ''}`
  }
  if (finding.timeStatus === 'HISTORICAL' && finding.evidenceStatus === 'SUPPORTED') {
    return `Historical claim (sourced)${finding.figureText ? `: "${finding.figureText}"` : ''}`
  }
  if (finding.timeStatus === 'FUTURE') {
    return `Future policy statement${finding.figureText ? `: "${finding.figureText}"` : ''}`
  }
  if (finding.evidenceStatus === 'UNSUPPORTED') {
    return `Time-sensitive claim needs a source${finding.figureText ? `: "${finding.figureText}"` : ''}`
  }
  return `Time-sensitive claim — confirm still current${
    finding.figureText ? `: "${finding.figureText}"` : ''
  }`
}
