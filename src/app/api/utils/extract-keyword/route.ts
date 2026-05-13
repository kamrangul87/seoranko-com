import { NextRequest, NextResponse } from 'next/server'
import { callClaude } from '@/lib/anthropic'

export async function POST(req: NextRequest) {
  let problem = ''
  try {
    const body = await req.json()
    problem = (body.problem ?? '').trim()
    if (!problem) return NextResponse.json({ error: 'problem is required' }, { status: 400 })

    const raw = await callClaude(
      'You are an SEO expert. Extract a short 2-4 word SEO keyword from a problem statement that someone would actually search on Google. Return ONLY the keyword — no punctuation, no explanation, no extra words.',
      `Extract a short 2-4 word SEO keyword from this problem statement that someone would actually search on Google. Return ONLY the keyword, nothing else.

Problem: "How do I know if a sofa will actually be comfortable long-term before buying it online without testing it first"
Keyword: buy sofa online

Problem: "What are the real profit margins for home bakery businesses selling through Instagram in 2024"
Keyword: home bakery profit margins

Problem: "How do I effectively exercise when I sit 8-14 hours per day for work without adding gym time"
Keyword: exercise for desk workers

Problem: "How much does it actually cost to start a food truck business in the UK with all hidden fees"
Keyword: food truck startup costs

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
