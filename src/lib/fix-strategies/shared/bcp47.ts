/**
 * BCP 47 language-tag grammar validation (topic 34).
 *
 * Validates structure — not membership of a curated language list.
 * `lang=""` (empty) is VALID. `zh-Hant`, `pt-BR`, `en-GB` must pass.
 * Full English names like `english` fail (not a 2–3 letter primary / not
 * grandfathered).
 *
 * No Search claim: Google ignores code-level lang (L6).
 */

/** Grandfathered tags from RFC 5646 (fixed list — part of the grammar). */
const GRANDFATHERED = new Set(
  [
    'en-gb-oed',
    'i-ami',
    'i-bnn',
    'i-default',
    'i-enochian',
    'i-hak',
    'i-klingon',
    'i-lux',
    'i-mingo',
    'i-navajo',
    'i-pwn',
    'i-tao',
    'i-tay',
    'i-tsu',
    'sgn-be-fr',
    'sgn-be-nl',
    'sgn-ch-de',
    'art-lojban',
    'cel-gaulish',
    'no-bok',
    'no-nyn',
    'zh-guoyu',
    'zh-hakka',
    'zh-min',
    'zh-min-nan',
    'zh-xiang',
  ].map((s) => s.toLowerCase()),
)

/**
 * Structural BCP 47 check. Empty string → valid.
 * Does not consult a language-name list.
 */
export function isValidBcp47(tag: string): boolean {
  if (tag === '') return true
  const lower = tag.toLowerCase()
  if (GRANDFATHERED.has(lower)) return true

  // privateuse: x-...
  if (/^x(?:-[a-z0-9]{1,8})+$/i.test(tag)) return true

  // langtag = language ["-" script] ["-" region] *("-" variant) *("-" extension) ["-" privateuse]
  // language = 2*3ALPHA *3("-" 3ALPHA) / 4ALPHA / 5*8ALPHA
  // We accept 2–3 letter primary (ISO 639) and 4-letter reserved form.
  // Bare 5–8 letter primaries are grammatically allowed for *registered*
  // irregulars; without the IANA registry we reject them so "english" fails
  // while zh-Hant / pt-BR still pass via 2-letter primary + subtags.
  const parts = tag.split('-')
  if (parts.length === 0 || parts.some((p) => p.length === 0)) return false

  let i = 0
  const lang = parts[i]!
  if (/^[a-zA-Z]{2,3}$/.test(lang)) {
    i++
    // optional extlang: up to 3 × 3ALPHA
    let ext = 0
    while (i < parts.length && ext < 3 && /^[a-zA-Z]{3}$/.test(parts[i]!)) {
      // Ambiguous with script (4) / region (2) — extlang is 3 alpha; continue
      // only while next looks like extlang and we haven't hit script/region yet.
      // Conservative: treat 3-alpha after 2–3 lang as extlang only when another
      // subtag follows that isn't clearly region — for zh-yue-Hant-HK etc.
      if (
        i + 1 < parts.length &&
        (/^[a-zA-Z]{4}$/.test(parts[i + 1]!) ||
          /^[a-zA-Z]{2}$/.test(parts[i + 1]!) ||
          /^\d{3}$/.test(parts[i + 1]!))
      ) {
        // Could be extlang before script/region
        i++
        ext++
        continue
      }
      // Lone 3-alpha after language: could be extlang (e.g. zh-yue) — allow one
      i++
      ext++
      break
    }
  } else if (/^[a-zA-Z]{4}$/.test(lang)) {
    i++
  } else {
    return false
  }

  // script: 4ALPHA
  if (i < parts.length && /^[a-zA-Z]{4}$/.test(parts[i]!)) {
    i++
  }

  // region: 2ALPHA / 3DIGIT
  if (
    i < parts.length &&
    (/^[a-zA-Z]{2}$/.test(parts[i]!) || /^\d{3}$/.test(parts[i]!))
  ) {
    i++
  }

  // variants: 5*8alphanum / DIGIT 3alphanum
  while (
    i < parts.length &&
    (/^[a-zA-Z0-9]{5,8}$/.test(parts[i]!) ||
      /^[0-9][a-zA-Z0-9]{3}$/.test(parts[i]!))
  ) {
    i++
  }

  // extensions: singleton (DIGIT / [A-WYa-wy]) + 2*8alphanum+
  while (i < parts.length && /^[0-9A-WY]$/i.test(parts[i]!) && parts[i] !== 'x') {
    i++
    let saw = 0
    while (i < parts.length && /^[a-zA-Z0-9]{2,8}$/.test(parts[i]!)) {
      i++
      saw++
    }
    if (saw === 0) return false
  }

  // privateuse
  if (i < parts.length && parts[i]!.toLowerCase() === 'x') {
    i++
    let saw = 0
    while (i < parts.length && /^[a-zA-Z0-9]{1,8}$/.test(parts[i]!)) {
      i++
      saw++
    }
    if (saw === 0) return false
  }

  return i === parts.length
}

/** ISO 639-1 two-letter form required for Book rich results (L10). */
export function isIso6391(tag: string): boolean {
  return /^[a-zA-Z]{2}$/.test(tag)
}

/**
 * True when two BCP 47 tags are compatible for topic 34 —
 * exact match (case-insensitive) OR one is a prefix extension of the other
 * (e.g. `en` vs `en-GB`). Distinct region tags (`en-GB` vs `en-US`) disagree.
 */
export function bcp47TagsCompatible(a: string, b: string): boolean {
  const la = a.trim().toLowerCase()
  const lb = b.trim().toLowerCase()
  if (!la || !lb) return false
  if (la === lb) return true
  if (la.startsWith(`${lb}-`) || lb.startsWith(`${la}-`)) return true
  return false
}
