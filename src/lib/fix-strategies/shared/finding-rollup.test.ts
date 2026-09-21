import { describe, expect, it } from 'vitest'
import {
  classifyDeclarationSite,
  isCollapsibleDeclarationSite,
} from './declaration-site'
import { rollupFindingsByDeclarationSite } from './finding-rollup'

describe('declaration-site classification', () => {
  it('classifies layouts, components, generators, pages', () => {
    expect(classifyDeclarationSite('app/layout.tsx')).toBe('shared-layout')
    expect(classifyDeclarationSite('components/ArticleJsonLd.tsx')).toBe(
      'shared-component',
    )
    expect(classifyDeclarationSite('generator:blog-jsonld')).toBe('generator')
    expect(classifyDeclarationSite('config:next.config.js')).toBe(
      'shared-config',
    )
    expect(classifyDeclarationSite('next.config.mjs')).toBe('shared-config')
    expect(classifyDeclarationSite('app/blog/[slug]/page.tsx')).toBe('page')
    expect(classifyDeclarationSite(null)).toBe('unknown')
  })

  it('marks shared kinds collapsible', () => {
    expect(isCollapsibleDeclarationSite('shared-layout')).toBe(true)
    expect(isCollapsibleDeclarationSite('generator')).toBe(true)
    expect(isCollapsibleDeclarationSite('shared-config')).toBe(true)
    expect(isCollapsibleDeclarationSite('page')).toBe(false)
    expect(isCollapsibleDeclarationSite('unknown')).toBe(false)
  })
})

describe('rollupFindingsByDeclarationSite', () => {
  it('collapses topic 38 entity-url findings from one generator', () => {
    const pages = [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]
    const input = pages.map((pageUrl) => ({
      topicId: '38',
      verdict: 'human-review-entity-url-mismatch',
      pageUrl,
      declarationSite: 'generator:article-jsonld',
      detail: 'entity url ≠ page',
    }))
    const out = rollupFindingsByDeclarationSite(input)
    expect(out).toHaveLength(1)
    expect(out[0]!.rolledUp).toBe(true)
    expect(out[0]!.affectedUrlCount).toBe(3)
    expect(out[0]!.memberUrls).toEqual(pages)
    expect(out[0]!.detail).toMatch(/3 pages inherit/)
  })

  it('collapses topic 49 image findings from a shared component', () => {
    const input = [
      {
        topicId: '49',
        verdict: 'human-review-no-height-auto',
        pageUrl: 'https://example.com/p1',
        declarationSite: 'components/BlogImage.tsx',
      },
      {
        topicId: '49',
        verdict: 'human-review-no-height-auto',
        pageUrl: 'https://example.com/p2',
        declarationSite: 'components/BlogImage.tsx',
      },
      {
        topicId: '49',
        verdict: 'auto-set-dimensions',
        pageUrl: 'https://example.com/p1',
        declarationSite: 'components/BlogImage.tsx',
      },
    ]
    const out = rollupFindingsByDeclarationSite(input)
    // Two verdicts → two rolled groups
    expect(out).toHaveLength(2)
    const noHeight = out.find((f) => f.verdict === 'human-review-no-height-auto')
    expect(noHeight?.affectedUrlCount).toBe(2)
    expect(noHeight?.rolledUp).toBe(true)
    const auto = out.find((f) => f.verdict === 'auto-set-dimensions')
    expect(auto?.affectedUrlCount).toBe(1)
    expect(auto?.rolledUp).toBe(false)
  })

  it('does not collapse page-local or unknown declaration sites', () => {
    const input = [
      {
        topicId: '38',
        verdict: 'human-review-entity-url-mismatch',
        pageUrl: 'https://example.com/a',
        declarationSite: 'app/a/page.tsx',
      },
      {
        topicId: '38',
        verdict: 'human-review-entity-url-mismatch',
        pageUrl: 'https://example.com/b',
        declarationSite: 'app/b/page.tsx',
      },
      {
        topicId: '38',
        verdict: 'human-review-entity-url-mismatch',
        pageUrl: 'https://example.com/c',
        declarationSite: null,
      },
    ]
    const out = rollupFindingsByDeclarationSite(input)
    expect(out).toHaveLength(3)
    expect(out.every((f) => !f.rolledUp)).toBe(true)
  })
})
