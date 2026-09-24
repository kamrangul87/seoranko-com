export type RenderMode = 'http' | 'rendered' | 'render_failed'

/** Which HTML representation a detector judges. */
export type DetectorRepresentation = 'raw' | 'rendered' | 'both'

export type PageRenderEvidence = {
  url: string
  renderMode: RenderMode
  rawHtmlHash: string
  renderedHtmlHash: string | null
  renderNeeded: boolean
  renderNeededReasons: string[]
  rawHtml: string
  /** Populated when renderMode === 'rendered'. */
  renderedHtml: string | null
  renderError: string | null
  /** Wall-clock ms spent in headless render (0 when skipped). */
  renderTookMs: number
}
