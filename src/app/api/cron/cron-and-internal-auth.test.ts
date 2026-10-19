/**
 * Every /api/cron/* and /api/internal/* route must 401 without Bearer CRON_SECRET.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ROUTES: Array<{
  name: string
  load: () => Promise<{ GET?: (req: Request) => Promise<Response>; POST?: (req: Request) => Promise<Response> }>
  method: 'GET' | 'POST'
}> = [
  {
    name: 'cron/fix-agent-e2e',
    method: 'GET',
    load: async () => import('./fix-agent-e2e/route'),
  },
  {
    name: 'cron/fix-failure-digest',
    method: 'GET',
    load: async () => import('./fix-failure-digest/route'),
  },
  {
    name: 'cron/fix-site',
    method: 'GET',
    load: async () => import('./fix-site/route'),
  },
  {
    name: 'cron/gsc-sync',
    method: 'GET',
    load: async () => import('./gsc-sync/route'),
  },
  {
    name: 'cron/repair-articles',
    method: 'GET',
    load: async () => import('./repair-articles/route'),
  },
  {
    name: 'cron/scheduled-recrawl',
    method: 'GET',
    load: async () => import('./scheduled-recrawl/route'),
  },
  {
    name: 'cron/verify-link-registry',
    method: 'GET',
    load: async () => import('./verify-link-registry/route'),
  },
  {
    name: 'cron/verify-liveness',
    method: 'GET',
    load: async () => import('./verify-liveness/route'),
  },
  {
    name: 'cron/verify-publications',
    method: 'GET',
    load: async () => import('./verify-publications/route'),
  },
  {
    name: 'cron/weekly-jobs',
    method: 'GET',
    load: async () => import('./weekly-jobs/route'),
  },
  {
    name: 'internal/heartbeat',
    method: 'POST',
    load: async () => import('../internal/heartbeat/route'),
  },
]

describe('cron + internal routes reject missing CRON_SECRET', () => {
  const prev = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = 'unit-test-cron-secret'
    vi.resetModules()
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prev
  })

  for (const route of ROUTES) {
    it(`${route.name} → 401 without Authorization`, async () => {
      const mod = await route.load()
      const handler = mod[route.method]
      expect(handler, `${route.name} missing ${route.method}`).toBeTypeOf('function')
      const res = await handler!(new Request(`http://localhost/api/${route.name}`))
      expect(res.status).toBe(401)
      await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
    })

    it(`${route.name} → 401 with wrong Bearer`, async () => {
      const mod = await route.load()
      const handler = mod[route.method]
      const res = await handler!(
        new Request(`http://localhost/api/${route.name}`, {
          headers: { Authorization: 'Bearer wrong' },
        }),
      )
      expect(res.status).toBe(401)
    })
  }
})
