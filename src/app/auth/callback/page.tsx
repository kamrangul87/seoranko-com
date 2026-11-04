'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseAuthHash } from '@/lib/auth/auth-hash'
import { safeNextPath } from '@/lib/auth/safe-next-path'

/**
 * PKCE landing (`?code=`) and a visible place for implicit-hash handling
 * (hash is consumed by AuthHashHandler in the root layout).
 *
 * Must be a page, not a Route Handler: a 302 from route.ts would run
 * before React mounts, and a missing `code` would look like an expired
 * link even when `#access_token` is sitting on the client.
 */
export default function AuthCallbackPage() {
  const [message, setMessage] = useState('Completing sign-in…')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const next = safeNextPath(params.get('next'), '/dashboard')
    const hash = parseAuthHash(window.location.hash)

    if (!code) {
      if (hash) {
        // AuthHashHandler (root layout) consumes the fragment.
        setMessage('Signing you in…')
        return
      }
      window.location.replace('/login?confirmed=1')
      return
    }

    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (cancelled) return
      if (error) {
        setMessage('This link has expired. Taking you to sign in…')
        window.location.replace('/login?error=link_expired')
        return
      }
      window.location.replace(next)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[#FAFAF8]"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      <p className="text-sm text-[#6B6B6B]">{message}</p>
    </div>
  )
}
