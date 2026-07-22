import { NextRequest, NextResponse } from 'next/server'
import { analyzeSERPIntent } from '@/lib/serp-intent'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { keyword, locationCode = 2840, userContentType = 'informational' } = await req.json()
    if (!keyword) {
      return NextResponse.json({ error: 'keyword required' }, { status: 400 })
    }
    const result = await analyzeSERPIntent(keyword, userContentType, locationCode)
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
