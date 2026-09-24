/**
 * Which HTML representation each findings detector judges.
 * Content / link / meta → prefer rendered when available.
 * HTTP/status / robots / redirect → raw (transport layer).
 */

import type { DetectorRepresentation } from './types'

/**
 * Topic id → representation. Unknown topics default to `rendered` (content-like).
 */
export const DETECTOR_REPRESENTATION_BY_TOPIC: Record<string, DetectorRepresentation> = {
  // Transport / status — raw HTTP response
  '1': 'raw',
  '2b': 'raw',
  '3': 'raw',
  '4': 'raw',
  '5': 'raw',
  '6': 'raw',
  '7': 'raw',

  // URL / canonical / sitemap — both (headers + markup)
  '8': 'both',
  '9': 'both',
  '10': 'both',
  '11': 'both',
  '12': 'both',
  '13': 'both',
  '14': 'both',
  '15': 'both',
  '16': 'both',
  '17': 'both',

  // robots / crawl directives — raw
  '19': 'raw',
  '20': 'raw',
  '21': 'raw',
  '22': 'raw',

  // sitemap / indexability — both
  '24': 'both',
  '25': 'both',
  '26': 'both',
  '27': 'both',
  '28': 'both',

  // head / meta / titles — rendered when available
  '29': 'rendered',
  '30': 'rendered',
  '31': 'rendered',
  '33': 'rendered',
  '34': 'rendered',

  // structured data — rendered when available
  '35': 'rendered',
  '36': 'rendered',
  '37': 'rendered',
  '38': 'rendered',
  '39': 'rendered',

  // links / content — rendered when available
  '42': 'rendered',
  '43': 'rendered',
  '45': 'rendered',
  '46': 'both',
  '47': 'both',
  '48': 'both',
  '49': 'rendered',
}

export function representationForTopic(topicId: string): DetectorRepresentation {
  return DETECTOR_REPRESENTATION_BY_TOPIC[topicId] ?? 'rendered'
}

/**
 * Pick HTML for a detector given raw + optional rendered.
 */
export function htmlForTopic(
  topicId: string,
  rawHtml: string,
  renderedHtml: string | null,
): string {
  const rep = representationForTopic(topicId)
  if (rep === 'raw') return rawHtml
  if (rep === 'rendered' || rep === 'both') {
    return renderedHtml || rawHtml
  }
  return rawHtml
}
