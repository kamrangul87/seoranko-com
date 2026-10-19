/**
 * Permanent policy: render failure must never discard raw-HTML findings.
 * Render-dependent (representation === 'rendered') checks are marked
 * `render_unavailable` instead of judging a pre-hydration shell.
 */

import { representationForTopic } from './detector-representation'
import type { RenderMode } from './types'

/** clientOnly discard path — false when render ran (success or fail) so raw HTML stays judgeable. */
export function clientOnlyAfterRender(input: {
  shellLooksClientOnly: boolean
  renderMode: RenderMode
}): boolean {
  if (input.renderMode === 'rendered' || input.renderMode === 'render_failed') {
    return false
  }
  return input.shellLooksClientOnly
}

/** True when this topic needs a rendered DOM and render failed. */
export function isRenderDependentTopicUnavailable(
  topicId: string,
  renderMode: RenderMode,
): boolean {
  return (
    renderMode === 'render_failed' && representationForTopic(topicId) === 'rendered'
  )
}

export function renderUnavailableEmit(input: {
  pageUrl: string
  renderError: string | null
  skippedTopicIds: string[]
}): {
  topicId: string
  kind: string
  verdict: string
  severity: string
  detail: string
  pageUrl: string
  declarationSite: string
  autoFixable: boolean
  proposedDiff: null
  evidenceValues: Record<string, unknown>
  bucket: 'informational'
} {
  const err = input.renderError || 'unknown'
  return {
    topicId: '67',
    kind: 'crawl/render-unavailable',
    verdict: 'render_unavailable',
    severity: 'informational',
    detail: `Render-dependent checks unavailable (${err}) — raw-HTML detectors still ran`,
    pageUrl: input.pageUrl,
    declarationSite: input.pageUrl,
    autoFixable: false,
    proposedDiff: null,
    evidenceValues: {
      renderError: err,
      skippedTopicIds: input.skippedTopicIds,
    },
    bucket: 'informational',
  }
}

/** Rendered-only topic ids we skip on render_failed in the per-page detector loop. */
export const RENDER_DEPENDENT_CHUNK_TOPIC_IDS = [
  '29',
  '30',
  '31',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  '42',
  '49',
] as const
