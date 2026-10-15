export {
  classifyOriginPrefixedHref,
  detectOriginPrefixedExternalHrefs,
  extractEmbeddedExternalFromPath,
} from './detect'
export type {
  DetectTopic74Result,
  Topic74Finding,
  Topic74Verdict,
} from './detect'
export { unwrapOriginPrefixedHref } from './fix-unwrap-href'

export const DETECTOR_SCOPE = 'per-page' as const
