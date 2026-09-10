/**
 * Hardcoded plain-English templates for public Index Diagnosis causes.
 * No LLM — keyed by PublicExclusionReason.
 *
 * Each template separates:
 * - explanation: what we observed (evidence-facing)
 * - action: one concrete instruction a person (or Fix Agent) could follow
 *
 * autoFixable marks reasons Fix Agent can apply mechanically after signup
 * (redirects, canonical redirects, dead-link removal). Editorial judgments
 * stay human-only — badge must not claim otherwise.
 */

import type { PublicExclusionReason } from './types'

export type PublicCauseCopy = {
  headline: string
  explanation: string
  /** Concrete "what to change" line — imperative, specific. */
  action: string
  /**
   * True when Fix Agent has a mechanical strategy for this finding type
   * (redirect-canonical, rewrite-link-href, remove-dead-link).
   * False for editorial / server-ops / robots judgment calls.
   */
  autoFixable: boolean
}

type TemplateFn = (count: number, exampleUrl: string) => PublicCauseCopy

/**
 * Public finding → Fix Agent mechanical coverage.
 * Keep conservative: only kinds with real strategies in fix-agent-classification.
 */
export const PUBLIC_REASON_AUTO_FIXABLE: Record<PublicExclusionReason, boolean> = {
  INDEXABLE: false,
  BLOCKED_BY_ROBOTS: false,
  NOINDEX_TAG: false,
  NOINDEX_HEADER: false,
  CANONICAL_POINTS_ELSEWHERE: true, // redirect-canonical
  REDIRECT_CHAIN: true, // rewrite intermediate hrefs / shorten chain
  HTTP_4XX: true, // remove-dead-link (links pointing here)
  HTTP_5XX: false,
  SOFT_404_SUSPECTED: false,
  ORPHAN_NO_INLINKS: false,
  DEPTH_EXCEEDS_5: false,
  NEAR_DUPLICATE: false,
  THIN_CONTENT: false,
}

const TEMPLATES: Record<PublicExclusionReason, TemplateFn> = {
  INDEXABLE: (count, exampleUrl) => ({
    headline: `${count} page${count === 1 ? '' : 's'} look crawlable`,
    explanation: `${count} URL${count === 1 ? '' : 's'} passed every mechanical indexability check in this crawl (example: ${exampleUrl}). That does not guarantee Google will index them — only that our crawler found no hard block.`,
    action: 'No mechanical block found — request indexing in Search Console if the URL is still missing.',
    autoFixable: false,
  }),
  BLOCKED_BY_ROBOTS: (count, exampleUrl) => ({
    headline: `robots.txt blocks ${count} URL${count === 1 ? '' : 's'}`,
    explanation: `${count} URL${count === 1 ? ' is' : 's are'} disallowed by a robots.txt rule, so crawlers that respect robots.txt will not fetch ${count === 1 ? 'it' : 'them'}. Example: ${exampleUrl}.`,
    action: 'Open robots.txt and delete or narrow the Disallow line that matches these paths.',
    autoFixable: false,
  }),
  NOINDEX_TAG: (count, exampleUrl) => ({
    headline: `${count} page${count === 1 ? ' has' : 's have'} a noindex meta tag`,
    explanation: `${count} URL${count === 1 ? '' : 's'} include a meta robots noindex directive, which tells search engines not to index the page. Example: ${exampleUrl}.`,
    action: 'In the page <head>, remove noindex from <meta name="robots"> (or set content="index,follow").',
    autoFixable: false,
  }),
  NOINDEX_HEADER: (count, exampleUrl) => ({
    headline: `${count} page${count === 1 ? '' : 's'} send X-Robots-Tag: noindex`,
    explanation: `${count} URL${count === 1 ? '' : 's'} return an HTTP X-Robots-Tag header with noindex. Example: ${exampleUrl}.`,
    action: 'In server or CDN config, remove noindex from the X-Robots-Tag response header for these URLs.',
    autoFixable: false,
  }),
  CANONICAL_POINTS_ELSEWHERE: (count, exampleUrl) => ({
    headline: `${count} page${count === 1 ? '' : 's'} canonicalize away`,
    explanation: `${count} URL${count === 1 ? ' declares' : 's declare'} a canonical target that is not self-referencing, so Google may consolidate indexing to another URL. Example: ${exampleUrl}.`,
    action:
      'Either set <link rel="canonical"> to this page\'s own URL, or add a single 301 redirect from this URL to the declared canonical.',
    autoFixable: true,
  }),
  REDIRECT_CHAIN: (count, exampleUrl) => ({
    headline: `${count} URL${count === 1 ? '' : 's'} hit a redirect chain limit`,
    explanation: `${count} URL${count === 1 ? '' : 's'} exceeded the redirect hop limit during the crawl, so the final page was not reliably fetched. Example: ${exampleUrl}.`,
    action: 'Replace the href with the final destination URL so the chain is one hop (or zero).',
    autoFixable: true,
  }),
  HTTP_4XX: (count, exampleUrl) => ({
    headline: `${count} URL${count === 1 ? ' returns' : 's return'} a 4xx status`,
    explanation: `${count} URL${count === 1 ? '' : 's'} responded with a client error (4xx). Example: ${exampleUrl}.`,
    action:
      'Restore a live 200 page at this URL, or remove every internal <a href> that still points to it.',
    autoFixable: true,
  }),
  HTTP_5XX: (count, exampleUrl) => ({
    headline: `${count} URL${count === 1 ? ' returns' : 's return'} a 5xx status`,
    explanation: `${count} URL${count === 1 ? '' : 's'} responded with a server error (5xx). Example: ${exampleUrl}.`,
    action: 'Fix the application or hosting error until these URLs return HTTP 200, then re-crawl.',
    autoFixable: false,
  }),
  SOFT_404_SUSPECTED: (count, exampleUrl) => ({
    headline: `${count} soft-404 suspect${count === 1 ? '' : 's'}`,
    explanation: `${count} URL${count === 1 ? '' : 's'} returned HTTP 200 but look like error/empty pages (title/body signals). Example: ${exampleUrl}.`,
    action: 'Return a real HTTP 404 for empty/error pages, or publish real main content and keep 200.',
    autoFixable: false,
  }),
  ORPHAN_NO_INLINKS: (count, exampleUrl) => ({
    headline: `${count} orphan page${count === 1 ? '' : 's'} (no internal links in)`,
    explanation: `${count} URL${count === 1 ? ' has' : 's have'} zero internal inlinks in the crawled set (excluding the homepage). Example: ${exampleUrl}.`,
    action: 'Add a contextual internal link to this URL from a related indexable page.',
    autoFixable: false,
  }),
  DEPTH_EXCEEDS_5: (count, exampleUrl) => ({
    headline: `${count} page${count === 1 ? ' is' : 's are'} deeper than 5 clicks`,
    explanation: `${count} URL${count === 1 ? ' sits' : 's sit'} more than 5 clicks from the homepage in this crawl. Example: ${exampleUrl}.`,
    action: 'Add a shallower internal link (or hub page) so this URL is within five clicks of the homepage.',
    autoFixable: false,
  }),
  NEAR_DUPLICATE: (count, exampleUrl) => ({
    headline: `${count} near-duplicate page${count === 1 ? '' : 's'}`,
    explanation: `${count} URL${count === 1 ? '' : 's'} share highly similar main content (Jaccard ≥ 0.85 after stripping nav/header/footer). Example: ${exampleUrl}.`,
    action:
      'Pick one URL as the canonical version; 301 the others to it, or rewrite each page so the main content is unique.',
    autoFixable: false,
  }),
  THIN_CONTENT: (count, exampleUrl) => ({
    headline: `${count} thin page${count === 1 ? '' : 's'} (< 200 words)`,
    explanation: `${count} URL${count === 1 ? ' has' : 's have'} fewer than 200 words of main content. Example: ${exampleUrl}.`,
    action:
      'Expand the main body to at least 200 words of unique substance, or add noindex if the page should not rank.',
    autoFixable: false,
  }),
}

export function explainPublicCause(
  reason: PublicExclusionReason,
  affectedUrlCount: number,
  exampleUrl: string,
): PublicCauseCopy {
  const copy = TEMPLATES[reason](affectedUrlCount, exampleUrl)
  return {
    ...copy,
    autoFixable: PUBLIC_REASON_AUTO_FIXABLE[reason],
  }
}

/** Short per-finding signup CTA — auto vs human wording stays honest. */
export function upgradeCtaForCause(autoFixable: boolean): string {
  return autoFixable
    ? 'Fix Agent can apply this automatically — create a free account'
    : 'Track and fix this in SEORANKO — create a free account'
}
