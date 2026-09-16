/**
 * Prove content sameness for duplicate-URL topics 8–12.
 *
 * Sameness must be PROVEN, not assumed. Two forms with different content
 * are not duplicates.
 *
 * Proof: identical response-body hash, OR identical normalised main-content
 * hash (scripts/styles/tags stripped). Either is sufficient.
 */

import { createHash } from 'node:crypto'

export type ContentSamenessResult = {
  same: boolean
  bodyHashA: string
  bodyHashB: string
  mainHashA: string
  mainHashB: string
  detail: string
}

/** Strip tags / scripts and collapse whitespace for main-content comparison. */
export function normalizeMainContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Compare two response bodies. Returns same=true only when proven identical
 * by body hash or normalised main-content hash.
 */
export function proveContentSameness(
  bodyA: string,
  bodyB: string,
): ContentSamenessResult {
  const bodyHashA = sha256Hex(bodyA)
  const bodyHashB = sha256Hex(bodyB)
  const mainHashA = sha256Hex(normalizeMainContent(bodyA))
  const mainHashB = sha256Hex(normalizeMainContent(bodyB))

  if (bodyHashA === bodyHashB) {
    return {
      same: true,
      bodyHashA,
      bodyHashB,
      mainHashA,
      mainHashB,
      detail: 'Identical response body hash',
    }
  }

  if (mainHashA === mainHashB && mainHashA.length > 0) {
    // Empty main content on both sides is weak — still "same" but note it.
    const empty = normalizeMainContent(bodyA).length === 0
    return {
      same: true,
      bodyHashA,
      bodyHashB,
      mainHashA,
      mainHashB,
      detail: empty
        ? 'Normalised main content identical (both empty)'
        : 'Identical normalised main-content hash',
    }
  }

  return {
    same: false,
    bodyHashA,
    bodyHashB,
    mainHashA,
    mainHashB,
    detail: 'Content differs — not a duplicate',
  }
}
