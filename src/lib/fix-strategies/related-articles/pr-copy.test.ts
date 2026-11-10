import { describe, expect, it } from 'vitest'
import { relatedReadingPrBody, relatedReadingPrTitle } from './pr-copy'

describe('related reading PR copy', () => {
  it('titles a batch with the page count', () => {
    expect(relatedReadingPrTitle(1)).toBe(
      'SEORANKO: add related reading links (1 page)',
    )
    expect(relatedReadingPrTitle(12)).toBe(
      'SEORANKO: add related reading links (12 pages)',
    )
  })

  it('builds a source → target/anchor/reason table and never auto-merges', () => {
    const body = relatedReadingPrBody([
      {
        sourcePath: 'public/blog/mot-history-check-uk.html',
        sourceUrl: 'https://autodun.com/blog/mot-history-check-uk.html',
        targets: [
          {
            href: '/blog/mot-changes-2026-dvsa-updates.html',
            anchorText: 'MOT Changes 2026: DVSA Updates, New Rules',
            reason: 'Same-folder sibling',
          },
        ],
      },
    ])
    expect(body).toMatch(/\| Source \| Target \| Anchor \| Reason \|/)
    expect(body).toContain('public/blog/mot-history-check-uk.html')
    expect(body).toContain('/blog/mot-changes-2026-dvsa-updates.html')
    expect(body).toContain('MOT Changes 2026: DVSA Updates, New Rules')
    expect(body).toContain('Same-folder sibling')
    expect(body).toMatch(/never auto-merge/i)
  })
})
