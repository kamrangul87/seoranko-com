export {
  countCrawlableAnchors,
  isHomepageUrl,
} from './count-crawlable-anchors'
export { detectZeroRawCrawlableAnchors } from './detect'
export type {
  DetectTopic73Options,
  DetectTopic73Page,
  DetectTopic73Result,
  Topic73Finding,
  Topic73Verdict,
} from './detect'

export const DETECTOR_SCOPE = 'per-page' as const
