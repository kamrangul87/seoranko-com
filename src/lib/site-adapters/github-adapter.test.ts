import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { findBestGithubSourceMatch } from './github-adapter'

const autodunLikeTree = [
  'index.html',
  'README.md',
  'public/index.html',
  'public/contact/index.html',
  'public/about/index.html',
  'public/blog/index.html',
  'public/blog/mot-cost-uk-2026.html',
  'public/blog/ulez-checker-uk.html',
  'content/autodun-contact.html',
  'src/app/page.tsx',
  'src/app/contact/page.tsx',
].map((path) => ({ path }))

describe('GitHub source URL matching', () => {
  it('maps site root to root index.html (not a nested index)', () => {
    const hit = findBestGithubSourceMatch(autodunLikeTree, 'https://example.com/')
    expect(hit?.path).toBe('index.html')
  })

  it('maps /contact to public/contact/index.html directory indexes', () => {
    const hit = findBestGithubSourceMatch(autodunLikeTree, 'https://example.com/contact')
    expect(hit?.path).toBe('public/contact/index.html')
  })

  it('maps blog slug URLs to public/blog/*.html', () => {
    const hit = findBestGithubSourceMatch(
      autodunLikeTree,
      'https://example.com/blog/mot-cost-uk-2026',
    )
    expect(hit?.path).toBe('public/blog/mot-cost-uk-2026.html')
  })

  it('never selects .tsx component sources', () => {
    const hit = findBestGithubSourceMatch(autodunLikeTree, 'https://example.com/contact')
    expect(hit?.path).not.toMatch(/\.tsx$/)
  })
})

describe('Settings multi-CMS connect UI', () => {
  it('ConnectSiteModal exposes every supported platform, not only Universal Tag', () => {
    const src = readFileSync(join(__dirname, '../../components/ConnectSiteModal.tsx'), 'utf8')
    expect(src).toMatch(/github/)
    expect(src).toMatch(/wordpress/)
    expect(src).toMatch(/shopify/)
    expect(src).toMatch(/webflow/)
    expect(src).toMatch(/universal-tag/)
    expect(src).toMatch(/Connection type/)
    expect(src).toMatch(/Change connection|Switch to/)
    // No silent autodun-specific defaults in placeholders
    expect(src).not.toMatch(/placeholder: 'autodun/)
  })

  it('SitesManager wires Change connection with current cms_type', () => {
    const src = readFileSync(join(__dirname, '../../components/SitesManager.tsx'), 'utf8')
    expect(src).toMatch(/Change connection/)
    expect(src).toMatch(/currentCmsType/)
    expect(src).toMatch(/ConnectSiteModal/)
  })

  it('site-adapters registry still includes all five platforms', () => {
    const src = readFileSync(join(__dirname, './index.ts'), 'utf8')
    expect(src).toMatch(/wordpressAdapter/)
    expect(src).toMatch(/shopifyAdapter/)
    expect(src).toMatch(/webflowAdapter/)
    expect(src).toMatch(/githubAdapter/)
    expect(src).toMatch(/createUniversalTagAdapter/)
    expect(src).toMatch(/'github'/)
  })
})
