import { describe, expect, it } from 'vitest'
import {
  DETECTOR_SCOPE_BY_TOPIC,
  UNSHIPPED_DETECTOR_SCOPE,
  CHUNK_LOOP_TOPIC_IDS,
  POST_CRAWL_TOPIC_IDS,
  WIRED_TOPIC_IDS,
  assertAllShippedTopicsWired,
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
    expect(scopeForTopic('15')).toBe('whole-site')
    expect(scopeForTopic('19')).toBe('whole-site')
    expect(scopeForTopic('21')).toBe('whole-site')
    expect(scopeForTopic('22')).toBe('whole-site')
    expect(scopeForTopic('26')).toBe('whole-site')
    expect(scopeForTopic('47')).toBe('whole-site')
    expect(scopeForTopic('48')).toBe('whole-site')
    // Topic 8 needs the full discovery set → whole-site post-crawl.
    // 9–12 probe peers via live fetch — still per-page.
    expect(scopeForTopic('8')).toBe('whole-site')
    for (const id of ['9', '10', '11', '12']) {
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

  it('WIRED_TOPIC_IDS covers every shipped DETECTOR_SCOPE topic', () => {
    expect(() => assertAllShippedTopicsWired()).not.toThrow()
    const shipped = Object.keys(DETECTOR_SCOPE_BY_TOPIC).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )
    expect([...WIRED_TOPIC_IDS]).toEqual(shipped)
    expect(CHUNK_LOOP_TOPIC_IDS).toContain('1')
    expect(CHUNK_LOOP_TOPIC_IDS).toContain('42')
    expect(CHUNK_LOOP_TOPIC_IDS).toContain('49')
    expect(POST_CRAWL_TOPIC_IDS).toContain('8')
    expect(POST_CRAWL_TOPIC_IDS).toContain('15')
    expect(POST_CRAWL_TOPIC_IDS).toContain('26')
    expect(POST_CRAWL_TOPIC_IDS).toContain('48')
    expect(CHUNK_LOOP_TOPIC_IDS).not.toContain('8')
  })
})
