import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: 'Article write pipeline removed. Use /api/copilot/brief for guidance-only briefs.',
      code: 'ARTICLE_GENERATION_REMOVED',
    },
    { status: 410 },
  )
}
