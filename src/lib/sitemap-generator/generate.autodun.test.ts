import { describe, expect, it } from 'vitest'
import { runIndexDiagnosis } from '@/lib/index-diagnosis/run'
import { generateSitemap } from './generate'

describe('autodun.com sitemap canonical dedupe (live crawl)', () => {
  it('includes /blog but not /blog/index.html after canonical fix', async () => {
    const diagnosis = await runIndexDiagnosis('https://autodun.com/')
    const blog = diagnosis.pages.find((p) => p.url === 'https://autodun.com/blog')
    const indexHtml = diagnosis.pages.find((p) => p.url === 'https://autodun.com/blog/index.html')
    expect(blog?.verdict).toBe('INDEXABLE')
    expect(indexHtml?.verdict).toBe('INDEXABLE')

    const sitemap = generateSitemap({
      domain: diagnosis.coverage.domain,
      seedUrl: diagnosis.coverage.seedUrl,
      pages: diagnosis.pages,
      coverage: diagnosis.coverage,
      htmlByUrl: diagnosis.htmlByUrl,
      robotsTxt: diagnosis.robotsTxt || '',
      ranAt: diagnosis.ranAt,
      crawlSource: 'fresh',
    })

    const xml = sitemap.files.find((f) => f.filename === 'sitemap.xml')!.content
    expect(xml).toMatch(/<loc>https:\/\/autodun\.com\/blog<\/loc>/)
    expect(xml).not.toContain('blog/index.html')
  }, 60_000)
})
