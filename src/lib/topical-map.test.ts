import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractJsonObject, groupArticlesByKeywordFallback } from './topical-map'

describe('extractJsonObject', () => {
  it('parses a bare JSON object as-is', () => {
    const text = '{"clusters":[{"pillarTopic":"x"}]}'
    expect(extractJsonObject(text)).toBe(text)
  })

  it('extracts JSON wrapped in explanatory prose', () => {
    const text = 'Here is the topical map:\n\n{"clusters":[{"pillarTopic":"x"}]}\n\nLet me know if you need changes.'
    const extracted = extractJsonObject(text)
    expect(extracted).toBe('{"clusters":[{"pillarTopic":"x"}]}')
    expect(() => JSON.parse(extracted!)).not.toThrow()
  })

  it('is not fooled by braces inside string values', () => {
    const text = '{"clusters":[{"pillarTopic":"Guide to {curly braces} in CSS"}]}'
    const extracted = extractJsonObject(text)
    expect(extracted).toBe(text)
    expect(() => JSON.parse(extracted!)).not.toThrow()
  })

  it('returns null for truncated/unterminated JSON (no balanced object)', () => {
    const text = '{"clusters":[{"pillarTopic":"x","missingSubtopics":["a","b"'
    expect(extractJsonObject(text)).toBeNull()
  })

  it('returns null when there is no JSON at all', () => {
    expect(extractJsonObject('I could not complete this request.')).toBeNull()
  })
})

describe('groupArticlesByKeywordFallback', () => {
  it('never fabricates placeholder subtopic text', () => {
    const articles = [
      { id: '1', title: 'A', keyword: 'ev charger' },
      { id: '2', title: 'B', keyword: 'ev charger' },
      { id: '3', title: 'C', keyword: 'mot check' },
    ]
    const { clusters } = groupArticlesByKeywordFallback(articles)
    for (const cluster of clusters) {
      expect(cluster.missingSubtopics).toEqual([])
      for (const subtopic of cluster.missingSubtopics) {
        expect(subtopic).not.toMatch(/related subtopic/i)
      }
    }
  })

  it('groups articles by exact keyword', () => {
    const articles = [
      { id: '1', title: 'A', keyword: 'ev charger' },
      { id: '2', title: 'B', keyword: 'ev charger' },
      { id: '3', title: 'C', keyword: 'mot check' },
    ]
    const { clusters } = groupArticlesByKeywordFallback(articles)
    expect(clusters).toHaveLength(2)
    const evCluster = clusters.find(c => c.pillarKeyword === 'ev charger')
    expect(evCluster.clusterArticleIds).toEqual(['2'])
    expect(evCluster.pillarArticleId).toBe('1')
  })
})

// Mock the Anthropic SDK so buildTopicalMap's actual end-to-end fallback
// behavior can be tested without a real API call. vi.mock is hoisted above
// imports/module init, so createMock must be created via vi.hoisted — a
// plain `const createMock = vi.fn()` here would be accessed before
// initialization once topical-map.ts's module-level `new Anthropic()` runs.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))
vi.mock('@/lib/model-router', () => ({
  MODEL_FOR: { topicalMapCluster: 'mock-model' },
}))

describe('buildTopicalMap — never surfaces a fabricated placeholder subtopic', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('falls back to deterministic keyword grouping (empty missingSubtopics) when the model output never parses as JSON', async () => {
    // Both the initial attempt and the one retry return unparseable text —
    // this is the exact bug reproduction: a truncated/non-JSON response.
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'Sorry, I could not complete this analysis.' }],
    })

    const { buildTopicalMap } = await import('./topical-map')
    const result = await buildTopicalMap([
      { id: '1', title: 'EV Charger Guide', keyword: 'ev charger' },
      { id: '2', title: 'EV Charger Costs', keyword: 'ev charger' },
    ])

    expect(createMock).toHaveBeenCalledTimes(2) // one attempt + one retry
    const allSubtopics = result.clusters.flatMap(c => c.missingSubtopics)
    expect(allSubtopics).toEqual([])
    expect(result.topRecommendation).not.toMatch(/related subtopic/i)
  })

  it('recovers via the retry when the first attempt is truncated but the second succeeds', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"clusters":[{"pillarTopic":"EV Chargers"' }] })
      .mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            clusters: [{
              pillarTopic: 'EV Chargers',
              pillarKeyword: 'ev charger',
              pillarArticleId: '1',
              clusterArticleIds: ['2'],
              missingSubtopics: ['EV charger installation permits by UK region', 'Home charger insurance requirements'],
              subtopicMap: {},
            }],
          }),
        }],
      })

    const { buildTopicalMap } = await import('./topical-map')
    const result = await buildTopicalMap([
      { id: '1', title: 'EV Charger Guide', keyword: 'ev charger' },
      { id: '2', title: 'EV Charger Costs', keyword: 'ev charger' },
    ])

    expect(createMock).toHaveBeenCalledTimes(2)
    expect(result.clusters[0].missingSubtopics).toEqual([
      'EV charger installation permits by UK region',
      'Home charger insurance requirements',
    ])
  })
})
