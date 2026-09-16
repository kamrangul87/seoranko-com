/**
 * Topic 11 — path case variants.
 * NEVER blanket-lowercase. Only a specific proven pair with identical content.
 */

import {
  detectDuplicateUrls,
  type DetectDuplicateUrlOptions,
  type DetectDuplicateUrlPage,
  type DetectDuplicateUrlResult,
} from '@/lib/fix-strategies/duplicate-url'

export async function detectPathCaseDuplicates(
  pages: DetectDuplicateUrlPage[],
  options: Omit<DetectDuplicateUrlOptions, 'strategy'>,
): Promise<DetectDuplicateUrlResult> {
  return detectDuplicateUrls(pages, {
    ...options,
    strategy: 'path-case',
    // Explicitly never pass blanketLowercaseProposed: true from this entrypoint.
    blanketLowercaseProposed: false,
  })
}

export { verifyLiveDuplicateNormalized } from '@/lib/fix-strategies/duplicate-url'
