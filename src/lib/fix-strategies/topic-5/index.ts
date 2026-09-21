/** Topic 5 — redirect loops and self-redirects / missing Location. */
export {
  detectRedirectTopics,
  classifyRedirectLoop,
  isTrailingSlashBounceOnly,
  verifyLiveOriginResolvesCleanly,
  walkRedirectChain,
} from '@/lib/fix-strategies/redirect-chain'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const
