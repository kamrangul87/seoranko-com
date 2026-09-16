/** Topic 5 — redirect loops and self-redirects / missing Location. */
export {
  detectRedirectTopics,
  classifyRedirectLoop,
  isTrailingSlashBounceOnly,
  verifyLiveOriginResolvesCleanly,
  walkRedirectChain,
} from '@/lib/fix-strategies/redirect-chain'
