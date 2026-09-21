import { describe, expect, it } from 'vitest'
import {
  DETECTOR_SCOPE_BY_TOPIC,
  UNSHIPPED_DETECTOR_SCOPE,
  CHUNK_LOOP_TOPIC_IDS,
  POST_CRAWL_TOPIC_IDS,
  assertChunkLoopTopics,
  assertPostCrawlTopics,
  scopeForTopic,
} from '@/lib/fix-strategies/detector-scope'

describe('detector-scope', () => {
  it('classifies audited whole-site topics correctly', () => {
    // Audit targets from the chunk-orphan bug class
    expect(scopeForTopic('27')).toBe('whole-site')
    expect(scopeForTopic('33')).toBe('whole-site')
    expect(scopeForTopic('45')).toBe('whole-site')
    expect(scopeForTopic('46')).toBe('whole-site')
    expect(scopeForTopic('43')).toBe('whole-site')
    // 8–12 probe the peer via live fetch — per-page safe when wired
    for (const id of ['8', '9', '10', '11', '12']) {
      expect(scopeForTopic(id)).toBe('per-page')
    }
    // Unshipped: index vs crawl set divergence
    expect(UNSHIPPED_DETECTOR_SCOPE['58']).toBe('whole-site')
  })

  it('chunk-loop wiring is exclusively per-page', () => {
    expect(() => assertChunkLoopTopics(CHUNK_LOOP_TOPIC_IDS)).not.toThrow()
    for (const id of CHUNK_LOOP_TOPIC_IDS) {
      expect(DETECTOR_SCOPE_BY_TOPIC[id]).toBe('per-page')
    }
  })

  it('post-crawl wiring is exclusively whole-site', () => {
    expect(() => assertPostCrawlTopics(POST_CRAWL_TOPIC_IDS)).not.toThrow()
    for (const id of POST_CRAWL_TOPIC_IDS) {
      expect(DETECTOR_SCOPE_BY_TOPIC[id]).toBe('whole-site')
    }
  })

  it('rejects wiring a whole-site topic into the chunk loop', () => {
    expect(() => assertChunkLoopTopics(['27'])).toThrow(/WHOLE-SITE topic 27/)
    expect(() => assertChunkLoopTopics(['43'])).toThrow(/WHOLE-SITE topic 43/)
  })
})
