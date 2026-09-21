export {
  classifyDeclarationSite,
  isCollapsibleDeclarationSite,
} from './declaration-site'
export type { DeclarationSiteKind } from './declaration-site'

export {
  rollupFindingsByDeclarationSite,
} from './finding-rollup'
export type {
  RollupFindingInput,
  RolledUpFinding,
} from './finding-rollup'

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
  RobotsSitemapRecord,
} from './robots-txt-inspect'

export {
  extractSitemapLocs,
  removeSitemapLoc,
  replaceSitemapLoc,
  parseSitemapXml,
  extractSitemapHreflangLinks,
  ensureSitemapNamespace,
  stripChangefreqAndPriority,
  escapeXmlText,
  isAbsoluteHttpLoc,
  absolutizeLoc,
  SITEMAP_NAMESPACE,
  SITEMAP_MAX_URLS,
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_LOC_CHARS,
} from './sitemap-xml'
export type {
  ParsedSitemapXml,
  SitemapUrlEntry,
  SitemapIndexEntry,
  SitemapKind,
  SitemapHreflangLink,
} from './sitemap-xml'

export {
  inspectSiteSitemaps,
  buildSitemapInspection,
  documentFromBody,
  robotsInspectionFromBody,
  declarationsFromRobots,
} from './sitemap-inspect'
export type {
  SitemapInspection,
  SitemapDocument,
  SitemapDeclaration,
  SitemapFetchOutcome,
  InspectSiteSitemapsOptions,
} from './sitemap-inspect'

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

export { inspectDocumentHead, normalizeMetaText } from './head-inspect'
export type {
  HeadInspection,
  HeadCasualty,
  HeadCasualtyKind,
  PrematureHeadClose,
  TitleRecord,
  DescriptionRecord,
  InLanguageRecord,
} from './head-inspect'

export { isValidBcp47, isIso6391, bcp47TagsCompatible } from './bcp47'

export {
  extractHtmlCanonical,
  hasNoindexDirective,
  isSelfCanonical,
} from './response-signals'

export {
  extractStructuredData,
  collectUrlProperties,
  getProp,
  hasNonEmptyProp,
} from './structured-data-extract'
export type {
  StructuredDataExtraction,
  StructuredDataNode,
  StructuredDataFormat,
  JsonLdParseFailure,
} from './structured-data-extract'

export {
  STRUCTURED_DATA_REQUIREMENT_TABLE,
  lookupRequirement,
  ARTICLE_IMAGE_MIN_PIXELS,
} from './structured-data-requirement-table'
export type {
  FeatureRequirementEntry,
  RequirementProperty,
} from './structured-data-requirement-table'

export {
  STRUCTURED_DATA_DEPRECATION_TABLE,
  lookupDeprecation,
} from './structured-data-deprecation-table'
export type { DeprecationEntry } from './structured-data-deprecation-table'

export {
  SCHEMA_ORG_VOCAB_SNAPSHOT,
  classifyTypeName,
  isKnownSchemaOrgType,
  isPropertyValidForType,
  propertiesForType,
  suggestTypeSpelling,
} from './schema-org-vocabulary'

export {
  extractCanonicalDeclarations,
  extractLinkHeaderCanonicals,
  distinctNormalizedTargets,
  splitLinkHeader,
} from './canonical-extraction'
export type {
  CanonicalDeclaration,
  CanonicalExtraction,
  CanonicalLocation,
} from './canonical-extraction'

export {
  collectHreflangAnnotations,
  collectSitemapHreflangAnnotations,
  extractLinkHeaderHreflang,
  hreflangKey,
  localeTargetMap,
  declaresReturnTo,
} from './hreflang-inspect'
export type {
  HreflangInspection,
  HreflangAnnotation,
  HreflangMethod,
  HreflangPageInput,
  PageHreflangRecord,
  CollectHreflangOptions,
} from './hreflang-inspect'

export {
  HREFLANG_ISO_SNAPSHOT_META,
  ISO_639_1_CODES,
  ISO_3166_1_ALPHA2_CODES,
  ISO_15924_SCRIPT_CODES,
  GOOGLE_HREFLANG_EXCLUSIONS,
  isoTablesAreDated,
  validateGoogleHreflangCode,
} from './hreflang-iso-tables'
export type {
  HreflangIsoSnapshotMeta,
  GoogleHreflangExclusion,
  HreflangCodeValidation,
  HreflangCodeOk,
  HreflangCodeFail,
} from './hreflang-iso-tables'

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

export {
  buildInternalLinkGraph,
  extractPageLinkSignals,
  recordNonCrawlableInbound,
} from './internal-link-graph'
export type {
  InternalLinkGraph,
  LinkGraphNode,
  LinkGraphEdge,
  LinkGraphPageInput,
  RenderedLinkEdge,
  BuildLinkGraphOptions,
} from './internal-link-graph'
