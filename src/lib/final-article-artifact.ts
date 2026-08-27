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
import {
  assertArticleImageSynchronized,
  injectFallbackHeroFigure,
} from './article-image-guard'
import { enforceScannability } from './scannability-enforcer'
import { normalizeArticleTypography } from './typography-normalizer'
import { assertNoDocumentWrapperTags } from './html-document-guard'
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
  /**
   * M06 — width of primaryImageUrl, when it resolved to a known imageSet
   * entry (hero/content). undefined when primaryImageUrl fell through to
   * the raw-<img>-scan fallback (no width data available for that case) or
   * no image shipped at all.
   */
  primaryImageWidth: number | undefined
  figureCount: number
  /** Hero URL set but injection produced zero <figure> tags. */
  imageHandOffError?: string
  /** Dense paragraphs the mechanical splitters could not break up. */
  scannabilityError?: string
  /** Article schema does not carry an image the page actually ships. */
  schemaImageError?: string
  /** Article content still carries a stray <!DOCTYPE>/<html>/<head>/<body> tag. */
  documentStructureError?: string
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

  // ── 0. Typographic normalization (visible text only) ───────────────────
  html = normalizeArticleTypography(html)

  // ── 1. Image injection ─────────────────────────────────────────────────
  if (input.imageSet) {
    let withImages = injectImagesIntoArticle(html, input.imageSet)
    figureCount = (withImages.match(/<figure[\s>]/gi) || []).length
    if (input.imageSet.hero?.url && figureCount === 0) {
      // Mechanical retry before giving up: a generated/stored hero must not
      // be dropped (and with it Article.image) because normal injection
      // found no anchor it recognised.
      withImages = injectFallbackHeroFigure(withImages, input.imageSet.hero)
      figureCount = (withImages.match(/<figure[\s>]/gi) || []).length
    }
    if (input.imageSet.hero?.url && figureCount === 0) {
      imageHandOffError =
        `Image hand-off post-condition failed: imageSet.hero.url is set (${input.imageSet.hero.url}) but the serialized article has 0 <figure> tags after injection.`
      // Keep pre-injection HTML — figureless state must not ship (hard block).
    } else {
      html = withImages
    }
  }

  // ── 2. Final paragraph / scannability transforms ───────────────────────
  // Repairs, then RE-VALIDATES with the validator's own dense-paragraph
  // rule — an unsplittable shape is reported, never assumed fixed.
  const scannability = enforceScannability(html)
  html = scannability.html

  // ── 3. Primary shipped image (hero → content → first figure src) ───────
  // Only URLs that actually appear in `html` after injection qualify —
  // never invent Article.image from an image-set URL that failed to ship.
  const primaryImageUrl = pickPrimaryShippedImageUrlFromHtml(html, {
    heroUrl: input.imageSet?.hero?.url,
    contentUrls: input.imageSet?.content?.map((c) => c.url) ?? [],
  })
  const primaryImageWidth =
    primaryImageUrl && input.imageSet?.hero?.url === primaryImageUrl
      ? input.imageSet.hero.width
      : input.imageSet?.content?.find((c) => c.url === primaryImageUrl)?.width

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

  // ── 5. Post-conditions on the synchronized artifact ────────────────────
  const schemaImageError = assertArticleImageSynchronized(html)
  const documentStructureError = assertNoDocumentWrapperTags(html)

  return {
    html,
    schemaResult,
    primaryImageUrl,
    primaryImageWidth,
    figureCount,
    imageHandOffError,
    scannabilityError: scannability.error,
    schemaImageError,
    documentStructureError,
  }
}
