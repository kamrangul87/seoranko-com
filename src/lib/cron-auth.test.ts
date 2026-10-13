import { afterEach, describe, expect, it } from 'vitest'
import { requireCronSecret, unauthorizedCron } from './cron-auth'

describe('requireCronSecret', () => {
  const prev = process.env.CRON_SECRET

  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prev
  })

  it('returns 401 when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET
    const res = requireCronSecret(new Request('http://localhost/x'))
    expect(res?.status).toBe(401)
  })

  it('returns 401 when Authorization is missing', () => {
    process.env.CRON_SECRET = 'test-secret'
    const res = requireCronSecret(new Request('http://localhost/x'))
    expect(res?.status).toBe(401)
  })

  it('returns 401 when Bearer token mismatches', () => {
    process.env.CRON_SECRET = 'test-secret'
    const res = requireCronSecret(
      new Request('http://localhost/x', {
        headers: { Authorization: 'Bearer wrong' },
      }),
    )
    expect(res?.status).toBe(401)
  })

  it('returns null when Bearer matches', () => {
    process.env.CRON_SECRET = 'test-secret'
    const res = requireCronSecret(
      new Request('http://localhost/x', {
        headers: { Authorization: 'Bearer test-secret' },
      }),
    )
    expect(res).toBeNull()
  })

  it('unauthorizedCron is 401 JSON', async () => {
    const res = unauthorizedCron()
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})
