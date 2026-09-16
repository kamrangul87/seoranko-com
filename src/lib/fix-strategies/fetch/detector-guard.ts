/**
 * Topic 67 — detectors that read content, links, metadata, or structured data
 * must refuse incomplete stream reads rather than classify a prefix.
 */

import {
  presenceAfterServedHtml,
  presenceLabel,
  type ContentPresenceState,
} from './content-presence'
import type { FetchOutcome } from './types'

export type DetectorRefusal = {
  refused: true
  reason: 'stream_incomplete'
}

export type DetectorFetchGate = {
  refused: false
  body: string
  streamComplete: true
}

/**
 * Hard gate: incomplete (or non-HTTP) outcomes never reach content classifiers.
 * Callers must return this refusal instead of reading `outcome.body`.
 */
export function requireCompleteStream(
  outcome: FetchOutcome,
): DetectorRefusal | DetectorFetchGate {
  if (outcome.kind !== 'http') {
    return { refused: true, reason: 'stream_incomplete' }
  }
  if (!outcome.streamComplete) {
    return { refused: true, reason: 'stream_incomplete' }
  }
  return {
    refused: false,
    body: outcome.body,
    streamComplete: true,
  }
}

export type ContentSignalKind =
  | 'thin-or-empty-content'
  | 'missing-internal-link'
  | 'missing-metadata'
  | 'missing-structured-data'

/**
 * Finding carried end-to-end: presence is on the finding, not only the fetch.
 * `client_only` signals are observations, not content defects (topic 67 R7/R28).
 */
export type ContentSignalFinding = {
  kind: ContentSignalKind
  presence: ContentPresenceState
  /** False when presence is client_only — suppresses defect-class output. */
  raiseAsDefect: boolean
  /** User-facing line; never says "missing" for client_only. */
  summary: string
}

function signalFinding(
  kind: ContentSignalKind,
  hasSignal: boolean,
): ContentSignalFinding | null {
  if (hasSignal) return null
  const presence = presenceAfterServedHtml(false)
  const raiseAsDefect = presence === 'absent'
  const label = presenceLabel(presence)
  const summaries: Record<ContentSignalKind, string> = {
    'thin-or-empty-content': `Main content: ${label}`,
    'missing-internal-link': `Crawlable anchors: ${label}`,
    'missing-metadata': `Title/description metadata: ${label}`,
    'missing-structured-data': `JSON-LD structured data: ${label}`,
  }
  return {
    kind,
    presence,
    raiseAsDefect,
    summary: summaries[kind],
  }
}

/**
 * Minimal content/link/metadata/SD probe used by topic 67 fixtures and as the
 * pattern for later detectors. Incomplete → refuse. Complete empty → findings
 * with presence client_only (not defects). Complete with late-stream content →
 * no absence findings.
 */
export function probeContentSignals(
  outcome: FetchOutcome,
): DetectorRefusal | { refused: false; findings: ContentSignalFinding[] } {
  const gate = requireCompleteStream(outcome)
  if (gate.refused) return gate

  // Body is only read after the gate — never on streamComplete: false.
  const body = gate.body
  const findings: ContentSignalFinding[] = []

  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const wordCount = text.length === 0 ? 0 : text.split(' ').filter(Boolean).length

  const thin = signalFinding('thin-or-empty-content', wordCount > 0)
  if (thin) findings.push(thin)

  const links = signalFinding(
    'missing-internal-link',
    /<a\s[^>]*href\s*=/i.test(body),
  )
  if (links) findings.push(links)

  const meta = signalFinding(
    'missing-metadata',
    /<title[\s>]/i.test(body) ||
      /<meta\s[^>]*name\s*=\s*["']description["']/i.test(body),
  )
  if (meta) findings.push(meta)

  const sd = signalFinding(
    'missing-structured-data',
    /<script[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(body),
  )
  if (sd) findings.push(sd)

  return { refused: false, findings }
}

/** Defect-class findings only — client_only observations are suppressed here. */
export function defectFindings(
  findings: ContentSignalFinding[],
): ContentSignalFinding[] {
  return findings.filter((f) => f.raiseAsDefect)
}
