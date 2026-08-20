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
  // orphaned "word." fragment of 1–3 chars after a period+space that's mid-token.
  // Excludes "e.g."/"i.e." — found while adding the splice check below: this
  // pattern's generic 1-2-letter-fragment shape also matches those two very
  // common, entirely legitimate abbreviations, which would have wrongly
  // rejected any patch that added one and, worse, could hard-abort an
  // otherwise-fine article at route.ts's absolute hasInsertionCorruption check.
  /(?<!\be)(?<!\bi)\.\s*[a-z]{1,2}\.(?=\s|$)/,
  // double period / period immediately before digit mid-prose: ".350."
  /(?<=\w)\.(\d{2,})\.(?=\s|[A-Z])/,
  // "Approved Document S.t S" — truncated splice mid-title
  /\b[A-Za-z]+\s+[A-Z]\.t\s+[A-Z]\b/,
  // "installations.ce of" — truncated suffix before a preposition
  /\b[a-z]{5,}\.[a-z]{1,3}\s+(?:of|the|a|and|for|in|to|on)\b/,
  // "evolve.ds outpace" — truncated 1–3 letter fragment after a period,
  // then a continuing lowercase word (confirmed live: "...standards
  // evolve.ds outpace current hardware capabilities."). Distinct from the
  // preposition-scoped rule above: the next word is ordinary prose, not a
  // closed-class preposition. TLD lookbehind keeps gov.uk / energynetworks.org
  // from matching.
  /\b[a-z]{4,}\.(?!uk\b|com\b|org\b|net\b|gov\b|edu\b|co\b|io\b|ai\b)[a-z]{1,3}\s+[a-z]{3,}\b/,
  // "50 kW and lower speeds. and 150 kW." — a period immediately followed
  // by a lowercase coordinating conjunction/preposition is the residue of
  // a fragment spliced mid-clause (confirmed live: a fact-sourcing hedge
  // patch turned "...accept between 50 kW and 150 kW." into exactly this).
  // Real English prose never legitimately starts a new sentence with a
  // lowercase conjunction, so this is a narrow, low-false-positive signal
  // — deliberately scoped to conjunctions/prepositions rather than "any
  // lowercase word" to avoid tripping on legitimate abbreviations (e.g.
  // "approx. 50kW", "St. Ives"). This is the specific shape
  // isSafeTextPatch's sentence-count check misses: splitIntoSentences only
  // counts a new sentence when the period is followed by a CAPITAL letter,
  // so a lowercase splice doesn't register as "one more sentence" at all.
  /\.\s+(?:and|or|but|nor|yet|so|with|of|to|for|in|on|at|as)\b/,
]

/** Mask URLs + multi-label hostnames so domain labels never look like merge glue. */
function maskUrlsAndHostnames(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, (m) => ' '.repeat(m.length))
    // foo.supabase.co / energynetworks.org / www.example.com
    .replace(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\.[a-z]{2,24}\b/gi, (m) => ' '.repeat(m.length))
}

/**
 * Closed-class words that legitimately appear in reduplication
 * ("more and more", "time after time", "step by step").
 */
const BRIDGE_ALLOW = new Set([
  'and', 'or', 'but', 'by', 'after', 'before', 'upon', 'into', 'onto', 'from',
  'with', 'over', 'under', 'between', 'to', 'of', 'in', 'on', 'at', 'as', 'for',
  'the', 'a', 'an', 'vs', 'versus',
])

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'as', 'for',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'that', 'this',
  'it', 'its', 'your', 'our', 'their', 'his', 'her', 'my',
])

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9£$€'\-]+/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Live merge shapes with NO mid-word punctuation — duplicated / overlapping
 * phrases instead (confirmed 2026-08-18 live article-v2 output):
 *
 * 1. "scope of work infrastructure work needed"
 *    → content word repeated with one content word between ("work … work")
 *
 * 2. "home charger installation. EV charger installation,"
 *    → 2–4 word phrase ending sentence N reappears at the start of N+1
 *
 * Also catches exact adjacent repeated 2–4 word phrases ("the cost the cost").
 */
export function hasOverlappingPhraseCorruption(text: string): boolean {
  const plain = maskUrlsAndHostnames(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  if (!plain) return false

  // Exact adjacent repeated 2–4 word phrase
  if (/\b((?:[A-Za-z][A-Za-z0-9'-]*\s+){1,3}[A-Za-z][A-Za-z0-9'-]*)\s+\1\b/i.test(plain)) {
    return true
  }

  // Content word repeated with exactly one content bridge between
  // ("work infrastructure work") — not "more and more" / "time after time"
  const wordRepeat = /\b([A-Za-z][A-Za-z0-9'-]{3,})\s+([A-Za-z][A-Za-z0-9'-]{3,})\s+\1\b/gi
  let m: RegExpExecArray | null
  while ((m = wordRepeat.exec(plain)) !== null) {
    const bridge = m[2].toLowerCase()
    if (!BRIDGE_ALLOW.has(bridge)) return true
  }

  // Cross-sentence: ending n-gram of sentence A overlaps start of sentence B
  const sentences = splitIntoSentences(plain)
  for (let i = 0; i < sentences.length - 1; i++) {
    const a = tokenizeWords(sentences[i].replace(/[.!?]+$/, ''))
    const b = tokenizeWords(sentences[i + 1])
    if (a.length < 2 || b.length < 2) continue
    const aTail = a.slice(-4)
    const bHead = b.slice(0, 5)
    for (let n = 4; n >= 2; n--) {
      if (aTail.length < n) continue
      const gram = aTail.slice(-n)
      // Require at least one non-stopword in the shared gram
      if (!gram.some(w => !STOPWORDS.has(w) && w.length >= 4)) continue
      for (let j = 0; j <= bHead.length - n; j++) {
        const slice = bHead.slice(j, j + n)
        if (slice.every((w, k) => w === gram[k])) return true
      }
    }
  }

  return false
}

export function hasInsertionCorruption(text: string): boolean {
  // Check per block-level segment so </p><p> does not invent
  // "needed. as a…" lowercase-conjunction false positives.
  const blocks = text.split(/<\/?(?:p|div|h[1-6]|li|section|article|td|th|figcaption)(?:\s[^>]*)?>/i)
  for (const block of blocks) {
    const plain = maskUrlsAndHostnames(block.replace(/<[^>]+>/g, ' '))
    if (!plain.trim()) continue
    if (INSERTION_CORRUPTION_PATTERNS.some(re => re.test(plain))) return true
    if (hasOverlappingPhraseCorruption(plain)) return true
  }
  return false
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
 * Merge adjacent sentences when sentence B opens by repeating a 2–4 word
 * phrase that ended sentence A (live: "…home charger installation. EV
 * charger installation, adding…").
 */
function scrubCrossSentencePhraseOverlap(text: string): { text: string; fixes: number } {
  let fixes = 0
  let current = text
  // Iterate until no more merges (chained overlaps are rare but cheap).
  for (let pass = 0; pass < 5; pass++) {
    const parts = current.split(/(?<=[.!?])(\s+)(?=[A-Z"'£$€(0-9])/)
    if (parts.length < 3) break

    let mergedThisPass = false
    for (let i = 0; i + 2 < parts.length; i += 2) {
      const left = parts[i]
      const right = parts[i + 2]
      const aWords = tokenizeWords(left.replace(/[.!?]+$/, ''))
      const bWords = tokenizeWords(right)
      if (aWords.length < 2 || bWords.length < 2) continue

      const aTail = aWords.slice(-4)
      let merged: string | null = null

      outer: for (let n = 4; n >= 2; n--) {
        if (aTail.length < n || bWords.length < n) continue
        const gram = aTail.slice(-n)
        if (!gram.some(w => !STOPWORDS.has(w) && w.length >= 4)) continue

        for (const prefixLen of [1, 0] as const) {
          if (bWords.length < prefixLen + n) continue
          const slice = bWords.slice(prefixLen, prefixLen + n)
          if (!slice.every((w, k) => w === gram[k])) continue

          const dropCount = prefixLen + n
          const wordRe = /[A-Za-z0-9£$€][A-Za-z0-9'-]*/g
          let matched = 0
          let endIdx = 0
          let wm: RegExpExecArray | null
          while ((wm = wordRe.exec(right)) !== null) {
            matched++
            endIdx = wm.index + wm[0].length
            if (matched >= dropCount) break
          }
          let remainder = right.slice(endIdx).replace(/^\s*/, '')
          if (remainder && !/^[,;:]/.test(remainder)) remainder = `, ${remainder}`
          else if (remainder) remainder = remainder.replace(/^([,;:])\s*/, '$1 ')
          merged = `${left.replace(/[.!?]+$/, '')}${remainder}`
          break outer
        }
      }

      if (!merged) continue

      parts[i] = merged
      parts.splice(i + 1, 2)
      fixes++
      mergedThisPass = true
      current = parts.join('')
      break
    }

    if (!mergedThisPass) break
  }

  return { text: current, fixes }
}

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

    // "evolve.ds outpace" → "evolve outpace" (drop truncated mid-sentence fragment)
    content = content.replace(
      /\b([a-z]{4,})\.(?!uk\b|com\b|org\b|net\b|gov\b|edu\b|co\b|io\b|ai\b)([a-z]{1,3})\s+([a-z]{3,})\b/g,
      (_m, word: string, _frag: string, next: string) => {
        fixes++
        return `${word} ${next}`
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

    // "scope of work infrastructure work" → "scope of infrastructure work"
    // Content-word reduplication with a content bridge (not "more and more").
    content = content.replace(
      /\b([A-Za-z][A-Za-z0-9'-]{3,})\s+([A-Za-z][A-Za-z0-9'-]{3,})\s+\1\b/g,
      (m, repeated: string, bridge: string) => {
        if (BRIDGE_ALLOW.has(bridge.toLowerCase())) return m
        fixes++
        return `${bridge} ${repeated}`
      },
    )

    // "home charger installation. EV charger installation, adding…" →
    // "home charger installation, adding…"
    const cross = scrubCrossSentencePhraseOverlap(content)
    content = cross.text
    fixes += cross.fixes

    return content
  }

  const out = transformHtmlTextNodes(html, scrubText)
  assertImageUrlsPreserved(html, out)
  return { html: out, fixes }
}
