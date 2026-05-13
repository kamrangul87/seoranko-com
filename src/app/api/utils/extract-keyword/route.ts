import { NextRequest, NextResponse } from 'next/server'
import { callClaude } from '@/lib/anthropic'

export async function POST(req: NextRequest) {
  let problem = ''
  try {
    const body = await req.json()
    problem = (body.problem ?? '').trim()
    if (!problem) return NextResponse.json({ error: 'problem is required' }, { status: 400 })

    const raw = await callClaude(
      'You are an SEO keyword expert. Extract a SHORT, HIGH-VOLUME keyword from a problem statement. Return ONLY the keyword — no punctuation, no explanation, no extra words.',
      `Extract a SHORT 2-3 word SEO keyword from this problem that has HIGH search volume on Google. Choose a BROAD, POPULAR version of the topic — not a niche long-tail phrase.

Rules:
- Maximum 3 words
- Must be something thousands of people search monthly
- Choose the BROADER topic, not the specific angle
- Think like someone typing quickly into Google

Examples:
Problem: "How do I know if a sofa will actually be comfortable long-term before buying online"
Keyword: sofa buying guide

Problem: "What are hidden costs of starting a food truck business in UK"
Keyword: food truck costs

Problem: "How do I exercise effectively when sitting 8-14 hours for work"
Keyword: exercise desk workers

Problem: "Best way to buy furniture online without seeing it in person"
Keyword: buy furniture online

Problem: "What profit margins can home bakery businesses expect selling on Instagram"
Keyword: home bakery profits

Problem: "${problem}"
Keyword:`,
      50
    )

    const keyword = raw.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    console.log(`[extract-keyword] "${problem.slice(0, 60)}…" → "${keyword}"`)
    return NextResponse.json({ keyword: keyword || problem.split(' ').slice(0, 3).join(' ') })
  } catch (err) {
    console.error('[extract-keyword] error:', err)
    return NextResponse.json({ keyword: problem.split(' ').slice(0, 3).join(' ') })
  }
}
