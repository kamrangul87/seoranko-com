/**
 * Topic 1 — entry that refuses incomplete source fetches (topic 67).
 * Detectors must not parse anchors from a truncated stream.
 */

import {
  requireCompleteStream,
  type DetectorRefusal,
} from '@/lib/fix-strategies/fetch'
import type { FetchDeps, FetchOutcome } from '@/lib/fix-strategies/fetch'
import { detectGoneAnchors, type Detect410Result } from './detect-410'

export type DetectGoneFromFetchResult =
  | DetectorRefusal
  | ({ refused: false } & Detect410Result)

/**
 * Runs the 410 detector only when the source page stream completed.
 * On streamComplete: false, returns { refused: true } and does not read body.
 */
export async function detectGoneAnchorsFromFetch(
  sourceFetch: FetchOutcome,
  sourceUrl: string,
  deps: FetchDeps,
): Promise<DetectGoneFromFetchResult> {
  const gate = requireCompleteStream(sourceFetch)
  if (gate.refused) return gate

  const result = await detectGoneAnchors(gate.body, sourceUrl, deps)
  return { refused: false, ...result }
}
