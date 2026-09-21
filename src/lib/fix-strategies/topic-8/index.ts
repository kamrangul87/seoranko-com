/**
 * Topic 8 — trailing slash + directory index.html duplicate URL forms.
 * Template topic; uses shared duplicate-url detector.
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

/** /x vs /x/index.html — not produced by trailing-slash generation. */
export async function detectIndexHtmlDuplicates(
  pages: DetectDuplicateUrlPage[],
  options: Omit<DetectDuplicateUrlOptions, 'strategy'>,
): Promise<DetectDuplicateUrlResult> {
  return detectDuplicateUrls(pages, { ...options, strategy: 'index-html' })
}

export {
  setTrailingSlashConfig,
  verifyLiveDuplicateNormalized,
} from '@/lib/fix-strategies/duplicate-url'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const
