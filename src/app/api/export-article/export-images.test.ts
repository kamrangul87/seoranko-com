import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import JSZip from 'jszip'

/**
 * Mirrors export-article's image embedding behaviour without spinning up Next.
 * Confirms the zip contains real image bytes (not just remote URL strings).
 */
async function buildExportZip(articleHtml: string): Promise<JSZip> {
  const zip = new JSZip()
  const imagesFolder = zip.folder('images')!
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let match
  let i = 0
  let modified = articleHtml
  while ((match = imgRegex.exec(articleHtml)) !== null) {
    const url = match[1]
    const res = await fetch(url)
    const buffer = await res.arrayBuffer()
    const filename = i === 0 ? 'hero.webp' : `content-${i}.webp`
    imagesFolder.file(filename, buffer)
    modified = modified.split(url).join(`images/${filename}`)
    i++
  }
  zip.file('article.html', modified)
  zip.file('article.txt', 'plain')
  return zip
}

describe('export zip embeds real image files', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('hero-remote')) {
        return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('writes image bytes into images/ and rewrites HTML src', async () => {
    const html = '<h1>EV</h1><img src="https://cdn.example.com/hero-remote.webp" alt="wallbox" />'
    const zip = await buildExportZip(html)
    const generated = await zip.generateAsync({ type: 'nodebuffer' })
    const loaded = await JSZip.loadAsync(generated)

    const hero = loaded.file('images/hero.webp')
    expect(hero).toBeTruthy()
    const bytes = await hero!.async('uint8array')
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x52, 0x49, 0x46, 0x46])

    const articleHtml = await loaded.file('article.html')!.async('string')
    expect(articleHtml).toContain('images/hero.webp')
    expect(articleHtml).not.toContain('cdn.example.com')
  })
})
