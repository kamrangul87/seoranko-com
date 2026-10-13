import { describe, expect, it } from 'vitest'
import { goneLegacy } from './api-gone'

describe('goneLegacy', () => {
  it('returns 410 with FEATURE_REMOVED code', async () => {
    const res = goneLegacy('Humanize')
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toBe('Gone')
    expect(body.code).toBe('FEATURE_REMOVED')
    expect(body.message).toMatch(/Humanize/)
  })
})
