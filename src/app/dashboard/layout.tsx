'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase-client'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Second layer of defence — verify the CURRENT session on mount.
    // Even if middleware lets someone through, no dashboard content
    // renders without a real Supabase session.
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!session) {
        router.push('/login')
        return
      }
      setChecking(false)
    })

    // Then react to subsequent auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (event === 'SIGNED_OUT' || !session) {
          router.push('/login')
        }
        if (event === 'SIGNED_IN') {
          setChecking(false)
          router.refresh()
        }
      }
    )
    return () => subscription.unsubscribe()
  }, [router])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <p className="text-sm text-[#6B6B6B]" style={{ fontFamily: "'Outfit', sans-serif" }}>
          Loading…
        </p>
      </div>
    )
  }

  return <>{children}</>
}
