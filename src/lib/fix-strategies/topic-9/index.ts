/**
 * Topic 9 — HTTP vs HTTPS duplicate URL forms.
 * Preferred form is documented: HTTPS (Google).
 */

import {
  detectDuplicateUrls,
  type DetectDuplicateUrlOptions,
  type DetectDuplicateUrlPage,
  type DetectDuplicateUrlResult,
} from '@/lib/fix-strategies/duplicate-url'

export async function detectHttpHttpsDuplicates(
  pages: DetectDuplicateUrlPage[],
  options: Omit<DetectDuplicateUrlOptions, 'strategy'>,
): Promise<DetectDuplicateUrlResult> {
  return detectDuplicateUrls(pages, { ...options, strategy: 'http-https' })
}

export { verifyLiveDuplicateNormalized } from '@/lib/fix-strategies/duplicate-url'
