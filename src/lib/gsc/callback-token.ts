/**
 * Decide how to apply Google's OAuth code exchange to a stored GSC row.
 *
 * Google often omits refresh_token on re-consent when the grant is still
 * valid. That reuse path must NEVER run when the stored connection is already
 * expired/revoked — those ciphertexts are known-dead and marking them active
 * silently traps the user.
 */

export type GscStoredAuthStatus = 'active' | 'expired' | 'revoked' | string

export type GscRefreshApplyDecision =
  | { action: 'store_new'; refreshToken: string }
  | { action: 'reuse_existing' }
  | {
      action: 'reject'
      message: string
    }

const NO_REFRESH_MESSAGE =
  'Google did not return a refresh token. Revoke SEORANKO access in your Google Account (https://myaccount.google.com/permissions), then connect again and approve offline access.'

export function decideGscRefreshTokenApply(opts: {
  newRefreshToken: string | null
  existingCiphertext: string | null | undefined
  existingStatus: GscStoredAuthStatus | null | undefined
}): GscRefreshApplyDecision {
  if (opts.newRefreshToken) {
    return { action: 'store_new', refreshToken: opts.newRefreshToken }
  }

  const hasCipher = !!(opts.existingCiphertext && opts.existingCiphertext.length > 0)
  const status = opts.existingStatus || null

  if (!hasCipher) {
    return { action: 'reject', message: NO_REFRESH_MESSAGE }
  }

  if (status === 'expired' || status === 'revoked') {
    return {
      action: 'reject',
      message:
        'Search Console authorization is expired and Google did not issue a new refresh token. ' +
        'Revoke SEORANKO in your Google Account permissions, then use Reconnect and approve access again.',
    }
  }

  // Active (or unknown legacy) row with ciphertext — Google omitted refresh; keep existing.
  return { action: 'reuse_existing' }
}
