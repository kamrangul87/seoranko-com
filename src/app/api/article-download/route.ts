import { NextRequest } from 'next/server';
import { buildCanonicalTags } from '@/lib/canonical-builder';

export const maxDuration = 60;

// Strip SEORANKO internal comment markers from the raw stream HTML
function cleanArticleHtml(html: string): string {
  return html
    .replace(/<!--SEORANKO_[^>]*-->/g, '')
    .replace(/<!--SEORANKO_STAGE:[^>]*-->/g, '')
    .replace(/\n<!-- SEORANKO_SCORES:\{[\s\S]*?\} -->/g, '')
    .replace(/\n?<!--SEORANKO_[A-Z_]+(?:_START|_END)?-->/g, '')
    .replace(/\n?<!-- META:[\s\S]*?-->/g, '')
    .trim();
}

// Extract plain text title from H1
function extractTitle(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : 'Article';
}

// Build keyword slug for filename
function toSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// Fetch an image and return its base64 data URI, or null on failure
async function imageToDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString('base64');
    const ct = res.headers.get('content-type') || 'image/webp';
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

// Replace all img src attributes that point to Pollinations (or Supabase) with base64 data URIs
async function embedImages(html: string): Promise<{ html: string; embedded: number; failed: number }> {
  // Collect all unique src URLs
  const srcRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = srcRe.exec(html)) !== null) {
    const url = m[1];
    if (!url.startsWith('data:')) urls.add(url);
  }

  // Fetch all in parallel
  const entries = Array.from(urls);
  const dataUris = await Promise.all(entries.map(u => imageToDataUri(u)));
  const uriMap = new Map<string, string | null>();
  entries.forEach((u, i) => uriMap.set(u, dataUris[i]));

  let embedded = 0;
  let failed = 0;
  const replaced = html.replace(/<img([^>]+)src=["']([^"']+)["']([^>]*)>/gi, (_, pre, src, post) => {
    if (src.startsWith('data:')) return `<img${pre}src="${src}"${post}>`;
    const uri = uriMap.get(src);
    if (uri) { embedded++; return `<img${pre}src="${uri}"${post}>`; }
    failed++;
    return `<img${pre}src="${src}"${post}>`;
  });

  return { html: replaced, embedded, failed };
}

// Convert HTML to Markdown (lightweight, no external lib)
function htmlToMarkdown(html: string): string {
  return html
    // Remove script/style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `# ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `## ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `### ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `#### ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    // Bold / italic
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    // Links
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    // Images — use original URLs (not data URIs) for Markdown
    .replace(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)')
    .replace(/<img[^>]+alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*\/?>/gi, '![$1]($2)')
    .replace(/<img[^>]+src=["']([^"']+)["'][^>]*\/?>/gi, '![]($1)')
    // Figure captions
    .replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, (_, t) => `*${t.replace(/<[^>]+>/g, '').trim()}*\n\n`)
    // Figure wrappers
    .replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, '$1\n\n')
    // Lists
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '$1\n')
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '$1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${t.replace(/<[^>]+>/g, '').trim()}\n`)
    // Blockquotes
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => `> ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    // Paragraphs
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    // Horizontal rules
    .replace(/<hr[^>]*\/?>/gi, '\n---\n\n')
    // Line breaks
    .replace(/<br[^>]*\/?>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    // Clean up excessive blank lines
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

// Extract JSON-LD script blocks from HTML body (to move to head)
function extractJsonLd(html: string): { html: string; scripts: string } {
  const scripts: string[] = []
  const cleaned = html.replace(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, (match) => {
    scripts.push(match)
    return ''
  })
  return { html: cleaned, scripts: scripts.join('\n') }
}

// Wrap cleaned HTML in a proper standalone document
function wrapHtml(body: string, title: string, printOptimised = false, extraHeadContent = ''): string {
  const printCss = printOptimised ? `
    @media print {
      body { max-width: 100% !important; margin: 0 !important; padding: 0.5in !important; }
      figure { page-break-inside: avoid; }
      h2, h3 { page-break-after: avoid; }
      a[href]::after { content: " (" attr(href) ")"; font-size: 0.75em; color: #666; }
    }
    @page { margin: 0.75in; }` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
${extraHeadContent ? extraHeadContent + '\n' : ''}  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Georgia, serif;
      font-size: 17px;
      line-height: 1.7;
      color: #1a1a1a;
      max-width: 760px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }
    h1 { font-size: 2em; line-height: 1.25; margin: 0 0 1rem; }
    h2 { font-size: 1.4em; margin: 2.5rem 0 0.75rem; }
    h3 { font-size: 1.15em; margin: 2rem 0 0.5rem; }
    p { margin: 0 0 1.25em; }
    a { color: #1a56db; }
    img { max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 0 auto; }
    figure { margin: 1.5rem 0; }
    figcaption { text-align: center; font-size: 0.85em; color: #666; margin-top: 0.5rem; }
    ul, ol { margin: 0 0 1.25em; padding-left: 1.75em; }
    li { margin-bottom: 0.35em; }
    table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; }
    th, td { border: 1px solid #ddd; padding: 0.6rem 0.9rem; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    blockquote { border-left: 4px solid #e5e7eb; margin: 1.5rem 0; padding: 0.5rem 1.25rem; color: #555; }
    code { background: #f1f5f9; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; }
    pre { background: #1e293b; color: #e2e8f0; padding: 1rem 1.25rem; border-radius: 6px; overflow-x: auto; }
    .author-bio { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem 1.25rem; margin-top: 3rem; }
    .byline { color: #666; font-size: 0.9em; margin-top: -0.5rem; margin-bottom: 1.5rem; }
    ${printCss}
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      articleHtml = '',
      format = 'html',
      keyword = 'article',
      downloadImages = true,
      schemaScriptTag = '',
      articleUrl = '',
      authorName = 'Author',
      metaDescription = '',
    } = body as {
      articleHtml: string;
      format: 'html' | 'zip' | 'markdown' | 'pdf';
      keyword: string;
      downloadImages: boolean;
      schemaScriptTag?: string;
      articleUrl?: string;
      authorName?: string;
      metaDescription?: string;
    };

    if (!articleHtml) {
      return new Response(JSON.stringify({ error: 'articleHtml is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanedHtml = cleanArticleHtml(articleHtml);
    const title = extractTitle(cleanedHtml);
    const slug = toSlug(keyword || title);

    // Extract existing JSON-LD from article body + merge with generated schema
    const { html: bodyWithoutLd, scripts: existingLd } = extractJsonLd(cleanedHtml);

    // Build canonical tags if an article URL was provided
    const canonicalTags = articleUrl
      ? buildCanonicalTags({
          articleUrl,
          title,
          description: metaDescription || `Article about ${keyword}`,
          publishDate: new Date().toISOString(),
          authorName: authorName || 'Author',
        })
      : ''

    const headSchemas = [canonicalTags, existingLd, schemaScriptTag].filter(Boolean).join('\n');

    // ── Markdown ──────────────────────────────────────────────────────────
    if (format === 'markdown') {
      const today = new Date().toISOString().split('T')[0];
      const md = htmlToMarkdown(bodyWithoutLd);
      const schemaComment = headSchemas ? `\n\n<!-- SCHEMA\n${headSchemas}\n-->` : '';
      const frontmatter = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ndate: ${today}\nauthor: Kamran Gul\nkeyword: "${keyword}"\n---\n\n`;
      const content = frontmatter + md + schemaComment;
      return new Response(content, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${slug}.md"`,
        },
      });
    }

    // ── HTML (clean, no images embedded) ─────────────────────────────────
    if (format === 'html') {
      const wrapped = wrapHtml(bodyWithoutLd, title, false, headSchemas);
      return new Response(wrapped, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${slug}.html"`,
        },
      });
    }

    // ── Print/PDF — same as html but with print CSS ───────────────────────
    if (format === 'pdf') {
      const wrapped = wrapHtml(bodyWithoutLd, title, true, headSchemas);
      return new Response(wrapped, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `inline; filename="${slug}-print.html"`,
        },
      });
    }

    // ── ZIP / self-contained (base64-embed all images) ────────────────────
    // format === 'zip' → single fully self-contained HTML with images as data URIs
    let finalHtml = bodyWithoutLd;
    let embeddedCount = 0;
    let failedCount = 0;

    if (downloadImages) {
      const result = await embedImages(bodyWithoutLd);
      finalHtml = result.html;
      embeddedCount = result.embedded;
      failedCount = result.failed;
      console.log(`[article-download] embedded ${embeddedCount} images, ${failedCount} failed`);
    }

    const wrapped = wrapHtml(finalHtml, title, false, headSchemas);
    const filename = `${slug}-selfcontained.html`;

    return new Response(wrapped, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Images-Embedded': String(embeddedCount),
        'X-Images-Failed': String(failedCount),
      },
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[article-download]', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Download failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
