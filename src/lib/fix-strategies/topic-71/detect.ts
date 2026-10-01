/**
 * Topic 71 — Paginated series misconfiguration.
 * Sourced: Google pagination best practices (P1) — self-canonical per page;
 * no fragment page numbers; crawlable sequential <a href>; rel=next/prev not
 * required (Google no longer uses them).
 */

import { extractHtmlCanonical } from '@/lib/fix-strategies/shared/response-signals'
import {
  crawlablePaginationHrefs,
  extractRelPaginationLinks,
  hasFragmentOnlyPaginationLinks,
  hasNoncrawlableNextWithoutHref,
  isCanonicalToSeriesPageOne,
  isPaginatedUrl,
  parsePaginationFromUrl,
} from '@/lib/fix-strategies/shared/pagination'

export type Topic71Verdict =
  | 'page-canonical-to-series-first'
  | 'fragment-only-pagination'
  | 'noncrawlable-next-without-href'
  | 'informational-rel-next-prev-unused-by-google'

export type Topic71Finding = {
  verdict: Topic71Verdict
  pageUrl: string
  detail: string
  severity: 'moderate' | 'low' | null
  autoFixable: false
  evidenceValues: Record<string, unknown>
}

export type DetectTopic71Result = {
  findings: Topic71Finding[]
  informational: Topic71Finding[]
  suppressed: Array<{ pageUrl: string; reason: string }>
  ok: Array<{ pageUrl: string; verdict: string }>
}

export type Topic71PageInput = {
  url: string
  html: string
  status: number | null
}

export type DetectTopic71Options = {
  pages: Topic71PageInput[]
}

export function detectPaginationSeriesIssues(
  opts: DetectTopic71Options,
): DetectTopic71Result {
  const findings: Topic71Finding[] = []
  const informational: Topic71Finding[] = []
  const suppressed: Array<{ pageUrl: string; reason: string }> = []
  const ok: Array<{ pageUrl: string; verdict: string }> = []

  for (const p of opts.pages) {
    if (p.status != null && (p.status < 200 || p.status >= 400)) {
      suppressed.push({ pageUrl: p.url, reason: 'non_200' })
      continue
    }

    const sig = parsePaginationFromUrl(p.url)
    const canon = extractHtmlCanonical(p.html, p.url, 'text/html')

    // --- Finding: page ≥2 canonicalises to series page 1 (P1 / P3) ---
    if (
      sig &&
      sig.pageNumber != null &&
      sig.pageNumber >= 2 &&
      canon &&
      isCanonicalToSeriesPageOne(p.url, canon)
    ) {
      findings.push({
        verdict: 'page-canonical-to-series-first',
        pageUrl: p.url,
        severity: 'moderate',
        autoFixable: false,
        detail:
          `This paginated URL (page ${sig.pageNumber}) declares a canonical pointing at ` +
          `the first page of the series (${canon}). Google documents that each page in a ` +
          `paginated sequence should have its own canonical — not the first page. ` +
          `Report-only; choosing self-canonical vs a true view-all page is site-specific.`,
        evidenceValues: {
          pageNumber: sig.pageNumber,
          seriesKey: sig.seriesKey,
          declaredCanonical: canon,
          sourced: 'pagination-self-canonical',
          autoFixable: false,
        },
      })
    } else if (sig && sig.pageNumber != null && sig.pageNumber >= 2) {
      ok.push({ pageUrl: p.url, verdict: 'paginated_page_canonical_ok_or_absent' })
    }

    // --- Finding: fragment-only pagination links (P1) ---
    if (hasFragmentOnlyPaginationLinks(p.html)) {
      findings.push({
        verdict: 'fragment-only-pagination',
        pageUrl: p.url,
        severity: 'moderate',
        autoFixable: false,
        detail:
          `Pagination controls use fragment identifiers (#…) for page numbers. ` +
          `Google ignores fragments when deciding whether a URL is a distinct page, ` +
          `so later “pages” may never be crawled as separate URLs. Report-only — ` +
          `needs distinct crawlable URLs (e.g. ?page=n).`,
        evidenceValues: {
          sourced: 'pagination-no-fragments',
          autoFixable: false,
        },
      })
    }

    // --- Finding: non-crawlable next without <a href> (P1 / P2) ---
    if (hasNoncrawlableNextWithoutHref(p.html, p.url)) {
      findings.push({
        verdict: 'noncrawlable-next-without-href',
        pageUrl: p.url,
        severity: 'moderate',
        autoFixable: false,
        detail:
          `A next/paginated target is signalled (rel=next or data-* / onclick URL) but ` +
          `there is no crawlable <a href> to a page≥2 URL. Googlebot does not click ` +
          `buttons or trigger user-action JS. Report-only unless a deterministic ` +
          `<a href> conversion is later proven.`,
        evidenceValues: {
          relNext: extractRelPaginationLinks(p.html, p.url).nextHref,
          crawlablePage2Hrefs: crawlablePaginationHrefs(p.html, p.url),
          sourced: 'pagination-crawlable-href',
          autoFixable: false,
        },
      })
    }

    // --- Informational only: rel=next/prev present — Google unused (P1) ---
    const rel = extractRelPaginationLinks(p.html, p.url)
    if (rel.nextHref || rel.prevHref) {
      informational.push({
        verdict: 'informational-rel-next-prev-unused-by-google',
        pageUrl: p.url,
        severity: null,
        autoFixable: false,
        detail:
          `Page declares link rel=next and/or rel=prev. Google’s current pagination ` +
          `documentation states it no longer uses these tags (other engines may). ` +
          `Absence is never a finding; presence is awareness-only.`,
        evidenceValues: {
          nextHref: rel.nextHref,
          prevHref: rel.prevHref,
          googleUsesRelNextPrev: false,
          neverRequireRelNextPrev: true,
        },
      })
    }

    if (!sig && !isPaginatedUrl(p.url) && findings.every((f) => f.pageUrl !== p.url)) {
      // no-op bookkeeping for non-paginated pages without issues
    }
  }

  return { findings, informational, suppressed, ok }
}
