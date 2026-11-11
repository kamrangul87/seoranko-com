import { describe, expect, it } from 'vitest'
import {
  markObsoleteFinding,
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

  it('flags a PR-opened finding whose target is a utility page', () => {
    expect(
      relatedFindingIsObsolete({
        pageUrl: 'https://autodun.com/blog/electric-car-mot-whats-checked-uk-2026.html',
        evidenceValues: {
          relatedTargets: [
            {
              href: '/about',
              anchorText: "About Autodun: The UK's Smarter Car Ownership Platform (2026)",
            },
          ],
          linkHealthKind: 'orphan-footer-only',
          neverAutoMerge: true,
        },
      }),
    ).toBe(true)
  })

  it('flags related reading stamped with a pre-v3 transform', () => {
    expect(
      relatedFindingIsObsolete({
        pageUrl: 'https://autodun.com/blog/mot-advisories-explained-uk.html',
        evidenceValues: {
          relatedTargets: [
            { href: '/blog/mot-history-check-uk.html', anchorText: 'MOT History Check UK' },
          ],
          relatedTransformVersion: 2,
        },
      }),
    ).toBe(true)
  })

  it('flags a committed finding with no transform version as pre-v3', () => {
    expect(
      relatedFindingIsObsolete(
        {
          pageUrl: 'https://autodun.com/blog/mot-advisories-explained-uk.html',
          evidenceValues: {
            relatedTargets: [
              {
                href: '/blog/mot-history-check-uk.html',
                anchorText: 'MOT History Check UK',
              },
            ],
          },
        },
        { hasCustomerPr: true },
      ),
    ).toBe(true)
  })

  it('flags truncated stored anchors even when the source is a content page', () => {
    expect(
      relatedFindingIsObsolete({
        pageUrl: 'https://autodun.com/blog/ev-charging-on-uk-motorways.html',
        evidenceValues: {
          relatedTargets: [
            { href: '/blog/mot-cost-uk-2026.html', anchorText: 'MOT cost in' },
          ],
        },
      }),
    ).toBe(true)
  })

  it('flags a finding whose customer PR was closed unmerged', () => {
    expect(
      relatedFindingIsObsolete(
        {
          pageUrl: 'https://autodun.com/blog/electric-car-mot-whats-checked-uk-2026.html',
          evidenceValues: {
            relatedTargets: [
              { href: '/blog/mot-advisories-explained-uk.html', anchorText: 'MOT advisories explained' },
            ],
            relatedTransformVersion: 3,
          },
        },
        { customerPr: { state: 'closed', merged: false } },
      ),
    ).toBe(true)
  })

  it('does not obsolete a merged finding — History owns those', () => {
    expect(
      relatedFindingIsObsolete(
        {
          pageUrl: 'https://autodun.com/blog/mot-cost-uk-2026.html',
          evidenceValues: {
            relatedTargets: [
              { href: '/blog/mot-history-check-uk.html', anchorText: 'MOT History Check UK' },
            ],
            relatedTransformVersion: 3,
          },
        },
        { status: 'merged', customerPr: { state: 'closed', merged: true } },
      ),
    ).toBe(false)
  })

  it('drops footer-only findings once the target has in-content inlinks', () => {
    const keys = new Set([
      'https://autodun.com/ulez-checker-uk',
      '/ulez-checker-uk',
    ])
    expect(
      relatedFindingIsObsolete(
        {
          pageUrl: 'https://autodun.com/blog/mot-changes-2026-dvsa-updates.html',
          evidenceValues: {
            linkHealthKind: 'orphan-footer-only',
            relatedTargets: [
              {
                href: '/ulez-checker-uk',
                anchorText: 'ULEZ Checker UK — What ULEZ Compliance Really Means for Drivers',
              },
            ],
            linkHealthHint:
              '“ULEZ Checker UK — What ULEZ Compliance Really Means for Drivers” is only linked from the footer or nav.',
          },
        },
        { inContentInlinkKeys: keys },
      ),
    ).toBe(true)
  })

  it('keeps a footer-only finding when the target still has no in-content inlinks', () => {
    expect(
      relatedFindingIsObsolete(
        {
          pageUrl: 'https://autodun.com/blog/mot-changes-2026-dvsa-updates.html',
          evidenceValues: {
            linkHealthKind: 'orphan-footer-only',
            relatedTargets: [
              {
                href: '/lonely-guide',
                anchorText: 'Lonely guide for UK drivers',
              },
            ],
          },
        },
        { inContentInlinkKeys: new Set(['https://autodun.com/ulez-checker-uk']) },
      ),
    ).toBe(false)
  })
})

describe('markObsoleteFinding', () => {
  it('records an explicit reason without deleting stored targets', () => {
    const next = markObsoleteFinding(
      { relatedTargets: [{ href: '/about', anchorText: 'About' }] },
      'pr-closed-unmerged',
    )
    expect(next.obsolete).toBe(true)
    expect(next.dismissed).toBe(true)
    expect(next.dismissedReason).toBe('pr-closed-unmerged')
    expect(next.neverAutoMerge).toBe(true)
    expect(next.relatedTargets).toEqual([{ href: '/about', anchorText: 'About' }])
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
