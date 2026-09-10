/**
 * Hardcoded plain-English templates for public Index Diagnosis causes.
 * No LLM — keyed by PublicExclusionReason.
 */

import type { PublicExclusionReason } from './types'

type TemplateFn = (count: number, exampleUrl: string) => { headline: string; explanation: string }

const TEMPLATES: Record<PublicExclusionReason, TemplateFn> = {
  INDEXABLE: (count, exampleUrl) => ({
    headline: `${count} page${count === 1 ? '' : 's'} look crawlable`,
    explanation: `${count} URL${count === 1 ? '' : 's'} passed every mechanical indexability check in this crawl (example: ${exampleUrl}). That does not guarantee Google will index them — only that our crawler found no hard block.`,
  }),
  BLOCKED_BY_ROBOTS: (count, exampleUrl) => ({
    headline: `robots.txt blocks ${count} URL${count === 1 ? '' : 's'}`,
    explanation: `${count} URL${count === 1 ? ' is' : 's are'} disallowed by a robots.txt rule, so crawlers that respect robots.txt will not fetch ${count === 1 ? 'it' : 'them'}. Example: ${exampleUrl}. Fix the Disallow rule or remove it for pages you want indexed.`,
  }),
  NOINDEX_TAG: (count, exampleUrl) => ({
    headline: `${count} page${count === 1 ? ' has' : 's have'} a noindex meta tag`,
    explanation: `${count} URL${count === 1 ? '' : 's'} include a meta robots noindex directive, which tells search engines not to index the page. Example: ${exampleUrl}. Remove noindex when the page should appear in Google.`,
  }),
  NOINDEX_HEADER: (count, exampleUrl) => ({
    headline: `${count} page${count === 1 ? '' : 's'} send X-Robots-Tag: noindex`,
    explanation: `${count} URL${count === 1 ? '' : 's'} return an HTTP X-Robots-Tag header with noindex. Example: ${exampleUrl}. Adjust server or CDN headers if these pages should be indexable.`,
  }),
  CANONICAL_POINTS_ELSEWHERE: (count, exampleUrl) => ({
    headline: `${count} page${count === 1 ? '' : 's'} canonicalize away`,
    explanation: `${count} URL${count === 1 ? ' declares' : 's declare'} a canonical target that is not self-referencing, so Google may consolidate indexing to another URL. Example: ${exampleUrl}. Use a self-canonical when this URL should be the indexed version.`,
  }),
  REDIRECT_CHAIN: (count, exampleUrl) => ({
    headline: `${count} URL${count === 1 ? '' : 's'} hit a redirect chain limit`,
    explanation: `${count} URL${count === 1 ? '' : 's'} exceeded the redirect hop limit during the crawl, so the final page was not reliably fetched. Example: ${exampleUrl}. Shorten redirect chains to a single hop where possible.`,
  }),
  HTTP_4XX: (count, exampleUrl) => ({
    headline: `${count} URL${count === 1 ? ' returns' : 's return'} a 4xx status`,
    explanation: `${count} URL${count === 1 ? '' : 's'} responded with a client error (4xx). Example: ${exampleUrl}. Restore a 200 response or remove links to dead URLs.`,
  }),
  HTTP_5XX: (count, exampleUrl) => ({
    headline: `${count} URL${count === 1 ? ' returns' : 's return'} a 5xx status`,
    explanation: `${count} URL${count === 1 ? '' : 's'} responded with a server error (5xx). Example: ${exampleUrl}. Fix the server/application error before expecting indexing.`,
  }),
  SOFT_404_SUSPECTED: (count, exampleUrl) => ({
    headline: `${count} soft-404 suspect${count === 1 ? '' : 's'}`,
    explanation: `${count} URL${count === 1 ? '' : 's'} returned HTTP 200 but look like error/empty pages (title/body signals). Example: ${exampleUrl}. Return a real 404 or publish real content on these URLs.`,
  }),
  ORPHAN_NO_INLINKS: (count, exampleUrl) => ({
    headline: `${count} orphan page${count === 1 ? '' : 's'} (no internal links in)`,
    explanation: `${count} URL${count === 1 ? ' has' : 's have'} zero internal inlinks in the crawled set (excluding the homepage). Example: ${exampleUrl}. Add internal links from important pages so crawlers can discover them.`,
  }),
  DEPTH_EXCEEDS_5: (count, exampleUrl) => ({
    headline: `${count} page${count === 1 ? ' is' : 's are'} deeper than 5 clicks`,
    explanation: `${count} URL${count === 1 ? ' sits' : 's sit'} more than 5 clicks from the homepage in this crawl. Example: ${exampleUrl}. Bring important URLs closer to the homepage with shallower internal links.`,
  }),
  NEAR_DUPLICATE: (count, exampleUrl) => ({
    headline: `${count} near-duplicate page${count === 1 ? '' : 's'}`,
    explanation: `${count} URL${count === 1 ? '' : 's'} share highly similar main content (Jaccard ≥ 0.85 after stripping nav/header/footer). Example: ${exampleUrl}. Consolidate duplicates with canonicals or unique content.`,
  }),
  THIN_CONTENT: (count, exampleUrl) => ({
    headline: `${count} thin page${count === 1 ? '' : 's'} (< 200 words)`,
    explanation: `${count} URL${count === 1 ? ' has' : 's have'} fewer than 200 words of main content. Example: ${exampleUrl}. Expand substantive content or noindex pages that should not rank.`,
  }),
}

export function explainPublicCause(
  reason: PublicExclusionReason,
  affectedUrlCount: number,
  exampleUrl: string,
): { headline: string; explanation: string } {
  return TEMPLATES[reason](affectedUrlCount, exampleUrl)
}
