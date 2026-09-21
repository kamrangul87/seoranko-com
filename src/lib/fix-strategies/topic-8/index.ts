/**
 * Topic 8 — trailing slash duplicate URL forms.
 * Template topic; uses shared duplicate-url detector with trailing-slash strategy.
 */

import {
  detectDuplicateUrls,
  type DetectDuplicateUrlOptions,
  type DetectDuplicateUrlPage,
  type DetectDuplicateUrlResult,
} from '@/lib/fix-strategies/duplicate-url'

export async function detectTrailingSlashDuplicates(
  pages: DetectDuplicateUrlPage[],
  options: Omit<DetectDuplicateUrlOptions, 'strategy'>,
): Promise<DetectDuplicateUrlResult> {
  return detectDuplicateUrls(pages, { ...options, strategy: 'trailing-slash' })
}

export {
  setTrailingSlashConfig,
  verifyLiveDuplicateNormalized,
} from '@/lib/fix-strategies/duplicate-url'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const
