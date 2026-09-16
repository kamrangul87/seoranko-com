export { extractSitemapLocs, removeSitemapLoc, replaceSitemapLoc } from './parse-sitemap'
export {
  detectSitemapNotIndexable,
} from './detect'
export type {
  DetectTopic26Result,
  SitemapArtefactContext,
  Topic26Finding,
  Topic26Verdict,
} from './detect'
export { planSitemapFixes } from './fix-sitemap-entry'
export type { Topic26FixPlan } from './fix-sitemap-entry'
export { verifyLiveSitemapIndexable } from './verify-live-sitemap'
export type { LiveSitemapVerification } from './verify-live-sitemap'
