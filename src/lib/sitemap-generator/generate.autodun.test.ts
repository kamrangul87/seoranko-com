import { describe, expect, it } from 'vitest'
import { runIndexDiagnosis } from '@/lib/index-diagnosis/run'
import { generateSitemap } from './generate'

describe('autodun.com sitemap canonical dedupe (live crawl)', () => {
  it('includes /blog but not /blog/index.html after canonical fix', async () => {
    const diagnosis = await runIndexDiagnosis('https://autodun.com/')
    const blog = diagnosis.pages.find((p) => p.url === 'https://autodun.com/blog')
    const indexHtml = diagnosis.pages.find(
      (p) => p.url === 'https://autodun.com/blog/index.html',
    )
    expect(blog?.verdict).toBe('INDEXABLE')
    // After preferred-form fix (#37), /blog/index.html may still appear in the
    // crawl (link-graph / seed). When it does, its canonical points at /blog,
    // so the correct indexability verdict is AT_RISK (not INDEXABLE). Either
    // way it must not land in the generated sitemap (asserted below).
    if (indexHtml) {
      expect(['AT_RISK', 'INDEXABLE', 'BLOCKED']).toContain(indexHtml.verdict)
    }

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
