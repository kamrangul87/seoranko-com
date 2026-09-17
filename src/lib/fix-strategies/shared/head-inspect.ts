/**
 * ONE head inspection for topics 29, 30, 31, 33, 34.
 *
 * Uses parse5 (via html-parser patterns) with source locations so `<head>` is
 * taken as the PARSER sees it — never source position between `<head>` and
 * `</head>` tags. Topic 29's implicit close moves later metadata into body.
 *
 * All five topics classify from this object; do not re-parse per topic.
 */

import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { parseHtml, type HtmlElement, type ParsedHtml } from './html-parser'

type Document = DefaultTreeAdapterMap['document']
type Element = DefaultTreeAdapterMap['element']
type ChildNode = Document['childNodes'][number]

/** Metadata content permitted in <head> (H1). */
const HEAD_METADATA_TAGS = new Set([
  'base',
  'link',
  'meta',
  'noscript',
  'script',
  'style',
  'template',
  'title',
])

export type HeadCasualtyKind =
  | 'canonical'
  | 'hreflang'
  | 'meta-description'
  | 'og-or-twitter'
  | 'robots-meta'
  | 'title'
  | 'other-metadata'

export type HeadCasualty = {
  kind: HeadCasualtyKind
  tagName: string
  attrs: Record<string, string>
  textContent: string
}

export type PrematureHeadClose = {
  /** First non-metadata element that closed <head> (parser view). */
  offender: {
    tagName: string
    attrs: Record<string, string>
  } | null
  casualties: HeadCasualty[]
  /** True when source had elements before </head> that landed in body. */
  detected: boolean
}

export type TitleRecord = {
  text: string
  /** Whitespace-collapsed trimmed form for duplicate grouping (topic 33). */
  normalized: string
  location: 'head' | 'body'
}

export type DescriptionRecord = {
  content: string
  normalized: string
  /** Raw name attribute as authored. */
  nameAttr: string
  location: 'head' | 'body'
}

export type InLanguageRecord = {
  value: string
  /** JSON-LD @type of the entity carrying inLanguage. */
  entityType: string | null
  /** True when the entity is (or includes) Book. */
  isBook: boolean
  /** True when this is a top-level graph entity (not deeply embedded only). */
  documentLevel: boolean
  /** Book entity present but inLanguage property absent (L10). */
  missingOnBook?: boolean
}

export type HeadInspection = {
  pageUrl: string
  parsed: ParsedHtml
  htmlLang: string | null
  /** True when the lang attribute is present (including empty string). */
  htmlLangPresent: boolean
  prematureClose: PrematureHeadClose
  /** Titles the parser places in <head>. */
  titlesInHead: TitleRecord[]
  /** Titles the parser places in <body> (often a topic-29 casualty). */
  titlesInBody: TitleRecord[]
  descriptionsInHead: DescriptionRecord[]
  descriptionsInBody: DescriptionRecord[]
  inLanguage: InLanguageRecord[]
  /** Primary visible heading text (h1) for title scaffold proposals. */
  primaryHeading: string | null
}

function isElement(node: ChildNode): node is Element {
  return (
    node.nodeName !== '#text' &&
    node.nodeName !== '#comment' &&
    node.nodeName !== '#documentType' &&
    'tagName' in node
  )
}

function attrsToRecord(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const attr of el.attrs) out[attr.name] = attr.value
  return out
}

function textOf(node: ChildNode): string {
  if (node.nodeName === '#text') {
    return (node as DefaultTreeAdapterMap['textNode']).value
  }
  if (!isElement(node)) return ''
  let s = ''
  for (const child of node.childNodes) s += textOf(child)
  return s
}

function findHtml(doc: Document): Element | null {
  for (const child of doc.childNodes) {
    if (isElement(child) && child.tagName === 'html') return child
  }
  return null
}

function findChild(parent: Element, tag: string): Element | null {
  for (const c of parent.childNodes) {
    if (isElement(c) && c.tagName === tag) return c
  }
  return null
}

function normalizeMetaText(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

function classifyCasualty(el: HtmlElement): HeadCasualty {
  const tag = el.tagName.toLowerCase()
  const rel = (el.attrs.rel ?? '').toLowerCase().split(/\s+/)
  const name = (el.attrs.name ?? '').toLowerCase()
  const prop = (el.attrs.property ?? '').toLowerCase()
  const httpEquiv = (el.attrs['http-equiv'] ?? '').toLowerCase()

  let kind: HeadCasualtyKind = 'other-metadata'
  if (tag === 'title') kind = 'title'
  else if (tag === 'link' && rel.includes('canonical')) kind = 'canonical'
  else if (tag === 'link' && rel.includes('alternate') && el.attrs.hreflang) {
    kind = 'hreflang'
  } else if (tag === 'meta' && name === 'description') kind = 'meta-description'
  else if (
    tag === 'meta' &&
    (name === 'robots' || name === 'googlebot' || httpEquiv === 'robots')
  ) {
    kind = 'robots-meta'
  } else if (
    tag === 'meta' &&
    (prop.startsWith('og:') ||
      prop.startsWith('twitter:') ||
      name.startsWith('twitter:'))
  ) {
    kind = 'og-or-twitter'
  }

  return {
    kind,
    tagName: tag,
    attrs: el.attrs,
    textContent: el.textContent,
  }
}

function detectPrematureClose(
  html: string,
  body: Element | null,
): PrematureHeadClose {
  if (!body) {
    return { offender: null, casualties: [], detected: false }
  }

  const closeIdx = html.toLowerCase().indexOf('</head>')
  if (closeIdx < 0) {
    return { offender: null, casualties: [], detected: false }
  }

  // Elements the parser put in <body> but whose source offset is still before
  // the authored </head> — written in head, closed out by H6.
  const escaped: Element[] = []
  for (const child of body.childNodes) {
    if (!isElement(child)) continue
    const start = child.sourceCodeLocation?.startOffset
    if (start == null) continue
    if (start < closeIdx) escaped.push(child)
  }

  if (escaped.length === 0) {
    return { offender: null, casualties: [], detected: false }
  }

  let offender: PrematureHeadClose['offender'] = null
  const casualties: HeadCasualty[] = []
  let seenOffender = false

  for (const el of escaped) {
    const tag = el.tagName.toLowerCase()
    const isMeta = HEAD_METADATA_TAGS.has(tag)
    if (!seenOffender) {
      if (!isMeta) {
        offender = { tagName: tag, attrs: attrsToRecord(el) }
        seenOffender = true
      }
      // Metadata before the first non-metadata in the escaped set is unusual
      // (parser would have kept it in head) — ignore.
      continue
    }
    if (isMeta) {
      casualties.push(
        classifyCasualty({
          tagName: tag,
          attrs: attrsToRecord(el),
          textContent: textOf(el),
          node: el,
        }),
      )
    }
  }

  // If every escaped element is metadata, no non-metadata offender — not H6.
  if (!offender) {
    return { offender: null, casualties: [], detected: false }
  }

  return { offender, casualties, detected: true }
}

function collectTitles(
  elements: HtmlElement[],
  location: 'head' | 'body',
): TitleRecord[] {
  return elements.map((el) => {
    const text = el.textContent
    return {
      text,
      normalized: normalizeMetaText(text),
      location,
    }
  })
}

function collectDescriptions(
  elements: HtmlElement[],
  location: 'head' | 'body',
): DescriptionRecord[] {
  const out: DescriptionRecord[] = []
  for (const el of elements) {
    const nameAttr = el.attrs.name ?? el.attrs.Name ?? ''
    if (nameAttr.toLowerCase() !== 'description') continue
    const content = el.attrs.content ?? el.attrs.Content ?? ''
    out.push({
      content,
      normalized: normalizeMetaText(content),
      nameAttr,
      location,
    })
  }
  return out
}

function extractInLanguage(html: string): InLanguageRecord[] {
  const out: InLanguageRecord[] = []
  // Structural: JSON-LD script blocks only — not page prose.
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]!.trim()
    if (!raw) continue
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      continue
    }
    walkJsonLd(data, out, true)
  }
  return out
}

function walkJsonLd(
  node: unknown,
  out: InLanguageRecord[],
  documentLevel: boolean,
  depth = 0,
): void {
  if (node == null || depth > 12) return
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, out, documentLevel, depth + 1)
    return
  }
  if (typeof node !== 'object') return
  const obj = node as Record<string, unknown>

  if (obj['@graph']) {
    walkJsonLd(obj['@graph'], out, true, depth + 1)
  }

  const typeRaw = obj['@type']
  const types = Array.isArray(typeRaw)
    ? typeRaw.map(String)
    : typeRaw != null
      ? [String(typeRaw)]
      : []
  const isBook = types.some((t) => /(^|\/)Book$/i.test(t))
  const typeLabel = types[0] ?? null

  if (obj.inLanguage != null) {
    const vals = Array.isArray(obj.inLanguage)
      ? obj.inLanguage
      : [obj.inLanguage]
    for (const v of vals) {
      const value =
        typeof v === 'string'
          ? v
          : v && typeof v === 'object' && 'name' in (v as object)
            ? String((v as { name: unknown }).name)
            : String(v)
      out.push({
        value,
        entityType: typeLabel,
        isBook,
        documentLevel: documentLevel && depth <= 2,
      })
    }
  } else if (isBook && documentLevel && depth <= 2) {
    out.push({
      value: '',
      entityType: typeLabel,
      isBook: true,
      documentLevel: true,
      missingOnBook: true,
    })
  }

  // Recurse into nested objects (embedded entities — not document-level)
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('@') && k !== '@graph') continue
    if (k === 'inLanguage' || k === '@graph') continue
    if (v && typeof v === 'object') {
      walkJsonLd(v, out, false, depth + 1)
    }
  }
}

/**
 * Build the shared head inspection for one page.
 */
export function inspectDocumentHead(
  html: string,
  pageUrl = 'https://example.com/',
): HeadInspection {
  const document = parse(html, { sourceCodeLocationInfo: true })
  const htmlEl = findHtml(document)
  const body = htmlEl ? findChild(htmlEl, 'body') : null

  const parsed = parseHtml(html)

  let htmlLang: string | null = null
  let htmlLangPresent = false
  if (htmlEl) {
    const attrs = attrsToRecord(htmlEl)
    if (Object.prototype.hasOwnProperty.call(attrs, 'lang')) {
      htmlLangPresent = true
      htmlLang = attrs.lang
    } else if (Object.prototype.hasOwnProperty.call(attrs, 'xml:lang')) {
      htmlLangPresent = true
      htmlLang = attrs['xml:lang']!
    }
  }

  const prematureClose = detectPrematureClose(html, body)

  const titlesInHead = collectTitles(parsed.headElements('title'), 'head')
  const titlesInBody = collectTitles(parsed.bodyElements('title'), 'body')
  const descriptionsInHead = collectDescriptions(
    parsed.headElements('meta'),
    'head',
  )
  const descriptionsInBody = collectDescriptions(
    parsed.bodyElements('meta'),
    'body',
  )

  const h1s = parsed.bodyElements('h1')
  const primaryHeading =
    h1s.length > 0 ? normalizeMetaText(h1s[0]!.textContent) || null : null

  return {
    pageUrl,
    parsed,
    htmlLang,
    htmlLangPresent,
    prematureClose,
    titlesInHead,
    titlesInBody,
    descriptionsInHead,
    descriptionsInBody,
    inLanguage: extractInLanguage(html),
    primaryHeading,
  }
}

export { HEAD_METADATA_TAGS, normalizeMetaText }
