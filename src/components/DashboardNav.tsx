'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

interface UserProfile {
  name?: string
  email: string
  plan: 'free' | 'starter' | 'pro' | 'agency'
  keywords_used_today: number
  keywords_used_month: number
  articles_used_month: number
}

const PLAN_LIMITS = {
  free:    { label: 'Free',    keywords: 5,        articles: 1,        kPeriod: 'day',   aPeriod: 'lifetime' },
  starter: { label: 'Starter', keywords: 500,       articles: 30,       kPeriod: 'month', aPeriod: 'month' },
  pro:     { label: 'Pro',     keywords: 2000,      articles: 100,      kPeriod: 'month', aPeriod: 'month' },
  agency:  { label: 'Agency',  keywords: Infinity,  articles: Infinity, kPeriod: 'month', aPeriod: 'month' },
}

const NAV_ITEMS = [
  {
    href: '/dashboard',
    exact: true,
    label: 'Home',
    description: '',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/dashboard/keywords',
    label: 'Research',
    description: '',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/write',
    label: 'Write',
    description: '',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/optimise',
    label: 'Improve',
    description: '',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/rankings',
    label: 'RANKO',
    description: '',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    href: '/dashboard/intelligence',
    label: 'Audit',
    description: '',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    description: '',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

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
          <div className="w-7 h-7 bg-[#FF6B2C] rounded-[7px] flex items-center justify-center">
            <span className="text-[#0a0a0a] font-extrabold text-xs">S</span>
          </div>
          <span className="font-bold text-base tracking-tight">Seoranko</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, description, icon, exact }) => {
          const isActive = exact ? pathname === href : pathname.startsWith(href)
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

      {/* Usage meters */}
      <div className="px-4 py-4 border-t border-[#E8E8E4]">
        {userProfile ? (() => {
          const meta = PLAN_LIMITS[userProfile.plan] ?? PLAN_LIMITS.free
          const kwUsed = meta.kPeriod === 'day' ? userProfile.keywords_used_today : userProfile.keywords_used_month
          const artUsed = userProfile.articles_used_month
          const rows = [
            { label: 'Keywords', used: kwUsed, max: meta.keywords, period: meta.kPeriod },
            { label: 'Articles',  used: artUsed, max: meta.articles, period: meta.aPeriod },
          ]
          return (
            <div className="space-y-2">
              <p className="text-[10px] text-[#6B6B6B] mb-1.5 uppercase tracking-wide font-medium">Usage</p>
              {rows.map(({ label, used, max, period }) => {
                const isUnlimited = max === Infinity
                const periodLabel = period === 'lifetime' ? 'lifetime' : period === 'day' ? 'today' : 'mo'
                return (
                  <div key={label}>
                    <div className="flex justify-between text-[10px] text-[#6B6B6B] mb-1">
                      <span>{label}</span>
                      <span>{isUnlimited ? '∞' : `${used}/${max} ${periodLabel}`}</span>
                    </div>
                    {!isUnlimited && (
                      <div className="h-1 bg-[#F5F4F1] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#FF6B2C] rounded-full"
                          style={{ width: `${Math.min(100, (used / max) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })() : (
          <div className="space-y-2">
            <div className="h-1 bg-[#F5F4F1] rounded-full animate-pulse" />
            <div className="h-1 bg-[#F5F4F1] rounded-full animate-pulse" />
          </div>
        )}
      </div>

      {/* User / Sign out */}
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
                {(PLAN_LIMITS[userProfile.plan] ?? PLAN_LIMITS.free).label}
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
