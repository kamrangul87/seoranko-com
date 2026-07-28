/* eslint-disable @typescript-eslint/no-explicit-any */
// Resolves an articleId to actual article text.
//
// A RANKO diagnosis issue can point at either:
//   - `articles.id`                — generated in SEORANKO, full content in the DB
//   - `ranking_agent_articles.id`  — an externally tracked URL with no stored content
//
// Callers only have an id, so try the content table first and fall back to
// fetching the live page.

export interface LoadedArticle {
  content: string
  keyword: string
  /** Where the content came from — useful for messaging. */
  source: 'articles' | 'fetched'
}

export async function loadArticleContentById(
  supabase: any,
  articleId: string
): Promise<LoadedArticle | null> {
  // 1. Generated in SEORANKO — content lives in the articles table.
  const { data: article } = await supabase
    .from('articles')
    .select('content, keyword')
    .eq('id', articleId)
    .maybeSingle()

  if (article?.content) {
    return { content: article.content, keyword: article.keyword || '', source: 'articles' }
  }

  // 2. Externally tracked URL — fetch the live page.
  const { data: tracked } = await supabase
    .from('ranking_agent_articles')
    .select('article_url, keyword')
    .eq('id', articleId)
    .maybeSingle()

  if (!tracked?.article_url) return null

  try {
    const res = await fetch('/api/fetch-article-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tracked.article_url })
    })
    const data = await res.json()
    if (!res.ok || !data.content) return null
    return { content: data.content, keyword: tracked.keyword || '', source: 'fetched' }
  } catch {
    return null
  }
}

export const CONTENT_LOAD_FAILED_MESSAGE =
  "Couldn't fetch this article automatically — open it in Improve to paste the content manually."
