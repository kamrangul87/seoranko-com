/** Topic 4 — redirect chains. */
export {
  detectRedirectTopics,
  classifyRedirectChain,
  severityForChainHops,
  collapseRedirectInConfig,
  verifyLiveChainCollapsed,
  walkRedirectChain,
} from '@/lib/fix-strategies/redirect-chain'
