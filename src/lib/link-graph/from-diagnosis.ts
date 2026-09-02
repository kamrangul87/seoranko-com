/**
 * Build LinkGraphInput from an Index Diagnosis result (second reader — no second crawl).
 */

import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'
import { registrableHost } from './normalize'
import type { LinkGraphInput } from './types'

export function linkGraphInputFromDiagnosis(result: IndexDiagnosisResult): LinkGraphInput {
  return {
    seedUrl: result.coverage.seedUrl,
    siteHost: registrableHost(result.coverage.seedUrl) || result.coverage.domain,
    htmlByUrl: result.htmlByUrl || {},
    pages: result.pages.map((p) => ({
      url: p.url,
      httpStatus: p.httpStatus,
      crawlDepth: p.crawlDepth,
      verdict: p.verdict,
      steps: p.steps.map((s) => ({ step: s.step, passed: s.passed, evidence: s.evidence })),
    })),
    sitemapUrls: result.coverage.sitemapDiscoveredUrls || [],
    robotsTxt: result.robotsTxt || '',
  }
}
