/**
 * Thin re-export so Stage 3 import paths keep working.
 * Prefer `detectBrokenInternalLinks` from `./detect`.
 */
export {
  detectGoneAnchors,
  type Finding410 as GoneAnchorFinding,
} from './detect'

export type Detect410Result = {
  findings: import('./detect').Finding410[]
  suppressed: Array<{ href: string; reason: string }>
}
