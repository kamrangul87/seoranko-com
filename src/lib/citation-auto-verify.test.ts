import { describe, it, expect, vi } from 'vitest'
import {
  normalizeFigureForMatch,
  pageTextContainsFigure,
  verifyFigureAgainstCitation,
} from './citation-auto-verify'

describe('citation-auto-verify', () => {
  it('normalises money figures into match variants', () => {
    const variants = normalizeFigureForMatch('up to £350')
    expect(variants.some(v => v.includes('350'))).toBe(true)
    expect(variants.some(v => v.includes('£350') || v.includes('£ 350'))).toBe(true)
  })

  it('finds a figure inside page text', () => {
    expect(pageTextContainsFigure('Grant of up to £350 towards…', 'up to £350')).toBe(true)
    expect(pageTextContainsFigure('Nothing relevant here', 'up to £350')).toBe(false)
  })

  it('auto-verifies when the cited page still shows the figure', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<html><body>You can get up to £350 off the cost of a chargepoint</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    ) as unknown as typeof fetch

    const result = await verifyFigureAgainstCitation(
      'up to £350',
      'https://www.gov.uk/government/publications/electric-vehicle-homecharge-scheme',
      { now: new Date('2026-08-20T12:00:00Z'), fetchImpl, sourceLabel: 'GOV.UK' },
    )
    expect(result.status).toBe('auto-verified')
    expect(result.verifiedAsOf).toBe('2026-08-20')
    expect(result.detail).toMatch(/auto-verified as of 2026-08-20/)
  })

  it('reports figure-missing when the page no longer shows the amount', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<html><body>This scheme has closed</body></html>', { status: 200 }),
    ) as unknown as typeof fetch

    const result = await verifyFigureAgainstCitation(
      'up to £350',
      'https://www.gov.uk/example',
      { fetchImpl, sourceLabel: 'GOV.UK' },
    )
    expect(result.status).toBe('figure-missing')
    expect(result.detail).toMatch(/page no longer shows this figure/)
  })

  it('reports unreachable when fetch fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const result = await verifyFigureAgainstCitation(
      'up to £350',
      'https://www.gov.uk/example',
      { fetchImpl, sourceLabel: 'GOV.UK' },
    )
    expect(result.status).toBe('unreachable')
    expect(result.detail).toMatch(/couldn't reach GOV\.UK/)
  })

  it('reports no-citation when URL is missing', async () => {
    const result = await verifyFigureAgainstCitation('up to £350', null)
    expect(result.status).toBe('no-citation')
    expect(result.detail).toBe('no citation present to check')
  })
})
