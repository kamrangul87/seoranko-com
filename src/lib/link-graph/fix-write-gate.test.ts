import { describe, expect, it } from 'vitest'
import {
  fixRequiresConnectingHost,
  fixRequiresConnectingMessage,
  requiredFixHost,
} from './fix-write-gate'

describe('fix-write-gate', () => {
  it('extracts host from source URL', () => {
    expect(requiredFixHost('https://mot.autodun.com/blog/x')).toBe('mot.autodun.com')
  })

  it('blocks when CMS is not connected', () => {
    expect(
      fixRequiresConnectingHost({
        sourceUrl: 'https://mot.autodun.com/page',
        cmsConnected: false,
        connectedDomain: null,
      }),
    ).toBe('mot.autodun.com')
  })

  it('blocks subdomain finding when only parent domain is connected', () => {
    expect(
      fixRequiresConnectingHost({
        sourceUrl: 'https://mot.autodun.com/page',
        cmsConnected: true,
        connectedDomain: 'autodun.com',
      }),
    ).toBe('mot.autodun.com')
  })

  it('allows when exact host matches connected site', () => {
    expect(
      fixRequiresConnectingHost({
        sourceUrl: 'https://mot.autodun.com/page',
        cmsConnected: true,
        connectedDomain: 'mot.autodun.com',
      }),
    ).toBeNull()
  })

  it('message matches product copy', () => {
    expect(fixRequiresConnectingMessage('mot.autodun.com')).toBe(
      'This fix requires connecting mot.autodun.com — go to Settings to connect it.',
    )
  })
})
