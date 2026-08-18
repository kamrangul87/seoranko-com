import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadPublishedArticle } from '@/lib/public-article-loader'
import { extractRenderableBody } from '@/lib/content-render'
import { languageTagForMarket } from '@/lib/schema-generator'
import { getBrandSettings } from '@/lib/brand-settings'

// Server component. No model call anywhere in this file — renders exactly
// what the write pipeline already generated and saved.
export const dynamic = 'force-dynamic'

interface PageParams {
  params: { brand: string; slug: string }
}

// Fresh brand_settings.logo_url can change after an article was generated
// (a client sets/updates their logo later) — patch the stored schema_json's
// Organization.logo with the current value rather than the one frozen at
// generation time, per M07. No model call: a single indexed lookup.
async function resolveSchemaJson(article: Awaited<ReturnType<typeof loadPublishedArticle>>) {
  if (!article) return []
  const schemas = article.article.schemaJson || []
  let freshLogoUrl: string | undefined
  try {
    const settings = await getBrandSettings(article.article.userId, article.brand)
    freshLogoUrl = settings.logoUrl || undefined
  } catch {
    // brand_settings lookup failure must not break the page — fall back to
    // whatever was already resolved and stored at generation time.
  }
  if (!freshLogoUrl) return schemas
  return schemas.map((s: Record<string, unknown>) =>
    s['@type'] === 'Organization' ? { ...s, logo: freshLogoUrl } : s
  )
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const loaded = await loadPublishedArticle(params.brand, params.slug)
  if (!loaded) return {}

  const { article, publicUrl } = loaded
  const title = article.title
  const description = article.metaDescription || ''
  const locale = languageTagForMarket(article.market || undefined)

  return {
    title,
    description,
    alternates: { canonical: publicUrl },
    // Google dropped FAQ rich results in May 2026 — the FAQPage schema
    // still validates and helps AI-answer citation, but nothing here
    // advertises it as a rich-snippet feature.
    openGraph: {
      type: 'article',
      title,
      description,
      url: publicUrl,
      locale,
      ...(article.heroImageUrl ? { images: [{ url: article.heroImageUrl, width: 1200, height: 630 }] } : {}),
      modifiedTime: article.updatedAt,
      publishedTime: article.createdAt,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(article.heroImageUrl ? { images: [article.heroImageUrl] } : {}),
    },
    robots: { index: true, follow: true },
  }
}

export default async function PublicArticlePage({ params }: PageParams) {
  const loaded = await loadPublishedArticle(params.brand, params.slug)
  if (!loaded) notFound()

  const { article } = loaded
  const bodyHtml = extractRenderableBody(article.content)
  const schemaJson = await resolveSchemaJson(loaded)

  return (
    <>
      {schemaJson.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
      <article dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </>
  )
}
