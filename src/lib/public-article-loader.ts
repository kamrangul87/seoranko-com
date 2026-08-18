/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/public-article-loader.ts
// Shared DB read for the public blog route, its sitemap, and its llms.txt —
// one query shape, not three copies. Server-only (service role — the public
// route has no signed-in user, so RLS's auth.uid() = user_id would return
// nothing; these are public pages by design, gated on publications.state
// instead of ownership).

import { createClient } from '@supabase/supabase-js'
import { cache } from 'react'

function getPublicSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export interface PublishedArticle {
  publicationId: string
  state: string
  publicUrl: string
  publishedAt: string | null
  verifiedAt: string | null
  brand: string
  slug: string
  article: {
    id: string
    userId: string
    title: string
    metaDescription: string | null
    content: string
    keyword: string | null
    market: string | null
    schemaJson: any[] | null
    heroImageUrl: string | null
    faqs: Array<{ question: string; answer: string }> | null
    createdAt: string
    updatedAt: string
  }
}

// Only these two states are ever publicly reachable — a CREATED/
// BUILD_PENDING/FAILED row has nothing worth showing (or shows a stale/
// broken draft), matching the spec's own sitemap inclusion rule.
const PUBLIC_STATES = ['LIVE_UNVERIFIED', 'LIVE_VERIFIED']

export const loadPublishedArticle = cache(async (
  brand: string,
  slug: string,
): Promise<PublishedArticle | null> => {
  const supabase = getPublicSupabase()
  const { data } = await supabase
    .from('publications')
    .select(`
      id, state, public_url, published_at, verified_at, brand, slug,
      articles ( id, user_id, title, meta_description, content, keyword, market, schema_json, hero_image_url, faqs, created_at, updated_at )
    `)
    .eq('brand', brand)
    .eq('slug', slug)
    .eq('destination', 'hosted')
    .in('state', PUBLIC_STATES)
    .maybeSingle()

  if (!data || !data.articles) return null
  const a: any = data.articles

  return {
    publicationId: data.id,
    state: data.state,
    publicUrl: data.public_url,
    publishedAt: data.published_at,
    verifiedAt: data.verified_at,
    brand: data.brand,
    slug: data.slug,
    article: {
      id: a.id,
      userId: a.user_id,
      title: a.title,
      metaDescription: a.meta_description,
      content: a.content,
      keyword: a.keyword,
      market: a.market,
      schemaJson: a.schema_json,
      heroImageUrl: a.hero_image_url,
      faqs: a.faqs,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    },
  }
})

export const listPublishedForBrand = cache(async (brand: string): Promise<PublishedArticle[]> => {
  const supabase = getPublicSupabase()
  const { data } = await supabase
    .from('publications')
    .select(`
      id, state, public_url, published_at, verified_at, brand, slug,
      articles ( id, user_id, title, meta_description, content, keyword, market, schema_json, hero_image_url, faqs, created_at, updated_at )
    `)
    .eq('brand', brand)
    .eq('destination', 'hosted')
    .in('state', PUBLIC_STATES)
    .order('published_at', { ascending: false })
    .limit(5000)

  return (data || [])
    .filter((row: any) => row.articles)
    .map((row: any): PublishedArticle => ({
      publicationId: row.id,
      state: row.state,
      publicUrl: row.public_url,
      publishedAt: row.published_at,
      verifiedAt: row.verified_at,
      brand: row.brand,
      slug: row.slug,
      article: {
        id: row.articles.id,
        userId: row.articles.user_id,
        title: row.articles.title,
        metaDescription: row.articles.meta_description,
        content: row.articles.content,
        keyword: row.articles.keyword,
        market: row.articles.market,
        schemaJson: row.articles.schema_json,
        heroImageUrl: row.articles.hero_image_url,
        faqs: row.articles.faqs,
        createdAt: row.articles.created_at,
        updatedAt: row.articles.updated_at,
      },
    }))
})

export const listPublishedBrands = cache(async (): Promise<string[]> => {
  const supabase = getPublicSupabase()
  const { data } = await supabase
    .from('publications')
    .select('brand')
    .eq('destination', 'hosted')
    .in('state', PUBLIC_STATES)
    .limit(5000)
  return Array.from(new Set((data || []).map((r: any) => r.brand))).filter(Boolean) as string[]
})
