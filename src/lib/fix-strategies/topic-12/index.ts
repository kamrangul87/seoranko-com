/**
 * Topic 12 — query parameter variants (12a tracking / 12b report-only).
 * Prefer canonical over redirect for tracking params.
 * robots.txt blocking of parameters is REJECTED.
 */

import {
  detectDuplicateUrls,
  setCanonicalToCleanUrl,
  rejectedRobotsTxtParamBlock,
  verifyLiveDuplicateNormalized,
  type DetectDuplicateUrlOptions,
  type DetectDuplicateUrlPage,
  type DetectDuplicateUrlResult,
} from '@/lib/fix-strategies/duplicate-url'

export async function detectQueryParamDuplicates(
  pages: DetectDuplicateUrlPage[],
  options: Omit<DetectDuplicateUrlOptions, 'strategy'>,
): Promise<DetectDuplicateUrlResult> {
  return detectDuplicateUrls(pages, { ...options, strategy: 'query-params' })
}

export {
  setCanonicalToCleanUrl,
  rejectedRobotsTxtParamBlock,
  verifyLiveDuplicateNormalized,
}

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const
