/** Topic 6 — 302 where 301 belongs. Always human-review. */
export {
  detectRedirectTopics,
  classifyTemporaryWherePermanent,
  proposePermanentStatusInConfig,
  verifyLivePermanentRedirect,
  walkRedirectChain,
} from '@/lib/fix-strategies/redirect-chain'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const
