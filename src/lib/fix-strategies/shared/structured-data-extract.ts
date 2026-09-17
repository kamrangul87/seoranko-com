/**
 * ONE structured-data extraction for topics 35, 36, 37, 39.
 *
 * Extracts JSON-LD, Microdata and RDFa (D5). Parse failures are recorded
 * separately from invalid types — malformed JSON-LD is not read at all.
 *
 * All four topics classify from StructuredDataExtraction — do not re-parse.
 */

import { parseHtml, type HtmlElement } from './html-parser'

export type StructuredDataFormat = 'json-ld' | 'microdata' | 'rdfa'

export type JsonLdParseFailure = {
  format: 'json-ld'
  /** Raw script body (truncated). */
  raw: string
  detail: string
  /** True when a trailing-comma or similarly unambiguous repair might work. */
  unambiguousSyntaxHint: 'trailing-comma' | 'none'
}

export type StructuredDataNode = {
  format: StructuredDataFormat
  /** Resolved @type names (arrays expanded). */
  types: string[]
  /** Flattened property bag (dot paths for nested plain objects). */
  properties: Record<string, unknown>
  /** Raw @id if present — graph identifier, NOT a fetchable address. */
  id: string | null
  /** @context string(s) if present. */
  context: string | string[] | null
  /** Source path hint (e.g. script index). */
  source: string
}

export type StructuredDataExtraction = {
  pageUrl: string
  nodes: StructuredDataNode[]
  /** Malformed JSON-LD — more severe than invalid @type; markup not read. */
  parseFailures: JsonLdParseFailure[]
}

const URL_PROP_HINT =
  /^(url|image|logo|contentUrl|thumbnailUrl|sameAs|mainEntityOfPage|embedUrl)$/i

/**
 * Extract all structured data from served HTML once.
 */
export function extractStructuredData(
  html: string,
  pageUrl: string,
): StructuredDataExtraction {
  const parsed = parseHtml(html)
  const nodes: StructuredDataNode[] = []
  const parseFailures: JsonLdParseFailure[] = []

  // JSON-LD scripts (head + body)
  const scripts = [
    ...parsed.headElements('script'),
    ...parsed.bodyElements('script'),
  ]
  let scriptIdx = 0
  for (const script of scripts) {
    const type = (script.attrs.type ?? '').toLowerCase()
    if (type !== 'application/ld+json') continue
    const raw = script.textContent.trim()
    scriptIdx++
    if (!raw) continue
    parseJsonLdBlock(raw, `json-ld#${scriptIdx}`, nodes, parseFailures)
  }

  // Microdata
  extractMicrodata(html, parsed, nodes)

  // RDFa
  extractRdfa(parsed, nodes)

  return { pageUrl, nodes, parseFailures }
}

function parseJsonLdBlock(
  raw: string,
  source: string,
  nodes: StructuredDataNode[],
  failures: JsonLdParseFailure[],
): void {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (err) {
    const hint = /,\s*[}\]]/.test(raw) ? 'trailing-comma' : 'none'
    // Try unambiguous trailing-comma repair only as a hint flag — actual
    // repair is in the fixer; here we still record failure.
    let recovered: unknown = null
    if (hint === 'trailing-comma') {
      try {
        recovered = JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1'))
      } catch {
        recovered = null
      }
    }
    failures.push({
      format: 'json-ld',
      raw: raw.slice(0, 400),
      detail: `JSON-LD parse failure: ${err instanceof Error ? err.message : String(err)}`,
      unambiguousSyntaxHint: recovered != null ? 'trailing-comma' : 'none',
    })
    // If unambiguous trailing-comma recovery worked, still emit nodes from
    // the recovered tree so other topics can classify — but the failure
    // remains recorded as more severe.
    if (recovered != null) {
      walkJsonLd(recovered, source + ':recovered', nodes, null)
    }
    return
  }
  walkJsonLd(data, source, nodes, null)
}

function walkJsonLd(
  data: unknown,
  source: string,
  nodes: StructuredDataNode[],
  inheritedContext: string | string[] | null,
): void {
  if (data == null) return
  if (Array.isArray(data)) {
    data.forEach((item, i) =>
      walkJsonLd(item, `${source}[${i}]`, nodes, inheritedContext),
    )
    return
  }
  if (typeof data !== 'object') return
  const obj = data as Record<string, unknown>

  const ctx =
    obj['@context'] != null
      ? (obj['@context'] as string | string[])
      : inheritedContext

  if (obj['@graph'] != null) {
    walkJsonLd(obj['@graph'], `${source}.@graph`, nodes, ctx)
  }

  const typeRaw = obj['@type']
  if (typeRaw != null) {
    const types = Array.isArray(typeRaw)
      ? typeRaw.map(String)
      : [String(typeRaw)]
    const properties: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('@')) continue
      flattenProp(properties, k, v)
    }
    nodes.push({
      format: 'json-ld',
      types,
      properties,
      id: obj['@id'] != null ? String(obj['@id']) : null,
      context: ctx,
      source,
    })
  }

  // Nested typed objects (e.g. author: { @type: Person })
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('@')) continue
    if (v && typeof v === 'object') {
      walkJsonLd(v, `${source}.${k}`, nodes, ctx)
    }
  }
}

function flattenProp(
  out: Record<string, unknown>,
  key: string,
  value: unknown,
  prefix = '',
): void {
  const path = prefix ? `${prefix}.${key}` : key
  if (value == null) {
    out[path] = value
    return
  }
  if (Array.isArray(value)) {
    out[path] = value
    value.forEach((item, i) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        for (const [k, v] of Object.entries(item as object)) {
          if (k.startsWith('@')) {
            out[`${path}[${i}].${k}`] = v
          } else {
            flattenProp(out, k, v, `${path}[${i}]`)
          }
        }
      }
    })
    return
  }
  if (typeof value === 'object') {
    out[path] = value
    for (const [k, v] of Object.entries(value as object)) {
      if (k.startsWith('@')) {
        out[`${path}.${k}`] = v
      } else {
        flattenProp(out, k, v, path)
      }
    }
    return
  }
  out[path] = value
}

function extractMicrodata(
  _html: string,
  parsed: ReturnType<typeof parseHtml>,
  nodes: StructuredDataNode[],
): void {
  let idx = 0
  const walkEl = (el: HtmlElement['node']) => {
    const attrs: Record<string, string> = {}
    for (const a of el.attrs) attrs[a.name] = a.value
    const hasScope = Object.prototype.hasOwnProperty.call(attrs, 'itemscope')
    const itemtype = attrs.itemtype ?? ''
    if (hasScope && itemtype) {
      idx++
      const types = itemtype
        .split(/\s+/)
        .map((t) => t.replace(/^https?:\/\/schema\.org\//i, ''))
        .filter(Boolean)
      const properties: Record<string, unknown> = {}
      collectMicrodataProps(el, properties)
      nodes.push({
        format: 'microdata',
        types,
        properties,
        id: attrs.itemid ?? null,
        context: 'https://schema.org',
        source: `microdata#${idx}`,
      })
    }
    for (const child of el.childNodes) {
      if (
        child.nodeName !== '#text' &&
        child.nodeName !== '#comment' &&
        'tagName' in child
      ) {
        walkEl(child as HtmlElement['node'])
      }
    }
  }

  // Walk from html root via any head/body element we can reach
  for (const el of [
    ...parsed.headElements('html'),
    ...parsed.bodyElements('body'),
    ...parsed.headElements('body'),
  ]) {
    walkEl(el.node)
  }
  // Also walk common hosts found in body
  for (const tag of ['div', 'section', 'article', 'main', 'li', 'span']) {
    for (const el of parsed.bodyElements(tag)) {
      walkEl(el.node)
    }
  }
}

function collectMicrodataProps(
  node: HtmlElement['node'],
  out: Record<string, unknown>,
): void {
  const walk = (n: typeof node) => {
    for (const child of n.childNodes) {
      if (
        child.nodeName === '#text' ||
        child.nodeName === '#comment' ||
        !('tagName' in child)
      ) {
        continue
      }
      const el = child as HtmlElement['node']
      const attrs: Record<string, string> = {}
      for (const a of el.attrs) attrs[a.name] = a.value
      if (attrs.itemprop) {
        const prop = attrs.itemprop
        const val =
          attrs.content ??
          attrs.href ??
          attrs.src ??
          textContent(el)
        if (out[prop] == null) out[prop] = val
        else if (Array.isArray(out[prop])) (out[prop] as unknown[]).push(val)
        else out[prop] = [out[prop], val]
      }
      // Don't descend into nested itemscope as flat props of parent
      if (!Object.prototype.hasOwnProperty.call(attrs, 'itemscope')) {
        walk(el)
      }
    }
  }
  walk(node)
}

function textContent(node: HtmlElement['node']): string {
  let s = ''
  for (const child of node.childNodes) {
    if (child.nodeName === '#text') {
      s += (child as { value: string }).value
    } else if ('tagName' in child) {
      s += textContent(child as HtmlElement['node'])
    }
  }
  return s.trim()
}

function extractRdfa(
  parsed: ReturnType<typeof parseHtml>,
  nodes: StructuredDataNode[],
): void {
  const all = collectAllElements(parsed)
  let idx = 0
  for (const el of all) {
    const typeofAttr = el.attrs.typeof ?? el.attrs['typeof']
    if (!typeofAttr) continue
    idx++
    const vocab = el.attrs.vocab ?? 'https://schema.org/'
    const types = typeofAttr.split(/\s+/).map((t) => {
      if (t.startsWith('http')) return t.replace(/^https?:\/\/schema\.org\//i, '')
      return t
    })
    const properties: Record<string, unknown> = {}
    // Collect property attrs on descendants
    collectRdfaProps(el.node, properties)
    nodes.push({
      format: 'rdfa',
      types,
      properties,
      id: el.attrs.resource ?? el.attrs.about ?? null,
      context: vocab.includes('schema.org') ? 'https://schema.org' : vocab,
      source: `rdfa#${idx}`,
    })
  }
}

function collectRdfaProps(
  node: HtmlElement['node'],
  out: Record<string, unknown>,
): void {
  const walk = (n: typeof node) => {
    for (const child of n.childNodes) {
      if (
        child.nodeName === '#text' ||
        child.nodeName === '#comment' ||
        !('tagName' in child)
      ) {
        continue
      }
      const el = child as HtmlElement['node']
      const attrs: Record<string, string> = {}
      for (const a of el.attrs) attrs[a.name] = a.value
      if (attrs.property) {
        const prop = attrs.property.replace(/^schema:/, '')
        const val =
          attrs.content ?? attrs.href ?? attrs.resource ?? textContent(el)
        out[prop] = val
      }
      if (!attrs.typeof) walk(el)
    }
  }
  walk(node)
}

function collectAllElements(
  parsed: ReturnType<typeof parseHtml>,
): HtmlElement[] {
  // Broad tag walk — gather from common containers
  const tags = [
    'div',
    'section',
    'article',
    'main',
    'span',
    'p',
    'ul',
    'li',
    'nav',
    'header',
    'footer',
    'aside',
    'figure',
    'body',
    'html',
  ]
  const seen = new Set<HtmlElement['node']>()
  const out: HtmlElement[] = []
  for (const tag of tags) {
    for (const el of [
      ...parsed.headElements(tag),
      ...parsed.bodyElements(tag),
    ]) {
      if (seen.has(el.node)) continue
      seen.add(el.node)
      out.push(el)
    }
  }
  // Also any element with itemscope/typeof — scan body children recursively
  // via walking script-free: use bodyElements for 'div' already. Add itemprop hosts.
  return out
}

/**
 * Collect URL-valued property paths from a node (excludes @id).
 */
export function collectUrlProperties(
  node: StructuredDataNode,
): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = []
  for (const [path, value] of Object.entries(node.properties)) {
    const leaf = path.split('.').pop()!.replace(/\[\d+\]/g, '')
    if (leaf === '@id') continue
    if (URL_PROP_HINT.test(leaf) || leaf.endsWith('Url') || leaf.endsWith('URL')) {
      pushUrl(out, path, value)
    } else if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      // absolute URL in a non-hint property — still a URL value
      if (leaf === 'url' || leaf === 'image' || leaf === 'sameAs' || leaf === 'logo') {
        pushUrl(out, path, value)
      }
    }
  }
  // image may be ImageObject
  const img = node.properties.image
  if (img && typeof img === 'object' && !Array.isArray(img)) {
    const o = img as Record<string, unknown>
    if (typeof o.url === 'string') out.push({ path: 'image.url', value: o.url })
    if (typeof o.contentUrl === 'string') {
      out.push({ path: 'image.contentUrl', value: o.contentUrl })
    }
  }
  if (Array.isArray(img)) {
    img.forEach((item, i) => {
      if (typeof item === 'string') out.push({ path: `image[${i}]`, value: item })
      else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        if (typeof o.url === 'string') {
          out.push({ path: `image[${i}].url`, value: o.url })
        }
      }
    })
  }
  return out
}

function pushUrl(
  out: Array<{ path: string; value: string }>,
  path: string,
  value: unknown,
): void {
  if (typeof value === 'string' && value.trim()) {
    out.push({ path, value: value.trim() })
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => {
      if (typeof v === 'string' && v.trim()) {
        out.push({ path: `${path}[${i}]`, value: v.trim() })
      }
    })
  }
}

/** Get a property value by path (supports author.name). */
export function getProp(
  node: StructuredDataNode,
  path: string,
): unknown {
  if (path in node.properties) return node.properties[path]
  // author.name from nested author object
  const parts = path.split('.')
  let cur: unknown = node.properties[parts[0]!]
  for (let i = 1; i < parts.length; i++) {
    if (cur == null) return undefined
    if (Array.isArray(cur)) cur = cur[0]
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[parts[i]!]
  }
  return cur
}

export function hasNonEmptyProp(
  node: StructuredDataNode,
  path: string,
): boolean {
  const v = getProp(node, path)
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}
