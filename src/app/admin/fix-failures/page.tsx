import { redirect } from 'next/navigation'
import { requireMasterUser } from '@/lib/github-app/require-master'
import { FixFailuresClient } from './failures-client'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Fix failures — Seoranko Admin',
  robots: { index: false, follow: false },
}

export default async function FixFailuresAdminPage() {
  const master = await requireMasterUser()
  if (!master.ok) {
    if (master.status === 401) {
      redirect(`/login?next=${encodeURIComponent('/admin/fix-failures')}`)
    }
    return (
      <main className="min-h-screen bg-[#F7F6F3] text-[#0F0F0F] px-6 py-16">
        <div className="mx-auto max-w-xl">
          <h1 className="text-2xl font-bold mb-2">Forbidden</h1>
          <p className="text-[#6B6B6B]">Owner account only.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#F7F6F3] text-[#0F0F0F] px-6 py-10">
      <FixFailuresClient />
    </main>
  )
}
