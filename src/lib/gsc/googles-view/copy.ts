import type { GooglesViewReasonKind } from './types'

export function reasonRowWhatToDo(opts: {
  kind: GooglesViewReasonKind
  problem: boolean
  coverageState: string
}): string {
  const { kind, problem } = opts
  if (kind === 'page_with_redirect') {
    return problem
      ? 'Fix redirect issues (sitemap, internal links, chains, or final status). See related topics.'
      : 'These are old addresses that correctly point to your real pages. Google indexes the destination. No action needed.'
  }
  if (kind === 'alternate_canonical') {
    return problem
      ? 'The declared canonical target is unhealthy or not self-canonical — fix the canonical tag or the target page.'
      : 'These URLs correctly declare another page as canonical. Google indexes the canonical. No action needed.'
  }
  if (kind === 'not_found_404') {
    return problem
      ? 'Remove the URL from the sitemap and/or fix internal links pointing at it (topics 26 / 1).'
      : 'Google recorded a 404. The URL is not a live indexing problem for your site. No action needed.'
  }
  if (kind === 'crawled_not_indexed' || kind === 'discovered_not_indexed') {
    return "Google's choice, not a technical error. Improve depth, internal links, and uniqueness where Index Diagnosis shows signals — never promise indexing."
  }
  return problem
    ? `Review URLs with coverage state “${opts.coverageState}”.`
    : `Google reports “${opts.coverageState}”. Review the expanded URLs if unsure.`
}

export const GOOGLES_VIEW_FRAMING =
  "Google's view of why pages are not indexed — healthy rows are informational; only Problem? = Yes needs action."
