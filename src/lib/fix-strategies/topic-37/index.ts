export {
  detectInvalidOrMismatchedType,
  rejectedInferEntityKindFromName,
  rejectedGuessJsonLdRepair,
  repairTrailingCommas,
  ensureSchemaOrgContext,
} from './detect'
export type {
  DetectTopic37Options,
  DetectTopic37Result,
  Topic37Finding,
  Topic37Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const
