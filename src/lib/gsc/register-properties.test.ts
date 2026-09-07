import { describe, expect, it } from 'vitest'
import { registerGscPropertiesForUser } from './register-properties'

function mockSitesClient(existing: Array<Record<string, unknown>>) {
  const insertedSites: unknown[] = []
  const upserted: unknown[] = []

  const sitesApi = {
    select: () => ({
      eq: () => ({
        order: () => ({
          order: async () => ({ data: existing }),
        }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      insertedSites.push(row)
      return {
        select: () => ({
          single: async () => ({ data: { id: 'site-new' }, error: null }),
        }),
      }
    },
  }
  const connsApi = {
    upsert: (row: Record<string, unknown>) => {
      upserted.push(row)
      return {
        select: () => ({
          single: async () => ({ data: { id: 'conn-1' }, error: null }),
        }),
      }
    },
  }

  return {
    insertedSites,
    upserted,
    client: {
      from: (table: string) => (table === 'connected_sites' ? sitesApi : connsApi),
    },
  }
}

describe('registerGscPropertiesForUser', () => {
  it('creates a site + connection for a new property host', async () => {
    const { client, insertedSites, upserted } = mockSitesClient([])

    const result = await registerGscPropertiesForUser(client, {
      userId: 'user-1',
      propertyUrls: ['sc-domain:ev.example.com', 'https://unknown.example.org/'],
      refreshTokenEncrypted: 'enc:v1:test',
      allowedPropertyUrls: new Set(['sc-domain:ev.example.com']),
    })

    expect(result.registered).toHaveLength(1)
    expect(result.registered[0]?.domain).toBe('ev.example.com')
    expect(result.registered[0]?.createdSite).toBe(true)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toMatch(/Not a verified/)
    expect(upserted[0]).toMatchObject({
      site_id: 'site-new',
      property_url: 'sc-domain:ev.example.com',
      status: 'active',
    })
    expect(insertedSites[0]).toMatchObject({
      domain: 'ev.example.com',
      brand: 'example',
    })
  })

  it('reuses an existing exact-host site', async () => {
    const { client, upserted } = mockSitesClient([
      {
        id: 'site-existing',
        domain: 'example.com',
        brand: 'example',
        is_primary: true,
        universal_tag_token: null,
      },
    ])

    const result = await registerGscPropertiesForUser(client, {
      userId: 'user-1',
      propertyUrls: ['https://www.example.com/'],
      refreshTokenEncrypted: 'enc:v1:test',
      allowedPropertyUrls: new Set(['https://www.example.com/']),
    })

    expect(result.registered).toHaveLength(1)
    expect(result.registered[0]?.createdSite).toBe(false)
    expect(result.registered[0]?.siteId).toBe('site-existing')
    expect(upserted[0]).toMatchObject({ site_id: 'site-existing' })
  })
})
