export {
  detectLinksThroughRedirects,
} from './detect'
export type {
  DetectTopic42Options,
  DetectTopic42Result,
  SourcePage,
  Topic42Finding,
} from './detect'

export {
  classifyRedirectLink,
  looksLikeLocaleRedirect,
  redirectHopCount,
  severityForHopCount,
} from './classify-redirect'
export type {
  ClassifyRedirectResult,
  RedirectSeverity,
  Topic42Verdict,
} from './classify-redirect'

export { rewriteAnchorHref } from './fix-rewrite-href'
export { verifyLiveHrefRewritten } from './verify-live-href'
export type { LiveHrefRewriteVerification } from './verify-live-href'

export { resolveHrefDeclaration } from './resolve-declaration'
export type {
  DeclarationKind,
  HrefDeclaration,
} from './resolve-declaration'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const
