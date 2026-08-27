import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Article publish approve removed in SEO copilot pivot.', code: 'ARTICLE_PUBLISH_REMOVED' },
    { status: 410 },
  )
}
