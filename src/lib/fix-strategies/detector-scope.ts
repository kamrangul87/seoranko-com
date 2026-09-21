/**
 * Detector crawl scope — every shipped topic declares DETECTOR_SCOPE on its
 * package index. WHOLE-SITE detectors must run once when the frontier is
 * exhausted (same fix class as topic 43); PER-PAGE may run per chunk.
 *
 * Topic 58 (index vs crawl set divergence) is unshipped but reserved as
 * whole-site so it cannot be wired into the chunk loop when added.
 */

import { DETECTOR_SCOPE as t1 } from './topic-1'
import { DETECTOR_SCOPE as t2b } from './topic-2b'
import { DETECTOR_SCOPE as t3 } from './topic-3'
import { DETECTOR_SCOPE as t4 } from './topic-4'
import { DETECTOR_SCOPE as t5 } from './topic-5'
import { DETECTOR_SCOPE as t6 } from './topic-6'
import { DETECTOR_SCOPE as t7 } from './topic-7'
import { DETECTOR_SCOPE as t8 } from './topic-8'
import { DETECTOR_SCOPE as t9 } from './topic-9'
import { DETECTOR_SCOPE as t10 } from './topic-10'
import { DETECTOR_SCOPE as t11 } from './topic-11'
import { DETECTOR_SCOPE as t12 } from './topic-12'
import { DETECTOR_SCOPE as t13 } from './topic-13'
import { DETECTOR_SCOPE as t14 } from './topic-14'
import { DETECTOR_SCOPE as t15 } from './topic-15'
import { DETECTOR_SCOPE as t16 } from './topic-16'
import { DETECTOR_SCOPE as t17 } from './topic-17'
import { DETECTOR_SCOPE as t19 } from './topic-19'
import { DETECTOR_SCOPE as t20 } from './topic-20'
import { DETECTOR_SCOPE as t21 } from './topic-21'
import { DETECTOR_SCOPE as t22 } from './topic-22'
import { DETECTOR_SCOPE as t24 } from './topic-24'
import { DETECTOR_SCOPE as t25 } from './topic-25'
import { DETECTOR_SCOPE as t26 } from './topic-26'
import { DETECTOR_SCOPE as t27 } from './topic-27'
import { DETECTOR_SCOPE as t28 } from './topic-28'
import { DETECTOR_SCOPE as t29 } from './topic-29'
import { DETECTOR_SCOPE as t30 } from './topic-30'
import { DETECTOR_SCOPE as t31 } from './topic-31'
import { DETECTOR_SCOPE as t33 } from './topic-33'
import { DETECTOR_SCOPE as t34 } from './topic-34'
import { DETECTOR_SCOPE as t35 } from './topic-35'
import { DETECTOR_SCOPE as t36 } from './topic-36'
import { DETECTOR_SCOPE as t37 } from './topic-37'
import { DETECTOR_SCOPE as t38 } from './topic-38'
import { DETECTOR_SCOPE as t39 } from './topic-39'
import { DETECTOR_SCOPE as t42 } from './topic-42'
import { DETECTOR_SCOPE as t43 } from './topic-43'
import { DETECTOR_SCOPE as t45 } from './topic-45'
import { DETECTOR_SCOPE as t46 } from './topic-46'
import { DETECTOR_SCOPE as t47 } from './topic-47'
import { DETECTOR_SCOPE as t48 } from './topic-48'
import { DETECTOR_SCOPE as t49 } from './topic-49'

export type DetectorScope = 'per-page' | 'whole-site'

/** Shipped topic id → scope (sourced from each topic's DETECTOR_SCOPE export). */
export const DETECTOR_SCOPE_BY_TOPIC: Readonly<Record<string, DetectorScope>> = {
  '1': t1,
  '2b': t2b,
  '3': t3,
  '4': t4,
  '5': t5,
  '6': t6,
  '7': t7,
  '8': t8,
  '9': t9,
  '10': t10,
  '11': t11,
  '12': t12,
  '13': t13,
  '14': t14,
  '15': t15,
  '16': t16,
  '17': t17,
  '19': t19,
  '20': t20,
  '21': t21,
  '22': t22,
  '24': t24,
  '25': t25,
  '26': t26,
  '27': t27,
  '28': t28,
  '29': t29,
  '30': t30,
  '31': t31,
  '33': t33,
  '34': t34,
  '35': t35,
  '36': t36,
  '37': t37,
  '38': t38,
  '39': t39,
  '42': t42,
  '43': t43,
  '45': t45,
  '46': t46,
  '47': t47,
  '48': t48,
  '49': t49,
}

/**
 * Reserved for unshipped detectors. Topic 58 = index vs crawl set divergence;
 * must be whole-site when wired.
 */
export const UNSHIPPED_DETECTOR_SCOPE: Readonly<Record<string, DetectorScope>> =
  {
    '58': 'whole-site',
  }

/** Topic ids that may run inside the per-chunk detector loop. */
export const CHUNK_LOOP_TOPIC_IDS = [
  '1',
  '2b',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '16',
  '17',
  '20',
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

/** Topic ids run once when the crawl frontier is exhausted. */
export const POST_CRAWL_TOPIC_IDS = [
  '15',
  '19',
  '21',
  '22',
  '24',
  '25',
  '26',
  '27',
  '28',
  '33',
  '43',
  '45',
  '46',
  '47',
  '48',
] as const

/** Every shipped detector that must be called from the crawl runners. */
export const WIRED_TOPIC_IDS: readonly string[] = Array.from(
  new Set<string>([...CHUNK_LOOP_TOPIC_IDS, ...POST_CRAWL_TOPIC_IDS]),
).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

export function scopeForTopic(topicId: string): DetectorScope | null {
  return (
    DETECTOR_SCOPE_BY_TOPIC[topicId] ??
    UNSHIPPED_DETECTOR_SCOPE[topicId] ??
    null
  )
}

/**
 * Throws if any topic id is whole-site — call before wiring into the chunk loop.
 */
export function assertChunkLoopTopics(topicIds: readonly string[]): void {
  for (const id of topicIds) {
    const scope = scopeForTopic(id)
    if (scope === 'whole-site') {
      throw new Error(
        `WHOLE-SITE topic ${id} must not run in the per-chunk detector loop — use the post-crawl pass`,
      )
    }
    if (scope == null) {
      throw new Error(
        `Topic ${id} has no DETECTOR_SCOPE — declare per-page or whole-site before wiring`,
      )
    }
  }
}

export function assertPostCrawlTopics(topicIds: readonly string[]): void {
  for (const id of topicIds) {
    const scope = scopeForTopic(id)
    if (scope !== 'whole-site') {
      throw new Error(
        `Post-crawl topic ${id} must be DETECTOR_SCOPE=whole-site (got ${scope})`,
      )
    }
  }
}

/**
 * Throws if any shipped DETECTOR_SCOPE_BY_TOPIC key is missing from WIRED_TOPIC_IDS.
 */
export function assertAllShippedTopicsWired(): void {
  const wired = new Set(WIRED_TOPIC_IDS)
  const missing = Object.keys(DETECTOR_SCOPE_BY_TOPIC).filter((id) => !wired.has(id))
  if (missing.length > 0) {
    throw new Error(
      `Shipped-but-unwired detector topics: ${missing.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')}`,
    )
  }
}
