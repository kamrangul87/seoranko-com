// Tokenization-aware prose checks via the retext (unified.js) ecosystem —
// replaces the least reliable of article-quality-gate.ts's hand-rolled
// COPY_ERROR_PATTERNS regexes. Those regexes matched on raw character
// sequences with no concept of word/sentence boundaries, which produced two
// confirmed false-positive incidents: a domain name being flagged as a typo,
// and (found while building this replacement) the "missing space after
// period" pattern flagging every lowercase domain mention in body text
// (e.g. "ofgem.gov.uk" matches "v.u", "seoranko.com" matches "o.c") — see
// article-quality-gate.ts's own domain-masking fix for that one, kept as a
// regex since no retext plugin covers it. retext-repeated-words replaces the
// old duplicate-word regex here since it's tokenized (won't match across
// HTML/attribute boundaries the way a raw regex risks) and won't flag
// legitimate repeated letters in brand names or chemical formulas the way
// the old repeated-character regex did (that pattern is dropped entirely —
// no safe automated equivalent, better to under-flag than false-positive).
//
// Correction to the brief this was built from: retext-contractions does NOT
// detect "informal tone" — it flags contractions with a missing or non-curly
// apostrophe (e.g. "dont" -> "don't", "isn't" -> "isn't" typographically).
// Verified directly: it has no concept of formality at all. Used here for
// what it actually does — a missing apostrophe is a real spelling defect
// (warning); a present-but-straight apostrophe is pure typographic style
// (info, doesn't affect the score).

import { unified } from 'unified'
import retextEnglish from 'retext-english'
import retextStringify from 'retext-stringify'
import retextRepeatedWords from 'retext-repeated-words'
import retextSentenceSpacing from 'retext-sentence-spacing'
import retextQuotes from 'retext-quotes'
import retextRedundantAcronyms from 'retext-redundant-acronyms'
import retextContractions from 'retext-contractions'

export type ProseFindingSeverity = 'critical' | 'warning' | 'info'

export interface ProseFinding {
  key: string
  severity: ProseFindingSeverity
  title: string
  count: number
  examples: string[]
}

const processor = unified()
  .use(retextEnglish)
  .use(retextRepeatedWords)
  .use(retextSentenceSpacing)
  .use(retextQuotes)
  .use(retextRedundantAcronyms)
  .use(retextContractions)
  .use(retextStringify)

export async function lintProse(plainText: string): Promise<ProseFinding[]> {
  const file = await processor.process(plainText)
  const groups = new Map<string, { severity: ProseFindingSeverity; title: string; examples: string[]; count: number }>()

  for (const message of file.messages) {
    const source = message.source
    const reason = message.reason || ''
    let key: string | null = null
    let severity: ProseFindingSeverity = 'info'
    let title = ''

    if (source === 'retext-repeated-words') {
      key = 'repeated-word'; severity = 'critical'; title = 'Repeated word'
    } else if (source === 'retext-sentence-spacing') {
      key = 'sentence-spacing'; severity = 'warning'; title = 'Irregular spacing between sentences'
    } else if (source === 'retext-redundant-acronyms') {
      key = 'redundant-acronym'; severity = 'warning'; title = 'Redundant wording around an acronym'
    } else if (source === 'retext-quotes' && message.ruleId === 'quote') {
      // ruleId 'apostrophe' from this same plugin is intentionally skipped —
      // retext-contractions below owns apostrophe findings, since it can
      // additionally tell a genuinely missing apostrophe (a real defect)
      // apart from a merely-straight one (style only), which retext-quotes
      // can't distinguish on its own.
      key = 'quote-style'; severity = 'info'; title = 'Straight quotation marks (style only, not an error)'
    } else if (source === 'retext-contractions') {
      if (reason.startsWith('Unexpected missing apostrophe')) {
        key = 'missing-apostrophe'; severity = 'warning'; title = 'Missing apostrophe in a contraction'
      } else {
        key = 'apostrophe-style'; severity = 'info'; title = 'Straight apostrophe in a contraction (style only, not an error)'
      }
    }

    if (!key) continue
    if (!groups.has(key)) groups.set(key, { severity, title, examples: [], count: 0 })
    const group = groups.get(key)!
    group.count++
    const example = typeof message.actual === 'string' ? message.actual : String(message.actual ?? '')
    if (example && group.examples.length < 3 && !group.examples.includes(example)) {
      group.examples.push(example)
    }
  }

  return Array.from(groups.entries()).map(([key, g]) => ({
    key,
    severity: g.severity,
    title: g.title,
    count: g.count,
    examples: g.examples,
  }))
}
