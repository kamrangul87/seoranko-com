/**
 * Topic 49 — set width/height on an <img> (fixture-only HTML transform).
 * Does not import the verifier.
 */

export function setImgDimensions(
  html: string,
  srcAttr: string,
  width: number,
  height: number,
): { html: string; updated: number } {
  const escaped = srcAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<img\\b([^>]*\\bsrc\\s*=\\s*["']${escaped}["'][^>]*)>`, 'gi')
  let updated = 0

  const next = html.replace(re, (full, inner: string) => {
    updated++
    let attrs = inner
    // Remove existing width/height attributes
    attrs = attrs.replace(/\swidth\s*=\s*(["'][^"']*["']|\S+)/gi, '')
    attrs = attrs.replace(/\sheight\s*=\s*(["'][^"']*["']|\S+)/gi, '')
    return `<img width="${width}" height="${height}"${attrs}>`
  })

  return { html: next, updated }
}
