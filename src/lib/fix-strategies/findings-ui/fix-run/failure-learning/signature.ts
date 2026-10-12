import { createHash } from 'crypto'

export type FixFailureStage =
  | 'resolve'
  | 'apply'
  | 'preview_verify'
  | 'production_verify'
  | 'revert'
  | 'stall'

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const SHA_RE = /\b[0-9a-f]{7,64}\b/gi
const URL_RE = /https?:\/\/[^\s"'<>]+/gi
const NUMBER_RE = /\b\d+\b/g

/** Strip ids, URLs, and bare numbers so signatures group across sites. */
export function normaliseFailureReason(reason: string): string {
  return reason
    .replace(UUID_RE, '<id>')
    .replace(URL_RE, '<url>')
    .replace(SHA_RE, '<hash>')
    .replace(NUMBER_RE, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function buildFailureSignature(input: {
  topic: string
  verdict: string
  stage: FixFailureStage
  reason: string
}): string {
  const norm = normaliseFailureReason(input.reason)
  return `${input.topic}|${input.verdict}|${input.stage}|${norm}`
}

export function signatureHash(signature: string): string {
  return createHash('sha256').update(signature).digest('hex').slice(0, 16)
}
