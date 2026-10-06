'use client'
import { useState, useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
<<<<<<< HEAD
import { SeorankoWordmark } from '@/components/SeorankoLogo'
=======
import { NAV_ITEMS } from '@/lib/dashboard-nav-items'

export { NAV_ITEMS } from '@/lib/dashboard-nav-items'
>>>>>>> d4fa409 (fix: keep NAV_ITEMS data out of DashboardNav for CI without Supabase)

interface UserProfile {
  name?: string
  email: string
  plan: 'free' | 'starter' | 'pro' | 'agency'
}

const PLAN_LABELS: Record<UserProfile['plan'], string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  agency: 'Agency',
}

const NAV_ICONS: Record<string, ReactNode> = {
  '/dashboard': (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  '/dashboard/settings': (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
  ),
  '/dashboard/audit': (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  '/dashboard/findings': (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10M4 18h10" />
    </svg>
  ),
  '/dashboard/experiments': (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
  ),
  '/dashboard/install': (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  '/dashboard/billing': (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  ),
}

export function DashboardNav() {
  const pathname = usePathname()
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }: { data: { user: User | null } }) => {
      if (!user) return
      const { data } = await supabase.from('user_profiles').select('*').eq('id', user.id).single()
      if (data) setUserProfile(data as UserProfile)
    })
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    // Also hit the API route so the server clears the legacy master cookie
    await fetch('/api/auth/signout', { method: 'POST', redirect: 'manual' }).catch(() => {})
    window.location.href = '/login'
  }

  return (
    <aside className="w-56 flex-shrink-0 border-r border-[#E8E8E4] flex flex-col bg-[#FAFAF8]" style={{ fontFamily: "'Outfit', sans-serif" }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[#E8E8E4]">
        <Link href="/" className="flex items-center gap-2.5">
          <SeorankoWordmark size={28} textStyle={{ fontSize: 16 }} />
        </Link>
      </div>

      {/* Flat product nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, description, ...rest }) => {
          const exact = 'exact' in rest ? rest.exact : false
          const isActive = exact ? pathname === href : pathname.startsWith(href)
          const icon = NAV_ICONS[href]
          return (
            <Link
              key={href}
              href={href}
              className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-[8px] text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[#FF6B2C]/10 text-[#FF6B2C]'
                  : 'text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-white'
              }`}
            >
              <span className="mt-0.5">{icon}</span>
              <div className="min-w-0">
                <p className="font-medium leading-tight">{label}</p>
                {description && (
                  <p className={`text-[10px] leading-tight mt-0.5 ${isActive ? 'text-[#FF6B2C]/70' : 'text-[#9B9B9B]'}`}>
                    {description}
                  </p>
                )}
              </div>
            </Link>
          )
        })}
      </nav>

      {/* User / Sign out — plan badge only (Keywords/Articles usage removed; pages-per-crawl not in subscription API) */}
      <div className="px-4 py-3 border-t border-[#E8E8E4]">
        {userProfile && (
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-7 h-7 rounded-full bg-[#FF6B2C]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[#FF6B2C] text-xs font-bold uppercase">
                {userProfile.name?.[0] ?? userProfile.email[0]}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#0F0F0F] truncate">{userProfile.name || userProfile.email}</p>
              <span className="inline-block text-[9px] font-bold uppercase tracking-wide text-[#FF6B2C] bg-[#FF6B2C]/10 px-1.5 py-0.5 rounded-full">
                {PLAN_LABELS[userProfile.plan] ?? PLAN_LABELS.free}
              </span>
            </div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-xs font-medium text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-white transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign Out
        </button>
      </div>
    </aside>
  )
}
