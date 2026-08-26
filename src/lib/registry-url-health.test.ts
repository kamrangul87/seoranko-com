/**
 * Registry URL health — known wrong tool paths + live reachability.
 */
import { describe, it, expect } from 'vitest'
import {
  correctKnownRegistryUrl,
  applyKnownRegistryUrlCorrection,
  auditRegistryLinkRows,
  rewriteKnownWrongRegistryHrefsInHtml,
  checkUrlReachable,
} from './registry-url-health'

function mockFetch(map: Record<string, number>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const status = map[url] ?? 404
    return new Response(status === 200 ? 'ok' : 'nope', { status })
  }) as unknown as typeof fetch
}

describe('correctKnownRegistryUrl', () => {
  it('remaps autodun.com/mot-checker → https://mot.autodun.com', () => {
    const c = correctKnownRegistryUrl('https://autodun.com/mot-checker')
    expect(c?.to).toBe('https://mot.autodun.com')
    expect(applyKnownRegistryUrlCorrection('https://www.autodun.com/mot-checker/')).toBe(
      'https://mot.autodun.com',
    )
  })

  it('remaps autodun.com/ev-charger-finder → https://ev.autodun.com', () => {
    const c = correctKnownRegistryUrl('https://autodun.com/ev-charger-finder')
    expect(c?.to).toBe('https://ev.autodun.com')
  })

  it('does NOT invent a remap for the genuine /running-costs content gap', () => {
    expect(correctKnownRegistryUrl('https://autodun.com/running-costs')).toBeNull()
    expect(applyKnownRegistryUrlCorrection('https://autodun.com/running-costs')).toBe(
      'https://autodun.com/running-costs',
    )
  })

  it('does not remap URLs that are already on the live tool subdomain', () => {
    expect(correctKnownRegistryUrl('https://mot.autodun.com')).toBeNull()
    expect(correctKnownRegistryUrl('https://ev.autodun.com')).toBeNull()
  })
})

describe('auditRegistryLinkRows', () => {
  it('corrects the two wrong tool URLs and deactivates a genuine gap', async () => {
    const fetchImpl = mockFetch({
      'https://mot.autodun.com': 200,
      'https://ev.autodun.com': 200,
      'https://autodun.com/running-costs': 404,
    })
    const { actions, updates } = await auditRegistryLinkRows(
      [
        { id: '1', page_url: 'https://autodun.com/mot-checker', site_url: 'https://autodun.com' },
        { id: '2', page_url: 'https://autodun.com/ev-charger-finder', site_url: 'https://autodun.com' },
        { id: '3', page_url: 'https://autodun.com/running-costs', site_url: 'https://autodun.com' },
      ],
      { fetchImpl },
    )

    expect(actions.filter((a) => a.action === 'corrected')).toHaveLength(2)
    expect(updates.find((u) => u.id === '1')?.page_url).toBe('https://mot.autodun.com')
    expect(updates.find((u) => u.id === '2')?.page_url).toBe('https://ev.autodun.com')
    expect(updates.find((u) => u.id === '3')).toEqual({ id: '3', is_active: false })
  })

  it('keeps a live specific page active with no rewrite', async () => {
    const fetchImpl = mockFetch({ 'https://mot.autodun.com': 200 })
    const { actions, updates } = await auditRegistryLinkRows(
      [{ id: 'm', page_url: 'https://mot.autodun.com' }],
      { fetchImpl },
    )
    expect(actions).toEqual([
      expect.objectContaining({ id: 'm', action: 'ok', url: 'https://mot.autodun.com' }),
    ])
    expect(updates).toHaveLength(0)
  })
})

describe('rewriteKnownWrongRegistryHrefsInHtml', () => {
  it('rewrites wrong tool hrefs already baked into article HTML', () => {
    const html = `<p>Use the <a href="https://autodun.com/mot-checker">MOT checker</a>
      and the <a href="https://autodun.com/ev-charger-finder">EV finder</a>.</p>`
    const { html: out, replacements } = rewriteKnownWrongRegistryHrefsInHtml(html)
    expect(out).toContain('https://mot.autodun.com')
    expect(out).toContain('https://ev.autodun.com')
    expect(out).not.toContain('autodun.com/mot-checker')
    expect(out).not.toContain('autodun.com/ev-charger-finder')
    expect(replacements).toHaveLength(2)
  })

  it('leaves /running-costs untouched (genuine gap, not a wrong remap)', () => {
    const html = `<p>See <a href="https://autodun.com/running-costs">running costs</a>.</p>`
    const { html: out, replacements } = rewriteKnownWrongRegistryHrefsInHtml(html)
    expect(out).toContain('https://autodun.com/running-costs')
    expect(replacements).toHaveLength(0)
  })
})

describe('live reachability (real network)', () => {
  it('confirms the two tool subdomains resolve and the two wrong apex paths do not', async () => {
    const mot = await checkUrlReachable('https://mot.autodun.com')
    const ev = await checkUrlReachable('https://ev.autodun.com')
    const wrongMot = await checkUrlReachable('https://autodun.com/mot-checker')
    const wrongEv = await checkUrlReachable('https://autodun.com/ev-charger-finder')
    const gap = await checkUrlReachable('https://autodun.com/running-costs')

    expect(mot.ok).toBe(true)
    expect(ev.ok).toBe(true)
    expect(wrongMot.ok).toBe(false)
    expect(wrongEv.ok).toBe(false)
    expect(gap.ok).toBe(false)
  }, 20_000)
})
