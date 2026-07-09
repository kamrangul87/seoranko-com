// src/lib/schema-generator.ts
// Auto-generates JSON-LD schema markup for every SEORANKO article
// Covers: Article, FAQPage, HowTo (when applicable), BreadcrumbList, Organization
// Research: Proper JSON-LD lifts LLM extraction accuracy from 16% to 54%

export interface ArticleSchemaInput {
  title: string
  description: string           // meta description / article summary
  keyword: string               // primary target keyword
  authorName: string            // from user profile
  authorUrl?: string            // optional author page URL
  publishDate: string           // ISO 8601 date string
  articleUrl: string            // canonical URL
  imageUrl?: string             // featured image if generated
  wordCount: number
  faqs?: Array<{ question: string; answer: string }>
  isHowTo?: boolean
  howToSteps?: Array<{ name: string; text: string }>
  organizationName?: string
  organizationUrl?: string
}

export interface GeneratedSchema {
  articleSchema: string         // JSON-LD string for Article
  faqSchema: string | null      // JSON-LD string for FAQPage (if faqs provided)
  howToSchema: string | null    // JSON-LD string for HowTo (if isHowTo)
  breadcrumbSchema: string      // JSON-LD string for BreadcrumbList
  organizationSchema: string    // JSON-LD string for Organization
  combinedScriptTag: string     // Ready-to-paste <script> tag with all schemas
}

export function generateArticleSchema(input: ArticleSchemaInput): GeneratedSchema {
  const {
    title, description, keyword, authorName, authorUrl,
    publishDate, articleUrl, imageUrl, wordCount,
    faqs, isHowTo, howToSteps,
    organizationName = 'SEORANKO',
    organizationUrl = 'https://seoranko.com'
  } = input

  // Article schema (NewsArticle type for broader AI recognition)
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": title,
    "description": description,
    "keywords": keyword,
    "wordCount": wordCount,
    "datePublished": publishDate,
    "dateModified": publishDate,
    "url": articleUrl,
    "author": {
      "@type": "Person",
      "name": authorName,
      ...(authorUrl ? { "url": authorUrl } : {})
    },
    "publisher": {
      "@type": "Organization",
      "name": organizationName,
      "url": organizationUrl
    },
    ...(imageUrl ? {
      "image": {
        "@type": "ImageObject",
        "url": imageUrl
      }
    } : {}),
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": articleUrl
    }
  }

  // FAQ schema
  const faqSchema = faqs && faqs.length > 0 ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer
      }
    }))
  } : null

  // HowTo schema
  const howToSchema = isHowTo && howToSteps && howToSteps.length > 0 ? {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "name": title,
    "description": description,
    "step": howToSteps.map((step, i) => ({
      "@type": "HowToStep",
      "position": i + 1,
      "name": step.name,
      "text": step.text
    }))
  } : null

  // Breadcrumb schema
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": organizationUrl
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "Blog",
        "item": `${organizationUrl}/blog`
      },
      {
        "@type": "ListItem",
        "position": 3,
        "name": title,
        "item": articleUrl
      }
    ]
  }

  // Organization schema
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": organizationName,
    "url": organizationUrl,
    "sameAs": [
      `${organizationUrl}/about`
    ]
  }

  // Combine all into one script tag
  const schemas = [
    articleSchema,
    ...(faqSchema ? [faqSchema] : []),
    ...(howToSchema ? [howToSchema] : []),
    breadcrumbSchema,
    organizationSchema
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
    combinedScriptTag
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
  const { siteUrl, siteName, articleTitle, articleUrl } = input
  const blogUrl = input.blogUrl || `${siteUrl.replace(/\/$/, '')}/blog`
  void siteName

  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": siteUrl.replace(/\/$/, '')
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "Blog",
        "item": blogUrl
      },
      {
        "@type": "ListItem",
        "position": 3,
        "name": articleTitle,
        "item": articleUrl
      }
    ]
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
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": input.name,
    "url": input.url,
    "sameAs": input.sameAs.filter(Boolean)
  }

  if (input.description) schema["description"] = input.description
  if (input.logoUrl) {
    schema["logo"] = {
      "@type": "ImageObject",
      "url": input.logoUrl
    }
  }
  if (input.foundingYear) schema["foundingDate"] = String(input.foundingYear)
  if (input.contactEmail) schema["email"] = input.contactEmail
  if (input.addressCountry) {
    schema["address"] = {
      "@type": "PostalAddress",
      "addressCountry": input.addressCountry
    }
  }

  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`
}
