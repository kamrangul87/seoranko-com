/**
 * Pick the Article.image URL from assets that actually ship in the final HTML.
 * Prefer hero; otherwise first content image with an absolute https URL —
 * but only when that URL is present in the finalized HTML (or as an <img src>).
 */

export function isAbsoluteHttpsUrl(url: string | undefined | null): url is string {
  return !!url && /^https:\/\/\S+/i.test(url.trim())
}

export interface ShippedImageSource {
  heroUrl?: string | null
  contentUrls?: Array<string | null | undefined>
}

/** True when the exact URL appears as an image (or elsewhere) in the HTML. */
export function htmlContainsShippedImageUrl(html: string, url: string): boolean {
  if (!url) return false
  if (html.includes(url)) return true
  // Attribute-escaped variants are uncommon for our CDN URLs; keep exact match.
  return false
}

/**
 * Prefer hero, else first valid content URL from the image set
 * (does not check HTML presence — use pickPrimaryShippedImageUrlFromHtml
 * when synchronizing Article.image to the final artifact).
 */
export function pickPrimaryShippedImageUrl(source: ShippedImageSource): string | undefined {
  if (isAbsoluteHttpsUrl(source.heroUrl ?? undefined)) {
    return source.heroUrl!.trim()
  }
  for (const u of source.contentUrls ?? []) {
    if (isAbsoluteHttpsUrl(u ?? undefined)) return u!.trim()
  }
  return undefined
}

/**
 * Prefer image-set URLs that actually appear in the final HTML (hero first,
 * then content). If none of the set URLs shipped, fall back to the first
 * absolute https <img src> in the HTML.
 *
 * Never returns an image-set URL that is absent from the HTML — that was the
 * Article.image / hand-off desync (schema claimed a hero that never injected).
 */
export function pickPrimaryShippedImageUrlFromHtml(
  html: string,
  source?: ShippedImageSource,
): string | undefined {
  if (source) {
    const ordered: string[] = []
    if (isAbsoluteHttpsUrl(source.heroUrl ?? undefined)) {
      ordered.push(source.heroUrl!.trim())
    }
    for (const u of source.contentUrls ?? []) {
      if (isAbsoluteHttpsUrl(u ?? undefined)) ordered.push(u!.trim())
    }
    for (const url of ordered) {
      if (htmlContainsShippedImageUrl(html, url)) return url
    }
  }

  const re = /<img\b[^>]*\bsrc=["'](https:\/\/[^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (isAbsoluteHttpsUrl(m[1])) return m[1]
  }
  return undefined
}
