// src/lib/table-of-contents.ts
// Deterministic post-processing, not an LLM instruction — matches this
// codebase's established pattern for anything requiring precise HTML
// structure (image injection, schema patching, merge-artifact repair all
// work the same way). Asking the model to also emit exact-matching
// href="#slug"/id="slug" pairs inside an already word-budget-constrained
// output is a reliability risk for no benefit; slugifying real H2 text
// after the fact is trivial and always correct.

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-')
}

function buildTableOfContents(headings: { text: string; slug: string }[]): string {
  const items = headings
    .map(h => `<li><a href="#${h.slug}">${h.text}</a></li>`)
    .join('\n')

  return `<nav class="article-toc" style="background:#F5F4F1;border-radius:8px;padding:16px 20px;margin:1.5rem 0;">
<p style="font-weight:600;font-size:13px;margin-bottom:8px;">On this page</p>
<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8;">
${items}
</ul>
</nav>`
}

// Only meaningful for longer articles — short ones don't need a jump menu,
// it would just add clutter above the actual content.
const TOC_WORD_THRESHOLD = 1800

export function insertTableOfContents(html: string, wordCount: number, threshold = TOC_WORD_THRESHOLD): string {
  if (wordCount < threshold) return html

  const h2Regex = /<h2([^>]*)>([\s\S]*?)<\/h2>/gi
  const headings: { text: string; slug: string }[] = []
  const usedSlugs = new Set<string>()

  // Skip the FAQ heading — it's not a navigable content section, it's a
  // block of individually-scannable Q&A pairs right below it.
  let result = html.replace(h2Regex, (fullMatch, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim()
    if (!text || text.toLowerCase() === 'frequently asked questions') return fullMatch

    let slug = slugify(text)
    let n = 2
    while (usedSlugs.has(slug)) { slug = `${slugify(text)}-${n}`; n++ }
    usedSlugs.add(slug)
    headings.push({ text, slug })

    return attrs.includes('id=')
      ? fullMatch
      : `<h2${attrs} id="${slug}">${inner}</h2>`
  })

  if (headings.length === 0) return html

  const toc = buildTableOfContents(headings)
  const firstH2Pos = result.search(/<h2[\s>]/i)
  result = firstH2Pos !== -1
    ? result.slice(0, firstH2Pos) + toc + '\n' + result.slice(firstH2Pos)
    : result

  return result
}
