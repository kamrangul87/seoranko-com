// src/lib/schema-generator.ts
// Auto-generates JSON-LD schema markup for every SEORANKO article
// Covers: Article, FAQPage, HowTo (when applicable), BreadcrumbList, Organization
// Research: Proper JSON-LD lifts LLM extraction accuracy from 16% to 54%
//
// Typed with schema-dts (WithContext<Article>, WithContext<Organization>) so a
// property name/shape mistake is a compile error instead of a silent typo in a
// plain object literal — the previous implementation had no compile-time check
// against schema.org's actual vocabulary at all.

import type {
  Article as ArticleSchema,
  Organization as OrganizationSchema,
  FAQPage as FAQPageSchema,
  HowTo as HowToSchema,
  BreadcrumbList as BreadcrumbListSchema,
  Person,
  WithContext,
} from 'schema-dts'

export interface ArticleSchemaInput {
  title: string
  description: string           // meta description / article summary
  keyword: string               // primary target keyword
  authorName: string            // from user profile
  authorUrl?: string            // optional author page URL
  publishDate: string           // ISO 8601 date string
  dateModified?: string         // ISO 8601 date string — accurate "last verified" date when
                                 // dated-claim-detector.ts found dated claims; falls back to publishDate
  articleUrl: string            // canonical URL
  imageUrl?: string             // featured image if generated
  wordCount: number
  faqs?: Array<{ question: string; answer: string }>
  isHowTo?: boolean
  howToSteps?: Array<{ name: string; text: string }>
  organizationName?: string
  organizationUrl?: string
  organizationLogoUrl?: string   // from brand_settings.logo_url — see src/lib/brand-settings.ts
  market?: string                // e.g. 'United Kingdom' — used to set inLanguage
}

// Maps the market values used across the product (ArticleWriter.tsx's
// dropdown, rank-tracker.ts's LOCATION_CODES) to a BCP-47 language tag for
// schema's inLanguage field. Falls back to generic 'en' for any market not
// listed here, rather than omitting inLanguage entirely (a recommended
// schema.org property) or defaulting to one specific country's tag.
const MARKET_LANGUAGE_TAGS: Record<string, string> = {
  'united kingdom': 'en-GB',
  'united states': 'en-US',
  'australia': 'en-AU',
  'canada': 'en-CA',
  'india': 'en-IN',
  'pakistan': 'en-PK',
  'united arab emirates': 'en-AE',
  'singapore': 'en-SG',
  'germany': 'de-DE',
  'france': 'fr-FR',
  'south africa': 'en-ZA',
  'nigeria': 'en-NG',
  'new zealand': 'en-NZ',
  'ireland': 'en-IE',
}
export function languageTagForMarket(market?: string): string {
  if (!market) return 'en'
  return MARKET_LANGUAGE_TAGS[market.trim().toLowerCase()] || 'en'
}

// Resolves a brand-agnostic Organization.logo candidate when brand_settings
// has none configured: Clearbit's public logo API (no key required) serves a
// best-effort logo for any domain, keyed only on the domain itself — no
// market or brand-specific assumption. This is a CANDIDATE URL only, never
// fetched/verified here (a network call during article save is its own
// failure mode); schema-validate.ts checks it's a structurally valid https
// URL, not that the image actually exists or meets Google's size guidance.
function deriveLogoUrlFromDomain(organizationUrl?: string): string | undefined {
  if (!organizationUrl) return undefined
  try {
    const host = new URL(organizationUrl).hostname.replace(/^www\./, '')
    return host ? `https://logo.clearbit.com/${host}` : undefined
  } catch {
    return undefined
  }
}

function isAbsoluteHttpsUrl(url: string | undefined): url is string {
  return !!url && /^https:\/\/\S+/i.test(url)
}

export interface GeneratedSchema {
  articleSchema: string         // JSON-LD string for Article
  faqSchema: string | null      // JSON-LD string for FAQPage (if faqs provided)
  howToSchema: string | null    // JSON-LD string for HowTo (if isHowTo)
  breadcrumbSchema: string      // JSON-LD string for BreadcrumbList
  organizationSchema: string    // JSON-LD string for Organization
  combinedScriptTag: string     // Ready-to-paste <script> tag with all schemas
  imageUrl: string | undefined       // the exact Article.image URL emitted, for schema-validate.ts
  organizationLogoUrl: string | undefined // the exact Organization.logo URL emitted (candidate or real), for schema-validate.ts
  logoOmittedReason: string | undefined   // set + logged when logo was truly unresolvable
}

export function generateArticleSchema(input: ArticleSchemaInput): GeneratedSchema {
  const {
    title, description, keyword, authorName, authorUrl,
    publishDate, dateModified, articleUrl, imageUrl, wordCount,
    faqs, isHowTo, howToSteps, market,
    organizationName = 'SEORANKO',
    organizationUrl = 'https://seoranko.com',
  } = input

  // Resolution chain: brand_settings.logoUrl -> derive from brand domain ->
  // if truly unavailable, omit (but never silently — logged below).
  let organizationLogoUrl = input.organizationLogoUrl
  let logoOmittedReason: string | undefined
  if (!organizationLogoUrl) {
    organizationLogoUrl = deriveLogoUrlFromDomain(organizationUrl)
  }
  if (!organizationLogoUrl) {
    logoOmittedReason = `No brand_settings.logo_url configured and no organizationUrl to derive a candidate from (organizationUrl="${organizationUrl}") — Organization.logo omitted.`
    console.warn(`[schema-generator] ${logoOmittedReason}`)
  }

  // Article.image: bare absolute https URL — no 16:9/4:3/1:1 crop set exists
  // yet (image-generator.ts produces one hero size), so the array form isn't
  // populated with fabricated aspect ratios; this is upgraded automatically
  // once distinct crops are generated. Google's structured-data guidelines
  // accept a bare URL string here as well as an ImageObject/array.
  const articleImageUrl = isAbsoluteHttpsUrl(imageUrl) ? imageUrl : undefined

  const author: Person = {
    '@type': 'Person',
    name: authorName,
    ...(authorUrl ? { url: authorUrl } : {}),
  }

  const publisher: OrganizationSchema = {
    '@type': 'Organization',
    name: organizationName,
    url: organizationUrl,
    ...(organizationLogoUrl ? { logo: organizationLogoUrl } : {}),
  }

  const articleSchema: WithContext<ArticleSchema> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    keywords: keyword,
    wordCount,
    datePublished: publishDate,
    dateModified: dateModified || publishDate,
    url: articleUrl,
    inLanguage: languageTagForMarket(market),
    author,
    publisher,
    ...(articleImageUrl ? { image: articleImageUrl } : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
  }

  const faqSchema: WithContext<FAQPageSchema> | null = faqs && faqs.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question' as const,
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer' as const, text: faq.answer },
    })),
  } : null

  const howToSchema: WithContext<HowToSchema> | null = isHowTo && howToSteps && howToSteps.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: title,
    description,
    step: howToSteps.map((step, i) => ({
      '@type': 'HowToStep' as const,
      position: i + 1,
      name: step.name,
      text: step.text,
    })),
  } : null

  const breadcrumbSchema: WithContext<BreadcrumbListSchema> = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: organizationUrl },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${organizationUrl}/blog` },
      { '@type': 'ListItem', position: 3, name: title, item: articleUrl },
    ],
  }

  const organizationSchema: WithContext<OrganizationSchema> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: organizationName,
    url: organizationUrl,
    ...(organizationLogoUrl ? { logo: organizationLogoUrl } : {}),
    sameAs: [`${organizationUrl}/about`],
  }

  const schemas: object[] = [
    articleSchema,
    ...(faqSchema ? [faqSchema] : []),
    ...(howToSchema ? [howToSchema] : []),
    breadcrumbSchema,
    organizationSchema,
  ]

  const combinedScriptTag = schemas
    .map(schema => `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`)
    .join('\n')

  return {
    articleSchema: JSON.stringify(articleSchema, null, 2),
    faqSchema: faqSchema ? JSON.stringify(faqSchema, null, 2) : null,
    howToSchema: howToSchema ? JSON.stringify(howToSchema, null, 2) : null,
    breadcrumbSchema: JSON.stringify(breadcrumbSchema, null, 2),
    organizationSchema: JSON.stringify(organizationSchema, null, 2),
    combinedScriptTag,
    imageUrl: articleImageUrl,
    organizationLogoUrl,
    logoOmittedReason,
  }
}

// Helper: detect if article is a HowTo based on title/keyword
export function detectHowTo(title: string, keyword: string): boolean {
  const howToSignals = ['how to', 'how do i', 'how do you', 'step by step', 'guide to', 'tutorial', 'steps to']
  const combined = `${title} ${keyword}`.toLowerCase()
  return howToSignals.some(signal => combined.includes(signal))
}

// Standalone BreadcrumbList schema generator
export function generateBreadcrumbSchema(input: {
  siteUrl: string
  siteName: string
  blogUrl?: string
  articleTitle: string
  articleUrl: string
}): string {
  const { siteUrl, articleTitle, articleUrl } = input
  const blogUrl = input.blogUrl || `${siteUrl.replace(/\/$/, '')}/blog`

  const schema: WithContext<BreadcrumbListSchema> = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl.replace(/\/$/, '') },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: blogUrl },
      { '@type': 'ListItem', position: 3, name: articleTitle, item: articleUrl },
    ],
  }

  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`
}

export interface OrganisationInput {
  name: string
  url: string
  description?: string
  logoUrl?: string
  foundingYear?: number
  sameAs: string[]
  contactEmail?: string
  addressCountry?: string
}

export function generateOrganisationSchema(input: OrganisationInput): string {
  const schema: WithContext<OrganizationSchema> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: input.name,
    url: input.url,
    sameAs: input.sameAs.filter(Boolean),
    ...(input.description ? { description: input.description } : {}),
    ...(input.logoUrl ? { logo: input.logoUrl } : {}),
    ...(input.foundingYear ? { foundingDate: String(input.foundingYear) } : {}),
    ...(input.contactEmail ? { email: input.contactEmail } : {}),
    ...(input.addressCountry ? { address: { '@type': 'PostalAddress', addressCountry: input.addressCountry } } : {}),
  }

  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`
}
