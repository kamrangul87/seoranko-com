import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { publishArticle } from '@/lib/article-publisher'
import { publishHostedArticle } from '@/lib/publish-hosted-flow'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // "hosted" is a fifth destination alongside the existing siteId-scoped
    // CMS adapters below — routed through its own publish-hosted-flow.ts,
    // which does not touch article-publisher.ts / publish-safeguards.ts at
    // all. Existing WordPress/Shopify/Webflow/GitHub/Universal Tag behavior
    // (the siteId branch) is unchanged.
    if (body.destination === 'hosted') {
      const { articleId, humanReviewConfirmed } = body
      if (!articleId) {
        return NextResponse.json({ success: false, message: 'articleId is required.' }, { status: 400 })
      }
      const result = await publishHostedArticle({
        supabase,
        userId: user.id,
        articleId,
        humanReviewConfirmed: !!humanReviewConfirmed,
      })
      return NextResponse.json(result, { status: result.success ? 200 : 400 })
    }

    const { articleId, siteId } = body
    if (!articleId || !siteId) {
      return NextResponse.json({ success: false, message: 'articleId and siteId are required.' }, { status: 400 })
    }

    const result = await publishArticle({ supabase, userId: user.id, articleId, siteId })
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    console.error('[publish]', error)
    return NextResponse.json({ success: false, message: String(error) }, { status: 500 })
  }
}
