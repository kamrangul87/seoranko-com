'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isValidPassword } from '@/lib/auth/password-recovery'

/**
 * Signed-in account password change (Settings).
 * Uses supabase.auth.updateUser — no email round-trip required.
 */
export function ChangePasswordPanel() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setOk(false)

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
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setPassword('')
    setConfirm('')
    setOk(true)
  }

  return (
    <div data-testid="change-password">
      <h2 className="text-lg font-semibold text-[#0F0F0F] mb-1">
        Change password
      </h2>
      <p className="text-sm text-[#6B6B6B] mb-4">
        Update the password for your signed-in account.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3 max-w-md">
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
            className="w-full bg-white border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C] transition-colors"
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
            className="w-full bg-white border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C] transition-colors"
          />
        </div>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {ok && (
          <p className="text-sm text-emerald-700" role="status">
            Password updated.
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  )
}
