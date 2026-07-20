import { NextRequest, NextResponse } from 'next/server'
import { scoreWinnability } from '@/lib/winnability'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { keyword, locationCode = 2840 } = await req.json()
    if (!keyword) return NextResponse.json({ error: 'keyword required' }, { status: 400 })

    const result = await scoreWinnability(keyword, locationCode)

    // Cache to Supabase for learning loop
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('ranko_winnability_cache').upsert({
      keyword,
      location_code: locationCode,
      verdict: result.verdict,
      score: result.score,
      confidence: result.confidence,
      serp_composition: result.serpComposition,
      intent_match: result.intentMatch,
      checked_at: result.checkedAt
    }, { onConflict: 'keyword,location_code' })

    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
