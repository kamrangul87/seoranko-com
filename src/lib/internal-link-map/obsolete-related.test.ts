import { describe, expect, it } from 'vitest'
import {
  markObsoleteUtilityFinding,
  relatedFindingIsObsolete,
} from './obsolete-related'

describe('relatedFindingIsObsolete', () => {
  it('flags pending related reading whose source page is utility', () => {
    expect(
      relatedFindingIsObsolete({
        pageUrl: 'https://autodun.com/privacy',
        evidenceValues: {
          relatedTargets: [
            { href: '/blog/mot-cost-uk-2026.html', anchorText: 'MOT Cost' },
          ],
        },
      }),
    ).toBe(true)
  })

  it('flags pending related reading that targets a utility page', () => {
    expect(
      relatedFindingIsObsolete({
        pageUrl: 'https://autodun.com/blog/mot-cost-uk-2026.html',
        evidenceValues: {
          relatedTargets: [{ href: '/about', anchorText: 'About Autodun' }],
        },
      }),
    ).toBe(true)
    expect(
      relatedFindingIsObsolete({
        pageUrl: 'https://autodun.com/',
        evidenceValues: {
          linkHealthKind: 'orphan-footer-only',
          relatedTargets: [{ href: '/privacy', anchorText: 'Privacy Policy' }],
        },
      }),
    ).toBe(true)
  })

  it('leaves content-to-content related reading actionable', () => {
    expect(
      relatedFindingIsObsolete({
        pageUrl: 'https://autodun.com/blog/mot-cost-uk-2026.html',
        evidenceValues: {
          relatedTargets: [
            { href: '/blog/mot-history-check-uk.html', anchorText: 'MOT History' },
          ],
        },
      }),
    ).toBe(false)
  })
})

describe('markObsoleteUtilityFinding', () => {
  it('marks evidence dismissed/obsolete without deleting the row', () => {
    const next = markObsoleteUtilityFinding({
      relatedTargets: [{ href: '/privacy', anchorText: 'Privacy Policy' }],
      neverAutoMerge: true,
    })
    expect(next.obsolete).toBe(true)
    expect(next.dismissed).toBe(true)
    expect(next.dismissedReason).toBe('utility-page')
    expect(typeof next.dismissedAt).toBe('string')
    expect(next.neverAutoMerge).toBe(true)
    expect(next.relatedTargets).toEqual([
      { href: '/privacy', anchorText: 'Privacy Policy' },
    ])
  })
})
