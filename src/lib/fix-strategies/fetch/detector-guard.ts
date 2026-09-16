/**
 * Topic 67 — detectors that read content, links, metadata, or structured data
 * must refuse incomplete stream reads rather than classify a prefix.
 */

import type { ContentPresenceState } from './content-presence'
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

export type ContentSignalFinding = {
  kind:
    | 'thin-or-empty-content'
    | 'missing-internal-link'
    | 'missing-metadata'
    | 'missing-structured-data'
  presence: ContentPresenceState
}

/**
 * Minimal content/link/metadata/SD probe used by topic 67 fixtures.
 * Not a shipping detector for topics 29–39 / 43 / 60 — only the stream guard
 * contract: incomplete → refuse; complete empty → findings; complete with
 * late-stream content → no false absence findings.
 */
export function probeContentSignals(
  outcome: FetchOutcome,
): DetectorRefusal | { refused: false; findings: ContentSignalFinding[] } {
  const gate = requireCompleteStream(outcome)
  if (gate.refused) return gate

  const body = gate.body
  const findings: ContentSignalFinding[] = []

  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const wordCount = text.length === 0 ? 0 : text.split(' ').filter(Boolean).length

  if (wordCount === 0) {
    findings.push({
      kind: 'thin-or-empty-content',
      presence: 'client_only',
    })
  }

  if (!/<a\s[^>]*href\s*=/i.test(body)) {
    findings.push({
      kind: 'missing-internal-link',
      presence: 'client_only',
    })
  }

  if (!/<title[\s>]/i.test(body) && !/<meta\s[^>]*name\s*=\s*["']description["']/i.test(body)) {
    findings.push({
      kind: 'missing-metadata',
      presence: 'client_only',
    })
  }

  if (!/<script[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(body)) {
    findings.push({
      kind: 'missing-structured-data',
      presence: 'client_only',
    })
  }

  return { refused: false, findings }
}
