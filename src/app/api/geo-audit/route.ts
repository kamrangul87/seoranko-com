import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runGEOAudit } from '@/lib/geo-auditor'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const { url, saveResult = true } = await req.json()
    if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 })

    const result = await runGEOAudit(url)

    if (saveResult) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      const authHeader = req.headers.get('authorization')
      if (authHeader) {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
        if (user) {
          await supabase.from('geo_audits').insert({
            user_id: user.id,
            url: result.url,
            composite_score: result.compositeScore,
            grade: result.grade,
            signals: result.signals,
            top_fixes: result.topFixes,
            audited_at: result.auditedAt
          })
        }
      }
    }

    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
