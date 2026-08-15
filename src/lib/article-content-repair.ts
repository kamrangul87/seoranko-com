// Shared repair pass for saved article HTML — merge-artifact typos and missing
// SEO meta description. Used by the one-off DB script and the cron repair route.

import {
  applyDeterministicMergeFixes,
  detectMergeArtifacts,
} from '@/lib/merge-artifact-repair'

export interface ArticleRepairResult {
  content: string
  mergeFixes: number
  metaDescriptionAdded: boolean
  changed: boolean
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function resolveDescription(content: string, metaDescription?: string | null): string {
  const fromColumn = metaDescription?.trim()
  if (fromColumn) return fromColumn

  const metaComment = content.match(/<!-- META:\s*([^-]+?)\s*-->/i)
  if (metaComment?.[1]?.trim()) return metaComment[1].trim()

  const ogMatch = content.match(
    /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i
  )
  if (ogMatch?.[1]) return decodeHtmlEntities(ogMatch[1].trim())

  const twitterMatch = content.match(
    /<meta\s+name=["']twitter:description["']\s+content=["']([^"']*)["']/i
  )
  if (twitterMatch?.[1]) return decodeHtmlEntities(twitterMatch[1].trim())

  return ''
}

export function injectMissingMetaDescription(
  content: string,
  metaDescription?: string | null
): { content: string; added: boolean } {
  if (/<meta\s+name=["']description["']/i.test(content)) {
    return { content, added: false }
  }

  const description = resolveDescription(content, metaDescription)
  if (!description) return { content, added: false }

  const seoDesc = description.length > 160 ? `${description.slice(0, 157)}...` : description
  const safeSeoDesc = seoDesc.replace(/"/g, '&quot;')
  const tag = `<meta name="description" content="${safeSeoDesc}" />`

  if (/<meta\s+property=["']og:type["']/i.test(content)) {
    return {
      content: content.replace(/(<meta\s+property=["']og:type["'])/i, `${tag}\n$1`),
      added: true,
    }
  }

  return { content: `${content}\n\n${tag}`, added: true }
}

export function repairArticleContent(
  content: string,
  metaDescription?: string | null
): ArticleRepairResult {
  const merge = applyDeterministicMergeFixes(content)
  const meta = injectMissingMetaDescription(merge.content, metaDescription)

  return {
    content: meta.content,
    mergeFixes: merge.fixesMade,
    metaDescriptionAdded: meta.added,
    changed: meta.content !== content,
  }
}

export function articleNeedsRepair(content: string): boolean {
  if (detectMergeArtifacts(content).length > 0) return true
  if (!/<meta\s+name=["']description["']/i.test(content)) {
    const hasSocialDesc =
      /<meta\s+property=["']og:description["']/i.test(content) ||
      /<!-- META:\s*[^-]+?\s*-->/i.test(content)
    if (hasSocialDesc) return true
  }
  return false
}
