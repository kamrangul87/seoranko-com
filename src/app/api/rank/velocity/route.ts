import { NextRequest, NextResponse } from 'next/server'
import { predictRankingVelocity } from '@/lib/velocity-predictor'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const { articleId, keyword, targetPosition = 10 } = await req.json()
    if (!articleId || !keyword) {
      return NextResponse.json({ error: 'articleId and keyword required' }, { status: 400 })
    }
    const prediction = await predictRankingVelocity(articleId, keyword, targetPosition)
    return NextResponse.json({ success: true, prediction })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
