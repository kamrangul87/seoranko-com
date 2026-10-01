import { describe, expect, it } from 'vitest'
import { decideGscRefreshTokenApply } from './callback-token'

describe('decideGscRefreshTokenApply', () => {
  it('stores a new refresh token whenever Google returns one', () => {
    expect(
      decideGscRefreshTokenApply({
        newRefreshToken: 'new-rt',
        existingCiphertext: 'old',
        existingStatus: 'expired',
      }),
    ).toEqual({ action: 'store_new', refreshToken: 'new-rt' })
  })

  it('rejects when expired and Google omits refresh_token', () => {
    const d = decideGscRefreshTokenApply({
      newRefreshToken: null,
      existingCiphertext: 'dead-cipher',
      existingStatus: 'expired',
    })
    expect(d.action).toBe('reject')
    if (d.action === 'reject') {
      expect(d.message).toMatch(/expired/i)
      expect(d.message).toMatch(/Reconnect|Revoke/i)
    }
  })

  it('rejects when revoked and Google omits refresh_token', () => {
    const d = decideGscRefreshTokenApply({
      newRefreshToken: null,
      existingCiphertext: 'cipher',
      existingStatus: 'revoked',
    })
    expect(d.action).toBe('reject')
  })

  it('rejects when there is no stored ciphertext and no new token', () => {
    const d = decideGscRefreshTokenApply({
      newRefreshToken: null,
      existingCiphertext: null,
      existingStatus: null,
    })
    expect(d.action).toBe('reject')
    if (d.action === 'reject') {
      expect(d.message).toMatch(/refresh token/i)
    }
  })

  it('reuses an active ciphertext when Google omits refresh_token', () => {
    expect(
      decideGscRefreshTokenApply({
        newRefreshToken: null,
        existingCiphertext: 'still-good',
        existingStatus: 'active',
      }),
    ).toEqual({ action: 'reuse_existing' })
  })
})
