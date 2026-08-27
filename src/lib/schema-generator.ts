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
  ImageObject as ImageObjectSchema,
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

  // Resolution: brand_settings.logoUrl only — if truly unavailable, omit
  // (but never silently — logged below). There is deliberately no derived
  // fallback candidate here any more: this used to synthesize a
  // https://logo.clearbit.com/<host> URL when brand_settings had no logo,
  // but Clearbit's public Logo API was permanently shut down (2025-12-08,
  // support ended 2025-03-18) — that fallback returned a dead URL that
  // still passed a naive "logo field is present" check. A real logo must
  // come from brand_settings; there is no safe substitute to invent.
  const organizationLogoUrl = input.organizationLogoUrl
  let logoOmittedReason: string | undefined
  if (!organizationLogoUrl) {
    logoOmittedReason = `No brand_settings.logo_url configured for organizationUrl="${organizationUrl}" — Organization.logo omitted (no fallback is generated; a dead logo URL is worse than none).`
    console.warn(`[schema-generator] ${logoOmittedReason}`)
  }

  // Article.image: absolute https URL, array form — no 16:9/4:3/1:1 crop set
  // exists yet (image-generator.ts produces one hero size), so this is a
  // single-element array rather than fabricated aspect-ratio variants; this
  // upgrades automatically once distinct crops are generated. Google's own
  // reference examples use the array form even for a single image.
  const articleImageUrl = isAbsoluteHttpsUrl(imageUrl) ? imageUrl : undefined

  // Organization.logo MUST be an ImageObject, not a bare URL string — the
  // single most common way this field is emitted wrong per Google's
  // structured-data guidance, and confirmed as this codebase's actual prior
  // behavior (a plain `logo: "https://..."` string). No width/height: this
  // pipeline doesn't inspect the actual logo image's pixel dimensions (no
  // stored value, and fetching one during schema generation is its own
  // failure mode) — Google's ≥112x112px requirement on the real asset is
  // not independently re-verified here, only that a usable URL exists.
  const logoImageObject: ImageObjectSchema | undefined = organizationLogoUrl
    ? { '@type': 'ImageObject', url: organizationLogoUrl }
    : undefined

  const author: Person = {
    '@type': 'Person',
    name: authorName,
    ...(authorUrl ? { url: authorUrl } : {}),
  }

  const publisher: OrganizationSchema = {
    '@type': 'Organization',
    name: organizationName,
    url: organizationUrl,
    ...(logoImageObject ? { logo: logoImageObject } : {}),
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
    ...(articleImageUrl ? { image: [articleImageUrl] } : {}),
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
    ...(logoImageObject ? { logo: logoImageObject } : {}),
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
