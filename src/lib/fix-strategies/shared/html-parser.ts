import { parse, type DefaultTreeAdapterMap } from 'parse5'

type Document = DefaultTreeAdapterMap['document']
type Element = DefaultTreeAdapterMap['element']
type ParentNode = Document | Element
type ChildNode = ParentNode['childNodes'][number]

export type HtmlElement = {
  tagName: string
  attrs: Record<string, string>
  textContent: string
  /** parse5 element — for advanced callers */
  node: Element
}

export type ParsedHtml = {
  document: Document
  headElements: (tagName: string) => HtmlElement[]
  bodyElements: (tagName: string) => HtmlElement[]
  /** Lightweight tag lookup scoped to head or body. */
  queryHead: (tagName: string) => HtmlElement[]
  titleText: () => string | null
  metaByName: (name: string) => HtmlElement | null
}

function isElement(node: ChildNode): node is Element {
  return node.nodeName !== '#text' && node.nodeName !== '#comment' && 'tagName' in node
}

function findChildElement(
  parent: ParentNode,
  tagName: string,
): Element | null {
  for (const child of parent.childNodes) {
    if (isElement(child) && child.tagName === tagName) return child
  }
  return null
}

function findHtmlElement(doc: Document): Element | null {
  for (const child of doc.childNodes) {
    if (isElement(child) && child.tagName === 'html') return child
  }
  return null
}

function attrsToRecord(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const attr of el.attrs) {
    out[attr.name] = attr.value
  }
  return out
}

function textOf(node: ChildNode): string {
  if (node.nodeName === '#text') {
    return (node as DefaultTreeAdapterMap['textNode']).value
  }
  if (!isElement(node)) return ''
  let s = ''
  for (const child of node.childNodes) {
    s += textOf(child)
  }
  return s
}

function collectByTag(parent: Element | null, tagName: string): HtmlElement[] {
  if (!parent) return []
  const want = tagName.toLowerCase()
  const out: HtmlElement[] = []

  const walk = (node: ChildNode) => {
    if (!isElement(node)) return
    if (node.tagName === want) {
      out.push({
        tagName: node.tagName,
        attrs: attrsToRecord(node),
        textContent: textOf(node),
        node,
      })
    }
    for (const child of node.childNodes) walk(child)
  }

  for (const child of parent.childNodes) walk(child)
  return out
}

/**
 * Parse HTML with parse5 (tree builder — not regex).
 *
 * A `<div>` (or other body-content element) before `</head>` implicitly closes
 * `<head>`; subsequent tags such as `<meta>` land in `<body>`, matching the
 * HTML parsing algorithm.
 */
export function parseHtml(html: string): ParsedHtml {
  const document = parse(html)
  const htmlEl = findHtmlElement(document)
  const head = htmlEl ? findChildElement(htmlEl, 'head') : null
  const body = htmlEl ? findChildElement(htmlEl, 'body') : null

  const headElements = (tagName: string) => collectByTag(head, tagName)
  const bodyElements = (tagName: string) => collectByTag(body, tagName)

  return {
    document,
    headElements,
    bodyElements,
    queryHead: headElements,
    titleText: () => {
      const titles = headElements('title')
      if (titles.length === 0) return null
      return titles[0]!.textContent
    },
    metaByName: (name: string) => {
      const want = name.toLowerCase()
      for (const meta of headElements('meta')) {
        const n = meta.attrs.name ?? meta.attrs.Name
        if (n && n.toLowerCase() === want) return meta
      }
      return null
    },
  }
}
