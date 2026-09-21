/**
 * Topic 10 — www vs non-www duplicate URL forms.
 * No documented preference — derive from site signals; no defaults.
 */

import {
  detectDuplicateUrls,
  type DetectDuplicateUrlOptions,
  type DetectDuplicateUrlPage,
  type DetectDuplicateUrlResult,
} from '@/lib/fix-strategies/duplicate-url'

export async function detectWwwNonWwwDuplicates(
  pages: DetectDuplicateUrlPage[],
  options: Omit<DetectDuplicateUrlOptions, 'strategy'>,
): Promise<DetectDuplicateUrlResult> {
  return detectDuplicateUrls(pages, { ...options, strategy: 'www-non-www' })
}

export { verifyLiveDuplicateNormalized } from '@/lib/fix-strategies/duplicate-url'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const
