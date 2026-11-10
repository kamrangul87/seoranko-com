import { describe, expect, it } from 'vitest'
import { evaluateAutoMergeVerdictGate } from '@/lib/fix-strategies/findings-ui/fix-flow/auto-merge'
import {
  groupRelatedLinkItems,
  MAX_QUEUED_SOURCES,
  RELATED_LINK_VERDICT,
  relatedFindingCandidate,
} from './queue-related-findings'

describe('groupRelatedLinkItems', () => {
  it('groups by source, caps targets at 5, and skips duplicates', () => {
    const grouped = groupRelatedLinkItems([
      { sourceUrl: 'https://example.com/a', href: '/b', anchorText: 'B' },
      { sourceUrl: 'https://example.com/a', href: '/c', anchorText: 'C' },
      { sourceUrl: 'https://example.com/a', href: '/b', anchorText: 'B again' },
      { sourceUrl: 'https://example.com/z', href: '/a', anchorText: 'A' },
      ...Array.from({ length: 8 }, (_, i) => ({
        sourceUrl: 'https://example.com/a',
        href: `/n${i}`,
        anchorText: `N${i}`,
      })),
    ])
    const a = grouped.find((g) => g.sourceUrl === 'https://example.com/a')
    expect(a?.targets).toHaveLength(5)
    expect(a?.targets.filter((t) => t.href === '/b')).toHaveLength(1)
    expect(grouped.map((g) => g.sourceUrl)).toEqual([
      'https://example.com/a',
      'https://example.com/z',
    ])
  })

  it(`caps queued sources at ${MAX_QUEUED_SOURCES}`, () => {
    const items = Array.from({ length: 250 }, (_, i) => ({
      sourceUrl: `https://example.com/p/${i}`,
      href: '/x',
      anchorText: 'X',
    }))
    expect(groupRelatedLinkItems(items)).toHaveLength(MAX_QUEUED_SOURCES)
  })

  it('keeps score, reason, and weakMatch on each target and sorts strongest first', () => {
    const grouped = groupRelatedLinkItems([
      {
        sourceUrl: 'https://example.com/a',
        href: '/weak',
        anchorText: 'Weak page',
        score: 0.32,
        reason: 'Loose overlap on driving — weak match',
        weakMatch: true,
      },
      {
        sourceUrl: 'https://example.com/a',
        href: '/strong',
        anchorText: 'Strong page',
        score: 0.81,
        reason: 'Both pages cover MOT tests',
        weakMatch: false,
      },
    ])
    expect(grouped[0]?.targets.map((t) => t.href)).toEqual(['/strong', '/weak'])
    expect(grouped[0]?.targets[0]).toMatchObject({
      href: '/strong',
      score: 0.81,
      reason: 'Both pages cover MOT tests',
      weakMatch: false,
    })
    expect(grouped[0]?.targets[1]?.weakMatch).toBe(true)
  })
})

describe('relatedFindingCandidate', () => {
  it('queues an approval-required related verdict that auto-merge must refuse', () => {
    const c = relatedFindingCandidate('https://example.com/blog', [
      { href: '/blog/mot-cost-uk-2026.html', anchorText: 'MOT Cost in the UK 2026' },
    ])
    expect(c.verdict).toBe(RELATED_LINK_VERDICT)
    expect(c.evidenceValues).toMatchObject({ requiresApproval: true, neverAutoMerge: true })
    const gate = evaluateAutoMergeVerdictGate({
      ...c,
      surfaceClass: 'auto-fixable',
    })
    expect(gate.allowed).toBe(false)
    expect(gate.allowed === false && gate.reason).toMatch(/approval|never auto-merge/i)
  })
})
