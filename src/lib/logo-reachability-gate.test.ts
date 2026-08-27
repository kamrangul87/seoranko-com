import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runQualityGate } from './article-quality-gate'

const HTML = `
  <html><head><title>EV Charger Guide | autodun</title></head>
  <body><article>
  <h1>EV charger guide</h1>
  <p>Written by Kamran Gul of autodun. EV charger guide covers installation basics.</p>
  <h2>What to know</h2>
  <p>EV charger guide depends on your meter and DNO.</p>
  </article></body></html>
`

const BASE_OPTS = {
  brand: 'autodun',
  keyword: 'ev charger guide',
  authorName: 'Kamran Gul',
  registeredLinkDomains: ['autodun.com'],
  minWordCount: 10,
  expectOrganizationLogo: true,
}

describe('runQualityGate — M07 live logo reachability', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('flags a dead logo URL (the exact Clearbit-shutdown 404 shape) as critical', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
    }) as unknown as typeof fetch

    const qr = await runQualityGate(HTML, {
      ...BASE_OPTS,
      organizationLogoUrl: 'https://logo.clearbit.com/autodun.com',
    })
    const reachabilityIssue = qr.issues.find(i => i.id === 'schema-Organization-logo-reachability')
    expect(reachabilityIssue).toBeTruthy()
    expect(reachabilityIssue!.severity).toBe('critical')
    expect(reachabilityIssue!.description).toContain('404')
  })

  it('does not flag a real, reachable logo URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
    }) as unknown as typeof fetch

    const qr = await runQualityGate(HTML, {
      ...BASE_OPTS,
      organizationLogoUrl: 'https://cdn.example.com/real-logo.png',
    })
    const reachabilityIssue = qr.issues.find(i => i.id === 'schema-Organization-logo-reachability')
    expect(reachabilityIssue).toBeUndefined()
  })

  it('does not call fetch when no organizationLogoUrl is passed', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await runQualityGate(HTML, BASE_OPTS)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not call fetch when skipLiveVerification is set (regression-harness mode)', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await runQualityGate(HTML, {
      ...BASE_OPTS,
      organizationLogoUrl: 'https://logo.clearbit.com/autodun.com',
      skipLiveVerification: true,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
