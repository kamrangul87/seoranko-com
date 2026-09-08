import { describe, expect, it } from 'vitest'
import { selectDiagnosisForLinkGraphRun } from './select-diagnosis'
import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'

function stubDiagnosis(label: string): IndexDiagnosisResult {
  return {
    coverage: {
      domain: 'example.com',
      seedUrl: 'https://example.com/',
      terminationEvidence: label,
    },
    pages: [{ url: 'https://example.com/', pageTitle: label }],
    verdictHeadline: label,
    htmlByUrl: { 'https://example.com/': `<a href="/${label}">x</a>` },
  } as unknown as IndexDiagnosisResult
}

describe('selectDiagnosisForLinkGraphRun', () => {
  it('uses fresh crawl for auditId=new and ignores stale body diagnosis', () => {
    const crawled = stubDiagnosis('fresh')
    const body = stubDiagnosis('stale')
    const picked = selectDiagnosisForLinkGraphRun({
      auditId: 'new',
      crawled,
      bodyDiagnosis: body,
    })
    expect(picked?.verdictHeadline).toBe('fresh')
    expect(picked?.htmlByUrl?.['https://example.com/']).toContain('/fresh')
  })

  it('uses fresh crawl when forceFresh even if body has htmlByUrl', () => {
    const crawled = stubDiagnosis('fresh')
    const body = stubDiagnosis('stale')
    const picked = selectDiagnosisForLinkGraphRun({
      auditId: 'some-saved-id',
      forceFresh: true,
      crawled,
      bodyDiagnosis: body,
    })
    expect(picked?.verdictHeadline).toBe('fresh')
  })

  it('may reuse body diagnosis when re-analysing a saved run without forceFresh', () => {
    const crawled = stubDiagnosis('fallback-crawl')
    const body = stubDiagnosis('client-live')
    const picked = selectDiagnosisForLinkGraphRun({
      auditId: 'saved-run-id',
      forceFresh: false,
      crawled,
      bodyDiagnosis: body,
    })
    expect(picked?.verdictHeadline).toBe('client-live')
  })
})
