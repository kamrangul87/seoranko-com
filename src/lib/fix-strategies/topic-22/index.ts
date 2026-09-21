export { detectRobotsTxtIssues, classifyRobotsTxtInspection } from './detect'
export type {
  DetectTopic22Options,
  DetectTopic22Result,
  Topic22Finding,
  Topic22Verdict,
} from './detect'

export {
  removeCrawlDelayLines,
  proposeTextPlainHeader,
  rejectedDisallowEdit,
  rejectedCreateRobotsTxt,
} from './fix-robots-txt'

export { verifyLiveRobotsTxt } from './verify-live'
export type { LiveRobotsTxtVerification } from './verify-live'

export {
  fetchAndInspectRobotsTxt,
  inspectRobotsTxtBody,
  isPathAllowedFromInspection,
} from '@/lib/fix-strategies/shared/robots-txt-inspect'
export type { RobotsTxtInspection } from '@/lib/fix-strategies/shared/robots-txt-inspect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const
