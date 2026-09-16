export { recordRedirectHops, normalizeHopUrl } from './hop-recording-fetch'
export type {
  RedirectHop,
  HopRecordingResult,
  HopRecordingDeps,
  HopRecordingOptions,
  HopStoppedReason,
} from './hop-recording-fetch'

export { normalizeFixStrategyUrl, preserveQueryAndFragment, wouldDropQueryOrFragment } from './url-normalize'

export { normalizeCanonicalForGscMatch } from './canonical-normalize'

export {
  isPathAllowed,
  parseRobotsTxt,
  robotsPathMatches,
  ROBOTS_TXT_MAX_BYTES,
} from './robots-txt-matcher'
export type { PathAllowedResult } from './robots-txt-matcher'

export {
  expandRobotsDirectives,
  extractPageRobotsDirectives,
  effectiveRobotsTokens,
  setHasNoindex,
  tokenSetsEqual,
} from './robots-directives'
export type {
  PageRobotsDirectives,
  RobotsDirectiveSet,
} from './robots-directives'

export {
  fetchAndInspectRobotsTxt,
  inspectRobotsTxtBody,
  isPathAllowedFromInspection,
} from './robots-txt-inspect'
export type {
  RobotsTxtInspection,
  RobotsTxtFetchStatus,
} from './robots-txt-inspect'

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

export {
  extractHtmlCanonical,
  hasNoindexDirective,
  isSelfCanonical,
} from './response-signals'

export {
  extractCanonicalDeclarations,
  extractLinkHeaderCanonicals,
  distinctNormalizedTargets,
} from './canonical-extraction'
export type {
  CanonicalDeclaration,
  CanonicalExtraction,
  CanonicalLocation,
} from './canonical-extraction'

export { resolveHeaderCanonicalScope } from './header-canonical-scope'
export type { HeaderCanonicalScope } from './header-canonical-scope'

export {
  resolveCanonicalRepoSites,
  findAllCanonicalDeclarationFiles,
  resolvePageFileForPath,
} from './canonical-declaration-sites'
export type {
  CanonicalRepoSite,
  CanonicalRepoSiteKind,
} from './canonical-declaration-sites'

export {
  generateVariant,
  isSiteRootUrl,
} from './duplicate-url-variants'
export type {
  DuplicateUrlStrategy,
  VariantPair,
} from './duplicate-url-variants'

export {
  proveContentSameness,
  normalizeMainContent,
  sha256Hex,
} from './content-sameness'
export type { ContentSamenessResult } from './content-sameness'

export {
  derivePreferredForm,
  httpsPreferred,
} from './preferred-form'
export type {
  PreferredFormResult,
  PreferredFormSignals,
} from './preferred-form'

export {
  fetchImageHeaderBytes,
  readImageIntrinsicSize,
  IMAGE_HEADER_PROBE_BYTES,
} from './image-intrinsic-size'
export type { IntrinsicSize } from './image-intrinsic-size'
