'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SeorankoWordmark } from '@/components/SeorankoLogo'
import { isValidPassword } from '@/lib/auth/password-recovery'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    async function establishSession() {
      // PKCE: ?code=… from the recovery email link.
      const url = new URL(window.location.href)
      const code = url.searchParams.get('code')
      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          if (!cancelled) {
            setError(exchangeError.message)
            setChecking(false)
          }
          return
        }
        // Drop the code from the address bar.
        window.history.replaceState({}, '', '/reset-password')
      }

      const { data } = await supabase.auth.getSession()
      if (!cancelled) {
        setReady(!!data.session)
        setChecking(false)
        if (!data.session && !code) {
          setError(
            'This reset link is missing or expired. Request a new one from Forgot password.',
          )
        }
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true)
        setChecking(false)
        setError('')
      }
    })

    void establishSession()
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!isValidPassword(password)) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })
    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div
      className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-4"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-2.5">
            <SeorankoWordmark size={32} textStyle={{ fontSize: 20 }} />
          </Link>
        </div>

        <div className="bg-white border border-[#E8E8E4] rounded-[12px] p-8 shadow-sm">
          <h1 className="text-xl font-bold text-[#0F0F0F] mb-1">
            Set a new password
          </h1>
          <p className="text-[#6B6B6B] text-sm mb-6">
            Choose a new password for your SEORANKO account.
          </p>

          {checking ? (
            <p className="text-sm text-[#6B6B6B]">Checking reset link…</p>
          ) : !ready ? (
            <div className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-[8px] px-4 py-3">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}
              <p className="text-center text-sm text-[#6B6B6B]">
                <Link
                  href="/forgot-password"
                  className="text-[#FF6B2C] hover:underline font-medium"
                >
                  Request a new reset link
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#0F0F0F] mb-1.5">
                  New password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="At least 8 characters"
                  className="w-full bg-white border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm text-[#0F0F0F] placeholder-[#9B9B9B] focus:outline-none focus:border-[#FF6B2C] transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0F0F0F] mb-1.5">
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="Repeat password"
                  className="w-full bg-white border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm text-[#0F0F0F] placeholder-[#9B9B9B] focus:outline-none focus:border-[#FF6B2C] transition-colors"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-[8px] px-4 py-3">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm py-3 rounded-[8px] transition-colors"
              >
                {loading ? 'Saving…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
