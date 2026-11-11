/**
 * Professional related-reading anchors from the target H1/title (or path).
 * Never invent marketing copy; never emit 2-word stubs or colon-truncated titles.
 */

export const RELATED_TRANSFORM_VERSION = 3
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

/** Decode named/numeric entities, including a stored `&amp;` that would otherwise double-escape. */
export function decodeHtmlEntities(value: string): string {
  let prev = ''
  let out = value
  for (let i = 0; i < 3 && out !== prev; i++) {
    prev = out
    out = out
      .replace(/&nbsp;/gi, ' ')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/gi, '&')
  }
  return out
}

export function escapeHtmlText(s: string): string {
  return decodeHtmlEntities(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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
  return dropUnbalancedPunctuation(out)
}

/** Drop a truncated parenthetical, bracket, or quote so the anchor never ends unclosed. */
export function dropUnbalancedPunctuation(s: string): string {
  let out = collapseWs(s)
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
  ] as const) {
    let depth = 0
    let firstUnclosed = -1
    for (let i = 0; i < out.length; i++) {
      const ch = out[i]
      if (ch === open) {
        if (depth === 0) firstUnclosed = i
        depth += 1
      } else if (ch === close) {
        if (depth > 0) depth -= 1
        if (depth === 0) firstUnclosed = -1
      }
    }
    if (depth > 0 && firstUnclosed >= 0) {
      out = out.slice(0, firstUnclosed).trim()
    }
  }

  let straight = 0
  let lastStraight = -1
  for (let i = 0; i < out.length; i++) {
    if (out[i] === '"') {
      straight += 1
      lastStraight = i
    }
  }
  if (straight % 2 === 1 && lastStraight >= 0) {
    out = out.slice(0, lastStraight).trim()
  }

  const openD = out.lastIndexOf('“')
  const closeD = out.lastIndexOf('”')
  if (openD >= 0 && openD > closeD) {
    out = out.slice(0, openD).trim()
  }

  return out.replace(/[:;,\-–—/&]+$/g, '').trim()
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
    .map((s) => collapseWs(decodeHtmlEntities(s || '')))
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
