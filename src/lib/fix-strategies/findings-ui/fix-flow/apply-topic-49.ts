/**
 * Topic 49 — apply auto-set-dimensions to HTML source.
 * Re-detects on the file and writes intrinsic width/height for every
 * auto-set-dimensions emit. Does not invent dimensions.
 */

import { detectImgMissingDimensions } from '@/lib/fix-strategies/topic-49'
import { setImgDimensions } from '@/lib/fix-strategies/topic-49/fix-set-dimensions'

export type ApplyTopic49Result = {
  html: string
  updated: number
  applied: Array<{
    srcAttr: string
    width: number
    height: number
  }>
  detail: string
}

export async function applyTopic49AutoSetDimensions(
  html: string,
  pageUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApplyTopic49Result> {
  const detected = await detectImgMissingDimensions(html, pageUrl, {
    fetch: fetchImpl,
    isGenerated: true,
  })

  let next = html
  let updated = 0
  const applied: ApplyTopic49Result['applied'] = []

  for (const f of detected.findings) {
    if (f.verdict !== 'auto-set-dimensions' || !f.proposed) continue
    const res = setImgDimensions(
      next,
      f.srcAttr,
      f.proposed.width,
      f.proposed.height,
    )
    if (res.updated > 0) {
      next = res.html
      updated += res.updated
      applied.push({
        srcAttr: f.srcAttr,
        width: f.proposed.width,
        height: f.proposed.height,
      })
    }
  }

  return {
    html: next,
    updated,
    applied,
    detail:
      updated > 0
        ? `Set width/height on ${updated} img(s) from intrinsic headers`
        : 'No auto-set-dimensions targets in source HTML',
  }
}

/** Build a short before/after snippet for UI proposedDiff. */
export function topic49ProposedSnippet(
  srcAttr: string,
  proposed: { width: number; height: number } | null,
  declared: { width: number | null; height: number | null },
): { summary: string; before: string; after: string } | null {
  if (!proposed) {
    return {
      summary: 'Human review — dimensions not auto-applied',
      before: `<img src="${srcAttr}"${
        declared.width != null ? ` width="${declared.width}"` : ''
      }${declared.height != null ? ` height="${declared.height}"` : ''}>`,
      after: '— (requires human decision; not auto-applied)',
    }
  }
  return {
    summary: `Set width=${proposed.width} height=${proposed.height} from image header`,
    before: `<img src="${srcAttr}"${
      declared.width != null ? ` width="${declared.width}"` : ''
    }${declared.height != null ? ` height="${declared.height}"` : ''}>`,
    after: `<img width="${proposed.width}" height="${proposed.height}" src="${srcAttr}">`,
  }
}
