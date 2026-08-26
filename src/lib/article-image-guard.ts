// src/lib/article-image-guard.ts
// Post-condition guard for Article.image (Google's Article rich-result
// image property).
//
// Article.image is derived from the image that actually ships in the final
// HTML. That is the right rule — schema must never claim an image the page
// does not have — but it silently produced an image-less Article schema
// whenever image INJECTION produced no <figure> while the generated/stored
// hero was perfectly usable: the builder threw the injected HTML away and
// nothing retried, so an article with a stored hero shipped with no
// Article.image at all. This module supplies the mechanical retry (inject a
// minimal hero figure) and the verification that the synchronized JSON-LD
// really carries the image the page ships.

import { parse } from 'node-html-parser'
import { isAbsoluteHttpsUrl } from './shipped-image-url'

export interface HeroImageLike {
  url: string
  alt?: string
  width?: number
  height?: number
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Minimal, deterministic hero <figure> used only when normal injection produced none. */
export function buildFallbackHeroFigure(hero: HeroImageLike): string {
  return `<figure class="article-hero-image" style="margin:0 0 2rem 0;">
  <img src="${hero.url}" alt="${escapeAttr(hero.alt || '')}"${hero.width ? ` width="${hero.width}"` : ''}${hero.height ? ` height="${hero.height}"` : ''} loading="eager" decoding="async" style="width:100%;height:auto;border-radius:8px;" />
</figure>`
}

/** Insert a hero figure before the H1 (or at the top when there is no H1). */
export function injectFallbackHeroFigure(html: string, hero: HeroImageLike): string {
  if (!isAbsoluteHttpsUrl(hero.url)) return html
  const figure = buildFallbackHeroFigure(hero)
  const root = parse(html)
  const h1 = root.querySelector('h1')
  if (h1) {
    h1.insertAdjacentHTML('beforebegin', figure + '\n')
  } else {
    root.insertAdjacentHTML('afterbegin', figure + '\n')
  }
  return root.toString()
}

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed: unknown = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) blocks.push(...parsed)
      else blocks.push(parsed)
    } catch {
      /* invalid JSON-LD is schema-validator's problem, not this guard's */
    }
  }
  return blocks
}

function usableImageUrl(image: unknown): boolean {
  const candidates = Array.isArray(image) ? image : [image]
  return candidates.some((entry) => {
    const url = typeof entry === 'string' ? entry : (entry as { url?: unknown })?.url
    return typeof url === 'string' && /^https?:\/\/\S+/i.test(url)
  })
}

/** True when the embedded Article/BlogPosting JSON-LD carries a resolvable image. */
export function articleSchemaHasUsableImage(html: string): boolean {
  for (const block of jsonLdBlocks(html)) {
    const record = block as { '@type'?: unknown; image?: unknown }
    const rawType = record['@type']
    const type = Array.isArray(rawType) ? rawType[0] : rawType
    if (type !== 'Article' && type !== 'BlogPosting' && type !== 'NewsArticle') continue
    if (record.image !== undefined && usableImageUrl(record.image)) return true
  }
  return false
}

/** First absolute-https <img src> that actually ships in the HTML. */
export function firstShippedImageUrl(html: string): string | undefined {
  const re = /<img\b[^>]*\bsrc=["'](https:\/\/[^"']+)["']/gi
  const m = re.exec(html)
  return m?.[1]
}

/**
 * Article.image post-condition: an image that ships on the page must also be
 * in the Article schema. Returns a blocking reason when it is not.
 */
export function assertArticleImageSynchronized(html: string): string | undefined {
  const shipped = firstShippedImageUrl(html)
  if (!shipped) return undefined
  if (articleSchemaHasUsableImage(html)) return undefined
  return `Article.image post-condition failed: the article ships an image (${shipped}) but the embedded Article schema has no usable image property.`
}
