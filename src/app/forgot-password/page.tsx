'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SeorankoWordmark } from '@/components/SeorankoLogo'
import { TurnstileField, turnstileRequired } from '@/components/TurnstileField'
import { PASSWORD_RESET_REDIRECT_WWW } from '@/lib/auth/password-recovery'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (turnstileRequired() && !captchaToken) {
      setError('Please complete the security check.')
      setLoading(false)
      return
    }

    const supabase = createClient()
    // Exact production URL — must be in Supabase Auth → Redirect URLs
    // (also allowlist apex twin: https://seoranko.com/reset-password).
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: PASSWORD_RESET_REDIRECT_WWW,
        captchaToken: captchaToken || undefined,
      },
    )

    if (resetError) {
      setError(resetError.message)
      setLoading(false)
      setCaptchaToken(null)
      return
    }

    setSent(true)
    setLoading(false)
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
            Forgot password?
          </h1>
          <p className="text-[#6B6B6B] text-sm mb-6">
            Enter your account email and we&apos;ll send a reset link.
          </p>

          {sent ? (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-[8px] px-4 py-3">
                <p className="text-emerald-800 text-sm">
                  If an account exists for that email, a reset link is on its
                  way. Check your inbox (and spam), then open the link to set a
                  new password.
                </p>
              </div>
              <p className="text-center text-sm text-[#6B6B6B]">
                <Link
                  href="/login"
                  className="text-[#FF6B2C] hover:underline font-medium"
                >
                  Back to sign in
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#0F0F0F] mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full bg-white border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm text-[#0F0F0F] placeholder-[#9B9B9B] focus:outline-none focus:border-[#FF6B2C] transition-colors"
                />
              </div>

              <TurnstileField onToken={setCaptchaToken} />

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-[8px] px-4 py-3">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || (turnstileRequired() && !captchaToken)}
                className="w-full bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm py-3 rounded-[8px] transition-colors"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>

              <p className="text-center text-sm text-[#6B6B6B]">
                <Link
                  href="/login"
                  className="text-[#FF6B2C] hover:underline font-medium"
                >
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
