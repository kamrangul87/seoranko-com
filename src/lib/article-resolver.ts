/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/article-resolver.ts
// THE single source of truth for "given an ID, what is this article's
// actual current content?" — replaces every duplicated lookup across
// RANKO, Improve, Humanize, NLP, Content ROI, Topical Map.
//
// Never query `articles` or `ranking_agent_articles` for content outside
// this file.

import { fetchPageContent, isSafePublicUrl } from './fetch-page-content'

export interface ResolvedArticle {
  id: string
  source: 'local' | 'fetched-live' | 'unresolved'
  content: string | null
  title: string | null
  keyword: string | null
  url: string | null
  brand: string | null
  fetchError?: string
}

/**
 * Fetch a live page. Runs directly on the server; in the browser it routes
 * through /api/fetch-article-content because cross-origin fetches of an
 * arbitrary site are blocked by CORS.
 */
async function fetchLiveArticle(url: string): Promise<{ content: string; title: string } | null> {
  if (typeof window === 'undefined') {
    if (!isSafePublicUrl(url)) return null
    const content = await fetchPageContent(url, 20000)
    if (!content) return null
    return { content, title: '' }
  }

  try {
    const res = await fetch('/api/fetch-article-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    })
    const data = await res.json()
    if (!res.ok || !data.content) return null
    return { content: data.content, title: data.title || '' }
  } catch {
    return null
  }
}

// A stub/placeholder row shouldn't count as resolved content.
const MIN_LOCAL_CONTENT_CHARS = 200

export async function resolveArticle(
  supabase: any,
  articleId: string
): Promise<ResolvedArticle> {

  // Step 1 — a fully generated SEORANKO article?
  // maybeSingle(), not single(): single() errors when there are zero rows,
  // which is precisely the case that must fall through to step 2.
  const { data: local } = await supabase
    .from('articles')
    .select('id, content, title, keyword, article_url, brand')
    .eq('id', articleId)
    .maybeSingle()

  if (local?.content && local.content.trim().length > MIN_LOCAL_CONTENT_CHARS) {
    return {
      id: articleId,
      source: 'local',
      content: local.content,
      title: local.title,
      keyword: local.keyword,
      url: local.article_url,
      brand: local.brand
    }
  }

  // Step 2 — a tracked external URL with no local content?
  const { data: tracked } = await supabase
    .from('ranking_agent_articles')
    .select('id, article_url, keyword, title')
    .eq('id', articleId)
    .maybeSingle()

  if (tracked?.article_url) {
    const fetched = await fetchLiveArticle(tracked.article_url)
    if (fetched?.content) {
      return {
        id: articleId,
        source: 'fetched-live',
        content: fetched.content,
        title: fetched.title || tracked.title,
        keyword: tracked.keyword,
        url: tracked.article_url,
        brand: null
      }
    }
    return {
      id: articleId,
      source: 'unresolved',
      content: null,
      title: tracked.title,
      keyword: tracked.keyword,
      url: tracked.article_url,
      brand: null,
      fetchError: 'Could not fetch the live page — it may block automated requests.'
    }
  }

  return {
    id: articleId,
    source: 'unresolved',
    content: null,
    title: null,
    keyword: null,
    url: null,
    brand: null,
    fetchError: 'No article or tracked URL found for this ID.'
  }
}

/**
 * Content resolved from a live external page has no row to write back to.
 * Callers must not present an "automatic save" for these.
 */
export function isWritable(resolved: ResolvedArticle): boolean {
  return resolved.source === 'local'
}

export const EXTERNAL_NOT_WRITABLE_MESSAGE =
  "This URL isn't hosted in SEORANKO, so the fix can't be written back to it. Open it in Improve to get the rewritten version."
