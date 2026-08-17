/**
 * Shared sentence-integrity guard for every pipeline step that splices or
 * rewrites prose inside already-generated article HTML.
 *
 * Principle (same as fact-checker hedging): if a patch increases sentence
 * count or leaves a stray fragment, reject it and keep the original text.
 */

import { assertImageUrlsPreserved, transformHtmlTextNodes } from '@/lib/html-text-transform'

export function splitIntoSentences(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'£$€(0-9])/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** Known corruption shapes from auto-insertions / bad merges. */
export const INSERTION_CORRUPTION_PATTERNS: RegExp[] = [
  // "require.ehicles" — truncated word glued after a period (exclude TLDs)
  /\b[a-z]{4,}\.(?!uk\b|com\b|org\b|net\b|gov\b|edu\b|co\b|io\b|ai\b)[a-z]{4,}\b/,
  // "(verify at GOV.UK).350." — duplicated figure after parenthetical insert
  /\)\.\d+\./,
  // "£350 (verify at GOV.UK).350."
  /£\d+[^.…]{0,40}\)\.\d+\./,
  // orphaned "word." fragment of 1–3 chars after a period+space that's mid-token
  /\.\s*[a-z]{1,2}\.(?=\s|$)/,
  // double period / period immediately before digit mid-prose: ".350."
  /(?<=\w)\.(\d{2,})\.(?=\s|[A-Z])/,
  // "Approved Document S.t S" — truncated splice mid-title
  /\b[A-Za-z]+\s+[A-Z]\.t\s+[A-Z]\b/,
  // "installations.ce of" — truncated suffix before a preposition
  /\b[a-z]{5,}\.[a-z]{1,3}\s+(?:of|the|a|and|for|in|to|on)\b/,
]

/** Mask URLs + multi-label hostnames so domain labels never look like merge glue. */
function maskUrlsAndHostnames(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, (m) => ' '.repeat(m.length))
    // foo.supabase.co / energynetworks.org / www.example.com
    .replace(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\.[a-z]{2,24}\b/gi, (m) => ' '.repeat(m.length))
}

export function hasInsertionCorruption(text: string): boolean {
  const plain = maskUrlsAndHostnames(text.replace(/<[^>]+>/g, ' '))
  return INSERTION_CORRUPTION_PATTERNS.some(re => re.test(plain))
}

/**
 * True when `replacement` is safe relative to `original`:
 * - does not introduce more sentences than the original had
 * - does not introduce known insertion-corruption shapes the original lacked
 */
export function isSafeTextPatch(original: string, replacement: string): boolean {
  if (!replacement || replacement === original) return false

  const beforeCount = splitIntoSentences(original).length
  const afterCount = splitIntoSentences(replacement).length
  if (afterCount > beforeCount) return false

  if (!hasInsertionCorruption(original) && hasInsertionCorruption(replacement)) {
    return false
  }

  // Empty / whitespace-only replacement is never a valid prose patch
  if (!replacement.replace(/<[^>]+>/g, '').trim()) return false

  return true
}

/**
 * Replace the first occurrence of `find` with `replaceWith` only if the
 * surrounding sentence (or the find/replace pair) still passes integrity.
 * Returns `{ html, applied }`.
 */
export function applyGuardedReplace(
  html: string,
  find: string,
  replaceWith: string,
  label = 'patch',
): { html: string; applied: boolean } {
  if (!find || !html.includes(find)) return { html, applied: false }
  if (!isSafeTextPatch(find, replaceWith)) {
    console.warn(`[sentence-integrity] rejected ${label}: unsafe find→replace`)
    return { html, applied: false }
  }

  const idx = html.indexOf(find)
  const contextStart = Math.max(0, idx - 120)
  const contextEnd = Math.min(html.length, idx + find.length + 120)
  const beforeCtx = html.slice(contextStart, contextEnd)
  const afterCtx = beforeCtx.replace(find, replaceWith)

  if (!isSafeTextPatch(beforeCtx, afterCtx) || hasInsertionCorruption(afterCtx) && !hasInsertionCorruption(beforeCtx)) {
    console.warn(`[sentence-integrity] rejected ${label}: surrounding sentence broke`)
    return { html, applied: false }
  }

  return { html: html.slice(0, idx) + replaceWith + html.slice(idx + find.length), applied: true }
}

/**
 * Regex replace with per-match integrity: each match's replacement is checked
 * against the matched substring + local context; unsafe matches keep original.
 */
export function applyGuardedRegexReplace(
  html: string,
  pattern: RegExp,
  replacer: (match: string, ...args: string[]) => string,
  label = 'regex-patch',
): { html: string; appliedCount: number } {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const re = new RegExp(pattern.source, flags)
  let appliedCount = 0
  const out = html.replace(re, (match, ...args) => {
    const replacement = replacer(match, ...args)
    if (replacement === match) return match
    if (!isSafeTextPatch(match, replacement)) {
      console.warn(`[sentence-integrity] rejected ${label} match:`, match.slice(0, 60))
      return match
    }
    // Local window check (args includes offset as second-to-last in JS replace)
    const offset = typeof args[args.length - 2] === 'number' ? (args[args.length - 2] as unknown as number) : html.indexOf(match)
    const start = Math.max(0, offset - 80)
    const end = Math.min(html.length, offset + match.length + 80)
    const beforeWindow = html.slice(start, end)
    const afterWindow = beforeWindow.replace(match, replacement)
    if (hasInsertionCorruption(afterWindow) && !hasInsertionCorruption(beforeWindow)) {
      console.warn(`[sentence-integrity] rejected ${label} — corruption in window`)
      return match
    }
    appliedCount++
    return replacement
  })
  return { html: out, appliedCount }
}

const TLD_LIKE = new Set([
  'uk', 'com', 'org', 'net', 'gov', 'edu', 'co', 'io', 'ai',
  'html', 'json', 'xml', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
])

/**
 * Deterministic scrub for known post-insertion corruption left in the wild.
 * Safe to run after any autofix pass.
 *
 * CRITICAL: only rewrites HTML text nodes — never src/href/content attributes,
 * never JSON-LD <script> bodies. A prior whole-HTML replace treated
 * "projectref.supabase" as merge glue and destroyed every Supabase Storage URL.
 *
 * After scrubbing, asserts every image URL from the input is still intact.
 */
export function scrubInsertionCorruption(html: string): { html: string; fixes: number } {
  let fixes = 0

  const scrubText = (text: string): string => {
    let content = text

    // "(verify at GOV.UK).350." → "(verify at GOV.UK)."
    content = content.replace(/(\(verify at GOV\.UK\))\.\d+\./gi, (_m, paren: string) => {
      fixes++
      return `${paren}.`
    })

    // "£350 (verify at GOV.UK).350." → "£350 (verify at GOV.UK)."
    content = content.replace(/(£\d+)\s*(\(verify at GOV\.UK\))\.\1\./gi, (_m, amount: string, paren: string) => {
      fixes++
      return `${amount} ${paren}.`
    })

    // Generic: ").123." after any parenthetical → ")."
    content = content.replace(/\)\.(\d{2,})\.(?=\s|[A-Z])/g, () => {
      fixes++
      return ').'
    })

    // "Approved Document S.t S" → "Approved Document S"
    content = content.replace(/\b([A-Za-z]+)\s+([A-Z])\.t\s+\2\b/g, (_m, word: string, letter: string) => {
      fixes++
      return `${word} ${letter}`
    })

    // "installations.ce of" → "installations of"
    content = content.replace(
      /\b([a-z]{5,})\.([a-z]{1,3})\s+(of|the|a|and|for|in|to|on)\b/g,
      (_m, word: string, _frag: string, prep: string) => {
        fixes++
        return `${word} ${prep}`
      },
    )

    // "require.ehicles" / "province.ce" — drop truncated lowercase.lowercase glue.
    // NEVER treat hostname labels as glue: "ddfbo….supabase.co" must stay intact.
    content = content.replace(/\b([a-z]{4,})\.([a-z]{4,})\b/g, (m, a: string, b: string, offset: number) => {
      if (TLD_LIKE.has(b) || TLD_LIKE.has(a)) return m
      const after = content.slice(offset + m.length)
      // Next label is a TLD → this is a hostname (foo.supabase.co)
      if (/^\.(?:[a-z]{2,24})\b/i.test(after)) return m
      const before = content.slice(Math.max(0, offset - 16), offset)
      if (/https?:\/\/$/i.test(before) || /\/\/[\w.-]*$/i.test(before)) return m
      fixes++
      return a
    })

    return content
  }

  const out = transformHtmlTextNodes(html, scrubText)
  assertImageUrlsPreserved(html, out)
  return { html: out, fixes }
}
