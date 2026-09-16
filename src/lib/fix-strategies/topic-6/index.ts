/** Topic 6 — 302 where 301 belongs. Always human-review. */
export {
  detectRedirectTopics,
  classifyTemporaryWherePermanent,
  proposePermanentStatusInConfig,
  verifyLivePermanentRedirect,
  walkRedirectChain,
} from '@/lib/fix-strategies/redirect-chain'
