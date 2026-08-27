import { NextResponse } from 'next/server'

/**
 * Article generation removed in the SEO copilot pivot.
 * Full Write pipeline preserved on branch `article-writing-feature-backup`
 * (see article-writing-feature-backup.zip).
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Article generation has been removed. Use /dashboard/audit and /dashboard/briefs instead.',
      code: 'ARTICLE_GENERATION_REMOVED',
      backupBranch: 'article-writing-feature-backup',
    },
    { status: 410 },
  )
}

export async function GET() {
  return POST()
}
