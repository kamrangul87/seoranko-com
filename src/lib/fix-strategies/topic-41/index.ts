export { detectFaqSchemaMissing } from './detect'
export type {
  DetectTopic41Result,
  Topic41Finding,
  Topic41Verdict,
} from './detect'

/** Per-page detector */
export const DETECTOR_SCOPE = 'per-page' as const

