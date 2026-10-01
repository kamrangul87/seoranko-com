export { detectPaginationSeriesIssues } from './detect'
export type {
  DetectTopic71Options,
  DetectTopic71Result,
  Topic71Finding,
  Topic71PageInput,
  Topic71Verdict,
} from './detect'

/** Whole-site: needs full crawl set to label series + cross-page guards. */
export const DETECTOR_SCOPE = 'whole-site' as const
