/**
 * Final-artifact builder for article-v2.
 *
 * FINAL ARTIFACT INVARIANT:
 * The HTML returned from `buildFinalArticleArtifact` (then Quality-Gate
 * autofix/scrub) is the sole canonical artifact for publishing, saving,
 * streaming to the UI, and final Quality Gate scoring. Intermediate prose
 * snapshots must not determine the persisted schema score or quality result.
 *
 * Pipeline order (Phase 1):
 *   prose transforms (caller)
 *   → image injection
 *   → final paragraph/scannability transforms
 *   → schema synchronization (strip → generate → append)
 *   → final Quality Gate (caller)
 *   → final score / save / stream (caller)
 *
 * Does NOT wire structured-article-schema.ts.
 */

import { injectImagesIntoArticle, type ArticleImageSet } from './image-generator'
import { splitDenseParagraphs } from './paragraph-splitter'
import {
  generateArticleSchema,
  type ArticleSchemaInput,
  type GeneratedSchema,
} from './schema-generator'
import { applyGeneratedSchemaToHtml } from './schema-dedupe'
import { pickPrimaryShippedImageUrlFromHtml } from './shipped-image-url'
import { countArticleWords } from './word-count-enforcer'

/** Documented order for regression tests and route comments. */
export const FINAL_ARTIFACT_PIPELINE_ORDER = [
  'prose_transforms',
  'image_injection',
  'final_paragraph_scannability',
  'schema_synchronization',
  'final_quality_gate',
  'final_score_save_stream',
] as const

export type FinalArtifactPipelineStep = (typeof FINAL_ARTIFACT_PIPELINE_ORDER)[number]

export interface BuildFinalArticleArtifactInput {
  /** HTML after prose transforms (humanize, links, autoSplit, TOC, etc.). */
  proseHtml: string
  imageSet?: ArticleImageSet | null
  /** Schema fields except imageUrl/wordCount — both derived from the final HTML. */
  schemaInput: Omit<ArticleSchemaInput, 'imageUrl' | 'wordCount'>
  /**
   * Optional enrichments after image pick and before schema sync
   * (social meta, canonical, last-verified) so OG:image can match Article.image.
   */
  enrichBeforeSchema?: (html: string, primaryImageUrl: string | undefined) => string
}

export interface BuildFinalArticleArtifactResult {
  /** Canonical HTML with images, scannability splits, and synced JSON-LD. */
  html: string
  schemaResult: GeneratedSchema
  /** Absolute https Article.image candidate (hero, else first content / figure). */
  primaryImageUrl: string | undefined
  figureCount: number
  /** Hero URL set but injection produced zero <figure> tags. */
  imageHandOffError?: string
}

/**
 * Build the pre–Quality-Gate final artifact: inject → split → pick image →
 * schema sync. Caller runs assertSchemaCompleteness + runQualityGate on
 * `result.html`, then saves/streams that same artifact (post autofix/scrub).
 */
export function buildFinalArticleArtifact(
  input: BuildFinalArticleArtifactInput,
): BuildFinalArticleArtifactResult {
  let html = input.proseHtml
  let figureCount = 0
  let imageHandOffError: string | undefined

  // ── 1. Image injection ─────────────────────────────────────────────────
  if (input.imageSet) {
    const withImages = injectImagesIntoArticle(html, input.imageSet)
    figureCount = (withImages.match(/<figure[\s>]/gi) || []).length
    if (input.imageSet.hero?.url && figureCount === 0) {
      imageHandOffError =
        `Image hand-off post-condition failed: imageSet.hero.url is set (${input.imageSet.hero.url}) but the serialized article has 0 <figure> tags after injection.`
      // Keep pre-injection HTML — figureless state must not ship (hard block).
    } else {
      html = withImages
    }
  }

  // ── 2. Final paragraph / scannability transforms ───────────────────────
  html = splitDenseParagraphs(html)

  // ── 3. Primary shipped image (hero → content → first figure src) ───────
  // Only URLs that actually appear in `html` after injection qualify —
  // never invent Article.image from an image-set URL that failed to ship.
  const primaryImageUrl = pickPrimaryShippedImageUrlFromHtml(html, {
    heroUrl: input.imageSet?.hero?.url,
    contentUrls: input.imageSet?.content?.map((c) => c.url) ?? [],
  })

  // ── 3b. Social / canonical / verified (optional; keeps OG:image in sync) ─
  if (input.enrichBeforeSchema) {
    html = input.enrichBeforeSchema(html, primaryImageUrl)
  }

  // ── 4. Schema synchronization (idempotent strip → generate → append) ───
  const schemaResult = generateArticleSchema({
    ...input.schemaInput,
    imageUrl: primaryImageUrl,
    wordCount: countArticleWords(html),
  })
  html = applyGeneratedSchemaToHtml(html, schemaResult.combinedScriptTag)

  return {
    html,
    schemaResult,
    primaryImageUrl,
    figureCount,
    imageHandOffError,
  }
}
