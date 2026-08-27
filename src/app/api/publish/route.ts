import { NextResponse } from 'next/server'

/**
 * Auto-publish of generated articles removed in the SEO copilot pivot.
 * Publisher adapters remain in the repo for future CMS fix-push work,
 * but this endpoint no longer publishes AI-written articles.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Article auto-publish has been removed. SEORANKO no longer generates or publishes finished articles.',
      code: 'ARTICLE_PUBLISH_REMOVED',
      backupBranch: 'article-writing-feature-backup',
    },
    { status: 410 },
  )
}
