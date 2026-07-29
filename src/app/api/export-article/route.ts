/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import JSZip from 'jszip'
import { isSafePublicUrl } from '@/lib/fetch-page-content'

export const maxDuration = 60

interface ExportRequest {
  articleHtml: string
  title?: string
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024   // 10MB per image
const MAX_TOTAL_BYTES = 40 * 1024 * 1024   // 40MB per package
const MAX_IMAGES = 20

function extractImageUrls(html: string): Array<{ url: string; alt: string }> {
  const images: Array<{ url: string; alt: string }> = []
  const seen = new Set<string>()
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let match

  while ((match = imgRegex.exec(html)) !== null) {
    const fullTag = match[0]
    const url = match[1]
    // The same image can appear more than once — download it only once.
    if (seen.has(url)) continue
    seen.add(url)
    const altMatch = fullTag.match(/alt=["']([^"']*)["']/i)
    images.push({ url, alt: altMatch ? altMatch[1] : '' })
  }

  return images
}

function extractSchemaBlocks(html: string): any[] {
  const blocks: any[] = []
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()))
    } catch {
      // skip malformed blocks
    }
  }
  return blocks
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<figure[^>]*>/gi, '\n')
    .replace(/<\/figure>/gi, '\n')
    .replace(/<figcaption[^>]*>/gi, '[Image: ')
    .replace(/<\/figcaption>/gi, ']\n')
    .replace(/<h1[^>]*>/gi, '\n\n# ')
    .replace(/<\/h1>/gi, '\n')
    .replace(/<h2[^>]*>/gi, '\n\n## ')
    .replace(/<\/h2>/gi, '\n')
    .replace(/<h3[^>]*>/gi, '\n\n### ')
    .replace(/<\/h3>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '')
  return s || 'article'
}

// Pollinations and most CDNs serve jpeg/png/webp — derive the real extension
// from the response rather than assuming .jpg.
function extensionFor(contentType: string | null): string {
  if (!contentType) return 'jpg'
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('svg')) return 'svg'
  return 'jpg'
}

// Escape a string for safe use inside a RegExp
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value } } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { articleHtml, title }: ExportRequest = await req.json()

    if (!articleHtml || !articleHtml.trim()) {
      return NextResponse.json({ error: 'articleHtml is required' }, { status: 400 })
    }

    const zip = new JSZip()
    const imagesFolder = zip.folder('images')
    const slug = slugify(title || 'article')

    const images = extractImageUrls(articleHtml).slice(0, MAX_IMAGES)
    let modifiedHtml = articleHtml
    const imageManifest: Array<{ original: string; local: string; alt: string; failed: boolean; note?: string }> = []
    let totalBytes = 0

    for (let i = 0; i < images.length; i++) {
      const { url, alt } = images[i]

      // This route fetches caller-supplied URLs — refuse local-network targets.
      if (!isSafePublicUrl(url)) {
        imageManifest.push({ original: url, local: url, alt, failed: true, note: 'blocked (not a public http/https URL)' })
        continue
      }

      if (totalBytes >= MAX_TOTAL_BYTES) {
        imageManifest.push({ original: url, local: url, alt, failed: true, note: 'skipped (package size limit reached)' })
        continue
      }

      try {
        const imgRes = await fetch(url, { signal: AbortSignal.timeout(20000) })
        if (!imgRes.ok) {
          imageManifest.push({ original: url, local: url, alt, failed: true, note: `HTTP ${imgRes.status}` })
          continue
        }

        const buffer = await imgRes.arrayBuffer()
        if (buffer.byteLength > MAX_IMAGE_BYTES) {
          imageManifest.push({ original: url, local: url, alt, failed: true, note: 'too large' })
          continue
        }

        const ext = extensionFor(imgRes.headers.get('content-type'))
        const filename = i === 0 ? `hero.${ext}` : `content-${i}.${ext}`

        imagesFolder?.file(filename, buffer)
        totalBytes += buffer.byteLength
        imageManifest.push({ original: url, local: `images/${filename}`, alt, failed: false })

        // Rewrite every occurrence of this exact URL (src, srcset, og:image, …)
        modifiedHtml = modifiedHtml.split(url).join(`images/${filename}`)
      } catch (err) {
        // One bad image must not break the whole export.
        imageManifest.push({
          original: url,
          local: url,
          alt,
          failed: true,
          note: err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'download failed'
        })
      }
    }

    // Local files have no responsive size variants, so a surviving srcset would
    // point back at the remote host and defeat the purpose of the package.
    // Drop srcset/sizes from any <img> that now references a local file.
    for (const entry of imageManifest) {
      if (entry.failed) continue
      const localRef = escapeRegExp(entry.local)
      modifiedHtml = modifiedHtml.replace(
        new RegExp(`<img([^>]*${localRef}[^>]*)>`, 'gi'),
        (tag) => tag.replace(/\s+(srcset|sizes)=["'][^"']*["']/gi, '')
      )
    }

    const downloaded = imageManifest.filter(i => !i.failed)
    const failed = imageManifest.filter(i => i.failed)

    zip.file('article.html', modifiedHtml)
    zip.file('article.txt', htmlToPlainText(articleHtml))

    const schemaBlocks = extractSchemaBlocks(articleHtml)
    zip.file('schema.json', JSON.stringify(schemaBlocks, null, 2))

    const readme = `SEORANKO Article Export
========================

Title: ${title || 'Untitled'}
Exported: ${new Date().toISOString()}

FILES IN THIS PACKAGE:
- article.html   → Full HTML with images pointing to the local /images/ folder.
                   Ready to paste into WordPress, Webflow, or any CMS.
- article.txt    → Clean plain-text version for docs, email, or manual review.
- schema.json    → The JSON-LD structured data blocks (${schemaBlocks.length} found),
                   separated for easy insertion into your CMS's custom schema field.
- images/        → ${downloaded.length} image${downloaded.length === 1 ? '' : 's'} downloaded locally.

IMAGES:
${imageManifest.length === 0
  ? '(no images found in this article)'
  : imageManifest.map((img, i) =>
      `${i + 1}. ${img.local}${img.failed ? `  ← NOT DOWNLOADED (${img.note}) — still points at the remote URL` : ''}`
    ).join('\n')}
${failed.length > 0
  ? `\nWARNING: ${failed.length} image${failed.length === 1 ? '' : 's'} could not be downloaded and still reference${failed.length === 1 ? 's' : ''} the original remote URL in article.html. Those will break if the remote host goes away.`
  : ''}

NOTE: If you're uploading to WordPress, use the Media Library to upload
the images first, then update the src="images/..." paths in article.html
to match your WordPress media URLs, OR use a plugin that supports relative
image paths in pasted HTML.
`
    zip.file('README.txt', readme)

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

    return new NextResponse(zipBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(zipBuffer.length),
        'Content-Disposition': `attachment; filename="${slug}.zip"`
      }
    })

  } catch (error) {
    console.error('[export-article]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
