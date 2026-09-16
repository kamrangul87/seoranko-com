export { recordRedirectHops } from './hop-recording-fetch'
export type {
  RedirectHop,
  HopRecordingResult,
  HopRecordingDeps,
  HopRecordingOptions,
} from './hop-recording-fetch'

export { normalizeFixStrategyUrl } from './url-normalize'

export { normalizeCanonicalForGscMatch } from './canonical-normalize'

export {
  isPathAllowed,
  parseRobotsTxt,
  robotsPathMatches,
  ROBOTS_TXT_MAX_BYTES,
} from './robots-txt-matcher'
export type { PathAllowedResult } from './robots-txt-matcher'

export {
  checkRepoDeclaredNoindex,
  declaresNoindex,
  inspectNoindexSource,
} from './repo-declared-noindex'
export type { NoindexDeclaration } from './repo-declared-noindex'

export { resolveFixTarget } from './generated-output-guard'
export type {
  FixTargetAction,
  FixTargetResult,
  ResolveFixTargetOptions,
} from './generated-output-guard'

export { parseHtml } from './html-parser'
export type { HtmlElement, ParsedHtml } from './html-parser'
