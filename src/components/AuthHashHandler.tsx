'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  loginPathAfterAuthFailure,
  nextPathAfterAuthType,
  parseAuthHash,
  readCapturedAuthHash,
} from '@/lib/auth/auth-hash'

function stripHashFromUrl() {
  const url = `${window.location.pathname}${window.location.search}`
  window.history.replaceState({}, '', url)
}

/**
 * Implicit-flow safety net. Confirmation emails that fall back to Site URL
 * land on `/#access_token=…&type=signup` (hash is never sent to middleware).
 * Consume the tokens, establish a session, strip the hash, then go to
 * /dashboard (or /reset-password for recovery).
 */
export function AuthHashHandler() {
  useEffect(() => {
    const parsed = parseAuthHash(readCapturedAuthHash())
    if (!parsed) return

    let cancelled = false
    void (async () => {
      const nextQuery = new URLSearchParams(window.location.search).get('next')
      if (parsed.error || !parsed.accessToken || !parsed.refreshToken) {
        stripHashFromUrl()
        if (!cancelled) {
          window.location.replace(loginPathAfterAuthFailure(parsed))
        }
        return
      }

      const supabase = createClient()
      const { error } = await supabase.auth.setSession({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken,
      })
      stripHashFromUrl()
      if (cancelled) return
      if (error) {
        window.location.replace(loginPathAfterAuthFailure(parsed))
        return
      }
      window.location.replace(nextPathAfterAuthType(parsed.type, nextQuery))
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
