/**
 * Resolve raw HTTP HTML into a PageRenderEvidence record (optional headless render).
 */

import { detectRenderNeeded } from './detect'
import { hashHtml } from './hash'
import { renderPageHtml } from './render'
import type { PageRenderEvidence, RenderMode } from './types'

export async function resolvePageRender(input: {
  url: string
  rawHtml: string
  /** Skip headless even when detect says needed (tests). */
  skipRender?: boolean
}): Promise<PageRenderEvidence> {
  const rawHtmlHash = hashHtml(input.rawHtml)
  const needed = detectRenderNeeded(input.rawHtml)

  if (!needed.needed) {
    return {
      url: input.url,
      renderMode: 'http',
      rawHtmlHash,
      renderedHtmlHash: null,
      renderNeeded: false,
      renderNeededReasons: [],
      rawHtml: input.rawHtml,
      renderedHtml: null,
      renderError: null,
      renderTookMs: 0,
    }
  }

  if (input.skipRender) {
    return {
      url: input.url,
      renderMode: 'render_failed',
      rawHtmlHash,
      renderedHtmlHash: null,
      renderNeeded: true,
      renderNeededReasons: needed.reasons,
      rawHtml: input.rawHtml,
      renderedHtml: null,
      renderError: 'skip_render',
      renderTookMs: 0,
    }
  }

  const rendered = await renderPageHtml(input.url)
  if (!rendered.ok) {
    return {
      url: input.url,
      renderMode: 'render_failed' satisfies RenderMode,
      rawHtmlHash,
      renderedHtmlHash: null,
      renderNeeded: true,
      renderNeededReasons: needed.reasons,
      rawHtml: input.rawHtml,
      renderedHtml: null,
      renderError: rendered.error,
      renderTookMs: rendered.tookMs,
    }
  }

  return {
    url: input.url,
    renderMode: 'rendered',
    rawHtmlHash,
    renderedHtmlHash: hashHtml(rendered.html),
    renderNeeded: true,
    renderNeededReasons: needed.reasons,
    rawHtml: input.rawHtml,
    renderedHtml: rendered.html,
    renderError: null,
    renderTookMs: rendered.tookMs,
  }
}

/** HTML detectors should judge (rendered when available). */
export function htmlForDetectors(evidence: PageRenderEvidence): string {
  if (evidence.renderMode === 'rendered' && evidence.renderedHtml) {
    return evidence.renderedHtml
  }
  return evidence.rawHtml
}

/** True when we must not emit a headline actionable verdict for this page. */
export function suppressHeadlineVerdict(evidence: PageRenderEvidence): boolean {
  return evidence.renderMode === 'render_failed'
}
