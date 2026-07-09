import { NextRequest, NextResponse } from 'next/server'
import { generateArticleImagesFromRequests, buildArticleImageRequests } from '@/lib/image-generator'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const { articleId, keyword, title, sections = [] } = await req.json()

    if (!keyword) {
      return NextResponse.json({ error: 'keyword is required' }, { status: 400 })
    }

    const requests = buildArticleImageRequests(keyword, title || keyword, sections)
    const results = await generateArticleImagesFromRequests(requests)

    const successful = results.filter(r => r.success)
    const failed = results.filter(r => !r.success)

    if (articleId && successful.length > 0) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      const imageMap = Object.fromEntries(
        successful.map(r => [`image_${r.slot}`, r.url])
      )

      await supabase
        .from('articles')
        .update({ ...imageMap, updated_at: new Date().toISOString() })
        .eq('id', articleId)
    }

    return NextResponse.json({
      success: true,
      generated: successful.length,
      failed: failed.length,
      results,
      message: `${successful.length} of ${requests.length} images generated`
    })

  } catch (error) {
    console.error('[regenerate-images]', error)
    return NextResponse.json(
      { error: 'Image generation failed', details: String(error) },
      { status: 500 }
    )
  }
}
