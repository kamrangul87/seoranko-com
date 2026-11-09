import { describe, expect, it } from 'vitest'
import {
  dedupeFixReceipts,
  receiptDisplayPageUrl,
} from './fix-receipt-display'

describe('receiptDisplayPageUrl', () => {
  it('rewrites SPA-shell canonical receipts to the site origin, not /privacy', () => {
    expect(
      receiptDisplayPageUrl({
        verdict: 'auto-strip-spa-shell-canonical',
        pageUrl: 'https://autodun.com/privacy',
      }),
    ).toBe('https://autodun.com/')
  })

  it('leaves other receipts on their finding URL', () => {
    expect(
      receiptDisplayPageUrl({
        verdict: 'auto-set-dimensions',
        pageUrl: 'https://autodun.com/privacy',
      }),
    ).toBe('https://autodun.com/privacy')
  })
})

describe('dedupeFixReceipts', () => {
  it('keeps the latest PR and notes the earlier one', () => {
    const out = dedupeFixReceipts([
      {
        itemId: 'old',
        pageUrl: 'https://autodun.com/privacy',
        verdict: 'auto-strip-spa-shell-canonical',
        plainEnglish:
          'Remove the hardcoded homepage canonical from the SPA shell so each route can set its own (approval required).',
        prNumber: 64,
        productionVerifiedAt: '2026-11-03T07:28:03.000Z',
      },
      {
        itemId: 'new',
        pageUrl: 'https://autodun.com/privacy',
        verdict: 'auto-strip-spa-shell-canonical',
        plainEnglish:
          'Remove the hardcoded homepage canonical from the SPA shell so each route can set its own (approval required).',
        prNumber: 65,
        productionVerifiedAt: '2026-11-03T07:28:06.000Z',
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.prNumber).toBe(65)
    expect(out[0]!.alsoPrNumbers).toEqual([64])
    expect(out[0]!.pageUrl).toBe('https://autodun.com/')
  })
})
