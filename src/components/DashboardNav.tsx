'use client'
import { useState, useEffect, type ReactNode } from 'react'
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

// Beta primary journey (PRODUCT_MODEL.md): Sites → Audit → Google → History.
// Content/AI tools remain reachable under Experimental — not deleted.
const NAV_ITEMS: Array<{
  href: string
  exact?: boolean
  label: string
  description: string
  experimental?: boolean
  icon: ReactNode
}> = [
  {
    href: '/dashboard/settings',
    label: 'Sites',
    description: 'Domains, GitHub, connections',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>
    ),
  },
  {
    href: '/dashboard/audit',
    label: 'Audit',
    description: 'Crawl, findings, fixes',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: '/dashboard/experiments',
    label: 'Google status',
    description: 'GSC, interventions, recrawl',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>
    ),
  },
  {
    href: '/dashboard/install',
    label: 'History',
    description: 'Install + connection health',
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: '/dashboard',
    exact: true,
    label: 'Home',
    description: '',
    experimental: true,
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/dashboard/write',
    label: 'Write',
    description: 'Content tools',
    experimental: true,
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/keywords',
    label: 'Keywords',
    description: '',
    experimental: true,
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
      </svg>
    ),
  },
  {
    href: '/dashboard/rankings',
    label: 'Rankings',
    description: '',
    experimental: true,
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    href: '/dashboard/briefs',
    label: 'Briefs',
    description: '',
    experimental: true,
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/ai-visibility',
    label: 'AI Visibility',
    description: '',
    experimental: true,
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/sitemap',
    label: 'Sitemap',
    description: '',
    experimental: true,
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 0v10" />
      </svg>
    ),
  },
  {
    href: '/dashboard/billing',
    label: 'Billing',
    description: '',
    experimental: true,
    icon: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
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

      {/* Nav — beta primary first; experimental collapsed below */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.filter((i) => !i.experimental).map(({ href, label, description, icon, exact }) => {
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
        <p className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wide font-medium text-[#9B9B9B]">
          Experimental
        </p>
        {NAV_ITEMS.filter((i) => i.experimental).map(({ href, label, description, icon, exact }) => {
          const isActive = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`w-full flex items-start gap-3 px-3 py-2 rounded-[8px] text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-[#FF6B2C]/10 text-[#FF6B2C]'
                  : 'text-[#9B9B9B] hover:text-[#6B6B6B] hover:bg-white'
              }`}
            >
              <span className="mt-0.5 opacity-70">{icon}</span>
              <div className="min-w-0">
                <p className="font-medium leading-tight">{label}</p>
                {description && (
                  <p className="text-[10px] leading-tight mt-0.5 text-[#B0B0B0]">{description}</p>
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
