// Shared repair pass for saved article HTML — merge-artifact typos and missing
// SEO meta description. Used by the one-off DB script and the cron repair route.

import {
  applyDeterministicMergeFixes,
  detectMergeArtifacts,
} from '@/lib/merge-artifact-repair'
import {
  extractArticleDescription,
  extractMetaComment,
  dedupeMetaDescriptionTags,
} from '@/lib/extract-meta-description'

export interface ArticleRepairResult {
  content: string
  mergeFixes: number
  metaDescriptionAdded: boolean
  changed: boolean
}

export function injectMissingMetaDescription(
  content: string,
  metaDescription?: string | null
): { content: string; added: boolean } {
  const deduped = dedupeMetaDescriptionTags(content)
  if (/<meta\s+name=["']description["']/i.test(deduped)) {
    return { content: deduped, added: deduped !== content }
  }

  const description =
    metaDescription?.trim() ||
    extractArticleDescription(deduped) ||
    extractMetaComment(deduped) ||
    ''
  if (!description) return { content: deduped, added: deduped !== content }

  const seoDesc = description.length > 160 ? `${description.slice(0, 157)}...` : description
  const safeSeoDesc = seoDesc.replace(/"/g, '&quot;')
  const tag = `<meta name="description" content="${safeSeoDesc}" />`

  if (/<meta\s+property=["']og:type["']/i.test(deduped)) {
    return {
      content: deduped.replace(/(<meta\s+property=["']og:type["'])/i, `${tag}\n$1`),
      added: true,
    }
  }

  return { content: `${deduped}\n\n${tag}`, added: true }
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
  const descTags = content.match(/<meta\s+name=["']description["']/gi) || []
  if (descTags.length > 1) return true
  if (/Article about\s+/i.test(content) && /<meta\s+name=["']description["'][^>]*Article about/i.test(content)) {
    return true
  }
  if (!/<meta\s+name=["']description["']/i.test(content)) {
    const hasSocialDesc =
      /<meta\s+property=["']og:description["']/i.test(content) ||
      /<!--\s*META:/i.test(content)
    if (hasSocialDesc) return true
  }
  return false
}
