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
