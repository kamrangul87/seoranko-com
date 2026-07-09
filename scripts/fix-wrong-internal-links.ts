// Run once to remove wrongly placed internal links from non-SEO articles
// Usage: npx ts-node scripts/fix-wrong-internal-links.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function fixWrongLinks() {
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, content, keyword')
    .ilike('content', '%seoranko.com%')

  if (error) {
    console.error('Failed to fetch articles:', error)
    return
  }

  if (!articles?.length) {
    console.log('No articles with seoranko.com links found')
    return
  }

  console.log(`Found ${articles.length} articles with seoranko.com links`)

  for (const article of articles) {
    const kw = (article.keyword || '').toLowerCase()
    const isNonSEOArticle =
      !kw.includes('seo') &&
      !kw.includes('keyword') &&
      !kw.includes('content marketing') &&
      !kw.includes('rank')

    if (!isNonSEOArticle) {
      console.log(`Skipping article ${article.id} (keyword: ${article.keyword}) — SEO topic, link is valid`)
      continue
    }

    let fixed = article.content
      // Pattern 1: "resources like Seoranko cover X in useful detail"
      .replace(
        /For broader [^.]*,\s*<a[^>]*>resources like Seoranko<\/a>[^.]*\./gi,
        ''
      )
      // Pattern 2: Any anchor tag pointing to seoranko.com
      .replace(
        /<a[^>]*href=["']https?:\/\/seoranko\.com[^"']*["'][^>]*>[^<]*<\/a>/gi,
        'SEORANKO'
      )
      // Pattern 3: Remove sentences that now contain the orphaned SEORANKO text
      .replace(
        /[^.]*\bSEORANKO\b[^.]*\./g,
        ''
      )
      // Cleanup: empty paragraphs and double spaces
      .replace(/<p>\s*<\/p>/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()

    if (fixed !== article.content) {
      const { error: updateError } = await supabase
        .from('articles')
        .update({ content: fixed, updated_at: new Date().toISOString() })
        .eq('id', article.id)

      if (updateError) {
        console.error(`Failed to fix article ${article.id}:`, updateError)
      } else {
        console.log(`Fixed article ${article.id} (keyword: ${article.keyword})`)
      }
    } else {
      console.log(`Article ${article.id} — no changes needed`)
    }
  }

  console.log('Cleanup complete')
}

fixWrongLinks()
