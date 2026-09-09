/**
 * Mechanical verification contract for every existing Fix Agent strategy kind.
 * No new strategies — documentation + assertions only (PRODUCT_MODEL Phase 2B).
 */

import type { AutoFixKind } from './fix-agent-classification'

export type StrategyVerificationContract = {
  kind: AutoFixKind
  beforeStateExtractor: string
  intendedStateHash: string
  liveAfterStateExtractor: string
  mechanicalAssertion: string
  failureReasonField: string
  rollbackOrHandoff: string
  /** HTML-only verifyLiveHtml is insufficient; dedicated live fetch required */
  requiresDedicatedLiveFetch: boolean
}

export const STRATEGY_VERIFICATION_CONTRACTS: StrategyVerificationContract[] = [
  {
    kind: 'meta-title',
    beforeStateExtractor: 'Crawl page.title / <title> text',
    intendedStateHash: 'SHA of target title string written by strategy',
    liveAfterStateExtractor: 'GET page HTML → <title> text length ≥ 10',
    mechanicalAssertion: 'verifyLiveHtml(meta-title)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'Leave unverified; human reverts commit if needed',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'meta-description',
    beforeStateExtractor: 'Crawl meta description presence',
    intendedStateHash: 'SHA of injected description',
    liveAfterStateExtractor: 'GET HTML → meta name=description present',
    mechanicalAssertion: 'verifyLiveHtml(meta-description)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified until live match',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'missing-h1',
    beforeStateExtractor: 'Crawl <h1> presence',
    intendedStateHash: 'SHA of inserted H1 text',
    liveAfterStateExtractor: 'GET HTML → <h1 present',
    mechanicalAssertion: 'verifyLiveHtml(missing-h1)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified; human template review',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'lang-attribute',
    beforeStateExtractor: 'Crawl <html lang>',
    intendedStateHash: 'lang hint string',
    liveAfterStateExtractor: 'GET HTML → html[lang]',
    mechanicalAssertion: 'verifyLiveHtml(lang-attribute)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'image-alt',
    beforeStateExtractor: 'Crawl imgs missing alt',
    intendedStateHash: 'filename-derived alt map',
    liveAfterStateExtractor: 'GET HTML → no img without alt',
    mechanicalAssertion: 'verifyLiveHtml(image-alt)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'html-structure',
    beforeStateExtractor: 'Crawl stray html/head/body wrappers',
    intendedStateHash: 'normalized fragment hash',
    liveAfterStateExtractor: 'GET HTML structural heuristic',
    mechanicalAssertion: 'verifyLiveHtml(html-structure)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified; human review-required risk',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'schema-organization',
    beforeStateExtractor: 'validateSchema schemasFound',
    intendedStateHash: 'Organization JSON-LD payload hash',
    liveAfterStateExtractor: 'GET HTML → schemasFound includes Organization',
    mechanicalAssertion: 'verifyLiveHtml(schema-organization)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified until schema type present live',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'schema-article',
    beforeStateExtractor: 'validateSchema schemasFound',
    intendedStateHash: 'Article JSON-LD payload hash',
    liveAfterStateExtractor: 'GET HTML → schemasFound includes Article',
    mechanicalAssertion: 'verifyLiveHtml(schema-article)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'schema-product',
    beforeStateExtractor: 'validateSchema schemasFound',
    intendedStateHash: 'Product JSON-LD payload hash',
    liveAfterStateExtractor: 'GET HTML → schemasFound includes Product',
    mechanicalAssertion: 'verifyLiveHtml(schema-product)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'schema-breadcrumb',
    beforeStateExtractor: 'validateSchema schemasFound',
    intendedStateHash: 'BreadcrumbList JSON-LD payload hash',
    liveAfterStateExtractor: 'GET HTML → schemasFound includes BreadcrumbList',
    mechanicalAssertion: 'verifyLiveHtml(schema-breadcrumb)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'llms-txt',
    beforeStateExtractor: 'HEAD/GET {origin}/llms.txt before write',
    intendedStateHash: 'SHA of written llms.txt body',
    liveAfterStateExtractor: 'GET {origin}/llms.txt body length ≥ 8',
    mechanicalAssertion: 'verifyLlmsTxtLive — never HTML-only',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'Delete file via human/GitHub if bad; stay unverified on 404',
    requiresDedicatedLiveFetch: true,
  },
  {
    kind: 'security-headers',
    beforeStateExtractor: 'Response headers on seed URL before write',
    intendedStateHash: 'Immediate header key/value set hash',
    liveAfterStateExtractor: 'GET response headers X-Frame-Options + X-Content-Type-Options',
    mechanicalAssertion: 'verifySecurityHeadersLive — never HTML-only',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'Revert next.config/headers commit; stay unverified if CDN lag',
    requiresDedicatedLiveFetch: true,
  },
  {
    kind: 'redirect-canonical',
    beforeStateExtractor: 'HTTP follow of source URL',
    intendedStateHash: 'target URL + status class',
    liveAfterStateExtractor: 'HTTP follow redirect chain to target',
    mechanicalAssertion: 'verifyRedirectLive',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'Revert next.config redirect; unverified until live match',
    requiresDedicatedLiveFetch: true,
  },
  {
    kind: 'rewrite-link-href',
    beforeStateExtractor: 'Source page href list for fromHref',
    intendedStateHash: 'fromHref→toHref map hash',
    liveAfterStateExtractor: 'GET source HTML → href rewritten',
    mechanicalAssertion: 'verifyLiveHtml(rewrite-link-href)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified; connection required for cross-host',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'remove-dead-link',
    beforeStateExtractor: 'Source page contains deadUrl href',
    intendedStateHash: 'deadUrl removed marker',
    liveAfterStateExtractor: 'GET source HTML → deadUrl absent',
    mechanicalAssertion: 'verifyLiveHtml(remove-dead-link)',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified until live HTML clean',
    requiresDedicatedLiveFetch: false,
  },
  {
    kind: 'sitemap-regenerate',
    beforeStateExtractor: 'GET /sitemap.xml before',
    intendedStateHash: 'urlset body hash',
    liveAfterStateExtractor: 'GET /sitemap.xml → urlset+loc',
    mechanicalAssertion: 'verifyLiveHtml(sitemap-regenerate) on sitemap URL',
    failureReasonField: 'attempt.error / verification detail',
    rollbackOrHandoff: 'unverified until deploy serves sitemap',
    requiresDedicatedLiveFetch: false,
  },
]

export function contractForKind(kind: AutoFixKind): StrategyVerificationContract | undefined {
  return STRATEGY_VERIFICATION_CONTRACTS.find((c) => c.kind === kind)
}
