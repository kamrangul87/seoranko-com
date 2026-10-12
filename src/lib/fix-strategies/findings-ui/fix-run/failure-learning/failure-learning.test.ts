import { describe, expect, it } from 'vitest'
import { canOfferFix } from '../../buckets'
import { whyFindingNotAutoFixed } from '../../owner-copy'
import {
  buildFailureEvidence,
  evidenceContainsBodyText,
  sanitiseHtmlSnippet,
} from './evidence'
import {
  buildFailureSignature,
  normaliseFailureReason,
  signatureHash,
} from './signature'
import { shouldPauseFixType } from './circuit-breaker'

describe('failure signature normalisation', () => {
  it('groups two failures with different ids and URLs', () => {
    const a = buildFailureSignature({
      topic: '49',
      verdict: 'auto-set-dimensions',
      stage: 'apply',
      reason:
        'Transform failed for finding 5cd1e6a9-9a7c-4f39-82dd-d5a563ec2e09 at https://example.com/blog/post.html status 500',
    })
    const b = buildFailureSignature({
      topic: '49',
      verdict: 'auto-set-dimensions',
      stage: 'apply',
      reason:
        'Transform failed for finding aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee at https://other.test/x status 404',
    })
    expect(a).toBe(b)
    expect(signatureHash(a)).toBe(signatureHash(b))
    expect(normaliseFailureReason('id 123 and url https://a.com/1')).toBe(
      'id <n> and url <url>',
    )
  })
})

describe('circuit breaker', () => {
  it('pauses after 2 distinct sites', () => {
    expect(
      shouldPauseFixType({ distinctSiteCount: 2, consecutiveFailures: 1 }),
    ).toMatchObject({ pause: true })
  })

  it('pauses after 2 consecutive failures', () => {
    expect(
      shouldPauseFixType({ distinctSiteCount: 1, consecutiveFailures: 2 }),
    ).toMatchObject({ pause: true })
  })

  it('does not pause below thresholds', () => {
    expect(
      shouldPauseFixType({ distinctSiteCount: 1, consecutiveFailures: 1 }),
    ).toMatchObject({ pause: false })
  })

  it('paused type is not offered via canOfferFix', () => {
    expect(canOfferFix('auto-fixable')).toBe(true)
    expect(canOfferFix('auto-fixable', { paused: true })).toBe(false)
    expect(
      whyFindingNotAutoFixed({
        autoFixable: true,
        reportOnly: false,
        surfaceClass: 'auto-fixable',
        fixTypePaused: true,
      }),
    ).toBe('Automatic fix paused while we fix a problem with it.')
  })
})

describe('evidence sanitisation', () => {
  it('never retains body text in snippets', () => {
    const html = `
      <html><body>
        <h1>Buy our electric chargers today in London</h1>
        <p>This long sentence about MOT costs and ULEZ fees must not leak.</p>
        <img src="/a.jpg" width="10" height="10" alt="hero image with words">
      </body></html>
    `
    const snip = sanitiseHtmlSnippet(html)
    expect(snip).not.toMatch(/electric chargers/i)
    expect(snip).not.toMatch(/MOT costs/i)
    expect(snip).toMatch(/<img/i)
    const evidence = buildFailureEvidence({
      reason: 'preview verify failed',
      htmlSnippet: html,
      url: 'https://example.com/page',
      httpStatus: 200,
      filePath: 'index.html',
    })
    expect(evidenceContainsBodyText(evidence)).toBe(false)
    expect(Buffer.byteLength(evidence.snippet || '', 'utf8')).toBeLessThanOrEqual(
      2048,
    )
  })
})
