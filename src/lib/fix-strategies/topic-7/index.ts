/** Topic 7 — redirect target not 200. */
export {
  detectRedirectTopics,
  classifyRedirectTargetNot200,
  rejectedHomepageRepoint,
  removeRedirectFromConfig,
  verifyLiveOriginResolvesCleanly,
  walkRedirectChain,
} from '@/lib/fix-strategies/redirect-chain'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const
