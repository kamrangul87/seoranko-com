/**
 * Topic 67 — content presence states for served-HTML fetches.
 *
 * These are not interchangeable:
 * - present: in the complete served stream
 * - client_only: absent from the complete stream (may appear after rendering)
 * - absent: only after a rendered-DOM mode also lacks the signal (not asserted
 *   by served-HTML-only fetches)
 */

export type ContentPresenceState = 'present' | 'client_only' | 'absent'

/**
 * For a served-HTML-only fetch (no rendered-DOM mode): content missing from a
 * complete stream is `client_only`, never `absent`. `absent` requires a
 * rendered check the product may not have (open question on topic 67).
 */
export function presenceAfterServedHtml(hasSignal: boolean): ContentPresenceState {
  return hasSignal ? 'present' : 'client_only'
}

/**
 * After a rendered-DOM fetch: missing in both served HTML and rendered DOM
 * is `absent`; missing only in served HTML was already `client_only`.
 */
export function presenceAfterRenderedDom(opts: {
  inServedHtml: boolean
  inRenderedDom: boolean
}): ContentPresenceState {
  if (opts.inServedHtml || opts.inRenderedDom) return 'present'
  return 'absent'
}

/** User-facing copy — must not call client_only "missing". */
export function presenceLabel(presence: ContentPresenceState): string {
  switch (presence) {
    case 'present':
      return 'present in served HTML'
    case 'client_only':
      return 'absent from served HTML; may be present after rendering'
    case 'absent':
      return 'absent from served HTML and rendered DOM'
  }
}
