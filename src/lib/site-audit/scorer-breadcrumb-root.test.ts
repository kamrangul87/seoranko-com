import { describe, expect, it } from 'vitest'
import { scorePage, type PageSignals } from './scorer'

function signals(url: string, extra: Partial<PageSignals> = {}): PageSignals {
  return {
    url,
    fetchTimeMs: 100,
    httpStatus: 200,
    htmlSizeKb: 40,
    noindex: false,
    xRobotsNoindex: false,
    hasCanonical: true,
    canonicalUrl: url,
    title: 'Example',
    metaDescription: 'A reasonably long meta description for the fixture page content.',
    h1: 'Example',
    h1Count: 1,
    h2s: ['Section'],
    imagesWithoutAlt: 0,
    isHttps: true,
    hasViewport: true,
    hasOgTitle: true,
    hasOgDescription: true,
    hasOgImage: true,
    hasTwitterCard: true,
    wordCount: 800,
    internalLinks: 5,
    externalLinks: 1,
    hasOfficialSources: true,
    hasSchema: true,
    hasArticleSchema: false,
    hasFaqSchema: false,
    hasBreadcrumbSchema: false,
    hasOrgSchema: true,
    images: 1,
    hasFaq: false,
    hasInternalLinks: true,
    hasHsts: true,
    hasXFrameOptions: true,
    hasXContentTypeOptions: true,
    hasCSP: true,
    isCompressed: true,
    renderBlockingScripts: 0,
    imagesWithoutLazy: 0,
    imagesWithoutDimensions: 0,
    hasLangAttribute: true,
    paragraphCount: 8,
    avgSentenceLength: 14,
    hasHeadingHierarchyIssue: false,
    hasSpeakableSchema: false,
    hasPersonSchema: false,
    hasHowToSchema: false,
    hasQAStructure: false,
    poorAnchorTextCount: 0,
    answerBlockCount: 0,
    questionHeadingCount: 0,
    factDensityScore: 0,
    dateModifiedAge: null,
    hasAuthorByline: false,
    hasAuthorBio: false,
    hasExperienceSignals: false,
    hasProductSchema: false,
    hasAiImageLabel: false,
    deprecatedSchemas: [],
    ...extra,
  }
}

describe('breadcrumb-null-on-root regression (scorer)', () => {
  it('does not flag missing BreadcrumbList on homepage /', () => {
    const page = signals('https://example.com/')
    const result = scorePage(page, [page])
    expect(result.issues.filter((i) => /breadcrumb/i.test(i.message))).toHaveLength(0)
  })

  it('still flags missing BreadcrumbList on an inner page', () => {
    const page = signals('https://example.com/about')
    const result = scorePage(page, [page])
    expect(result.issues.some((i) => /BreadcrumbList/i.test(i.message))).toBe(true)
  })
})
