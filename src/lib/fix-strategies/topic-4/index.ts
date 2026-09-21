/** Topic 4 — redirect chains. */
export {
  detectRedirectTopics,
  classifyRedirectChain,
  severityForChainHops,
  collapseRedirectInConfig,
  verifyLiveChainCollapsed,
  walkRedirectChain,
} from '@/lib/fix-strategies/redirect-chain'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const
