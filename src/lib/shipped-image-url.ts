/**
 * Pick the Article.image URL from assets that actually ship in the final HTML.
 * Prefer hero; otherwise first content image with an absolute https URL.
 * Also accepts absolute https src values already present in the HTML figures.
 */

export function isAbsoluteHttpsUrl(url: string | undefined | null): url is string {
  return !!url && /^https:\/\/\S+/i.test(url.trim())
}

export interface ShippedImageSource {
  heroUrl?: string | null
  contentUrls?: Array<string | null | undefined>
}

/**
 * Prefer hero, else first valid content URL from the image set.
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
 * Prefer image-set URLs; if none, fall back to first absolute https <img src>
 * in the finalized HTML (covers inject edge cases).
 */
export function pickPrimaryShippedImageUrlFromHtml(
  html: string,
  source?: ShippedImageSource,
): string | undefined {
  const fromSet = source ? pickPrimaryShippedImageUrl(source) : undefined
  if (fromSet) return fromSet

  const re = /<img\b[^>]*\bsrc=["'](https:\/\/[^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (isAbsoluteHttpsUrl(m[1])) return m[1]
  }
  return undefined
}
