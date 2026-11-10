/**
 * Professional related-reading anchors from the target H1/title (or path).
 * Never invent marketing copy; never emit 2-word stubs or colon-truncated titles.
 */

export const RELATED_TRANSFORM_VERSION = 2
export const RELATED_ANCHOR_MAX = 60

const DANGLING = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'for',
  'with',
  'on',
  'at',
  'by',
  'as',
  'vs',
  'via',
  'from',
  'into',
  'over',
  'about',
  'what',
  'how',
  'why',
  'who',
  '&',
])

const ACRONYMS = new Set(['uk', 'us', 'eu', 'ev', 'mot', 'dvsa', 'seo', 'faq'])

export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeHtmlAttr(s: string): string {
  return escapeHtmlText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function stripSiteSuffix(s: string): string {
  return collapseWs(s.split(/\s*[|—–•]\s*/)[0] || s)
}

function isDanglingToken(tok: string): boolean {
  const t = tok.replace(/[^\p{L}\p{N}%]+/gu, '')
  if (!t) return true
  return DANGLING.has(t.toLowerCase())
}

function stripDangling(s: string, dropShortTail = false): string {
  const t = collapseWs(s).replace(/[:;,\-–—/&]+$/g, '').trim()
  const words = t.split(/\s+/).filter(Boolean)
  while (words.length > 2) {
    const last = words[words.length - 1]!
    const shortLeftover =
      dropShortTail && last.replace(/[^\p{L}\p{N}]+/gu, '').length <= 2 && !/^\d+$/.test(last)
    if (!isDanglingToken(last) && !shortLeftover) break
    words.pop()
  }
  let out = words.join(' ').replace(/[:;,\-–—/&]+$/g, '').trim()
  if (dropShortTail) {
    const amp = out.lastIndexOf(' & ')
    const before = amp >= 0 ? out.slice(0, amp).trim() : ''
    const afterWords = amp >= 0 ? out.slice(amp + 3).split(/\s+/).filter(Boolean).length : 99
    if (amp >= 0 && afterWords <= 4 && before.length >= 20) {
      out = before
    }
  }
  return out
}

function truncateAtWord(s: string, max = RELATED_ANCHOR_MAX): {
  text: string
  truncated: boolean
} {
  const t = collapseWs(s)
  if (t.length <= max) return { text: t, truncated: false }
  const slice = t.slice(0, max)
  const lastSpace = slice.lastIndexOf(' ')
  return {
    text: (lastSpace >= 20 ? slice.slice(0, lastSpace) : slice).trim(),
    truncated: true,
  }
}

export function titleFromHref(href: string): string {
  let path = href
  try {
    if (/^https?:\/\//i.test(href)) path = new URL(href).pathname
  } catch {
    /* keep */
  }
  const last = (path.split('/').filter(Boolean).pop() || '')
    .split(/[?#]/)[0]!
    .replace(/\.(html?|php|aspx?)$/i, '')
  if (!last) return ''
  return last
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase()
      if (ACRONYMS.has(lower)) return lower.toUpperCase()
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

function isStubOfPath(phrase: string, pathTitle: string): boolean {
  if (!phrase) return true
  if (/[:]$/.test(phrase)) return true
  if (!pathTitle) return false
  const pw = pathTitle.split(/\s+/).filter(Boolean)
  const sw = phrase.split(/\s+/).filter(Boolean)
  if (sw.length <= 2 && pw.length >= sw.length + 2) return true
  if (sw.length <= 3 && pw.length >= sw.length + 2) return true
  return false
}

export type CleanAnchorInput = {
  h1?: string | null
  title?: string | null
  href?: string | null
  stored?: string | null
  anchorText?: string | null
}

export function cleanRelatedAnchor(input: CleanAnchorInput): string {
  const href = input.href || ''
  const pathCut = truncateAtWord(titleFromHref(href))
  const fromPath = stripDangling(pathCut.text, pathCut.truncated)
  const raws = [input.h1, input.title, input.stored, input.anchorText]
    .map((s) => collapseWs(s || ''))
    .filter(Boolean)

  const cleaned: string[] = []
  const seen = new Set<string>()
  for (const raw of raws) {
    const cut = truncateAtWord(stripSiteSuffix(raw))
    const phrase = stripDangling(cut.text, cut.truncated)
    if (phrase.length < 2) continue
    const k = phrase.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    cleaned.push(phrase)
  }
  if (fromPath.length >= 2 && !seen.has(fromPath.toLowerCase())) {
    cleaned.push(fromPath)
  }

  const usable = cleaned.filter((c) => !c.endsWith(':'))
  const strong = usable
    .filter((c) => !isStubOfPath(c, fromPath))
    .sort((a, b) => b.length - a.length)
  if (strong[0]) return strong[0]!
  const fallback = usable.sort((a, b) => b.length - a.length)[0]
  return fallback || fromPath || 'Related article'
}
