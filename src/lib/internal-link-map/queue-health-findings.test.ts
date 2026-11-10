import { describe, expect, it } from 'vitest'
import { evaluateAutoMergeVerdictGate } from '@/lib/fix-strategies/findings-ui/fix-flow/auto-merge'
import { isTransformRegistered } from '@/lib/fix-strategies/findings-ui/fix-run/apply-registry'
import type { LinkHealthIssue } from './link-health'
import { healthFindingCandidate } from './queue-health-findings'

function issue(partial: Partial<LinkHealthIssue> & Pick<LinkHealthIssue, 'kind'>): LinkHealthIssue {
  return {
    id: `${partial.kind}|x`,
    sourceUrl: 'https://example.com/blog/a.html',
    targetUrl: 'https://example.com/gone',
    href: '/gone',
    anchorText: 'Gone',
    hint: 'Remove the broken link.',
    mechanical: true,
    neverAutoMerge: true,
    ...partial,
  }
}

describe('healthFindingCandidate', () => {
  it('queues broken and redirect items as registered mechanical findings that never auto-merge', () => {
    const broken = healthFindingCandidate(issue({ kind: 'broken' }))
    expect(broken?.topicId).toBe('1')
    expect(broken?.verdict).toBe('auto-fixable')
    expect(broken?.evidenceValues).toMatchObject({
      href: '/gone',
      neverAutoMerge: true,
      requiresApproval: true,
    })
    expect(isTransformRegistered(broken!.topicId, broken!.verdict)).toBe(true)
    expect(
      evaluateAutoMergeVerdictGate({
        ...broken!,
        surfaceClass: 'auto-fixable',
      }).allowed,
    ).toBe(false)

    const rewrite = healthFindingCandidate(
      issue({
        kind: 'redirect',
        href: '/old',
        rewriteHref: '/blog/mot-history-check-uk.html',
        hint: 'Rewrite to the final URL.',
      }),
    )
    expect(rewrite?.topicId).toBe('42')
    expect(rewrite?.verdict).toBe('auto-rewrite')
    expect(rewrite?.evidenceValues).toMatchObject({
      href: '/old',
      rewriteHref: '/blog/mot-history-check-uk.html',
      neverAutoMerge: true,
    })
    expect(isTransformRegistered(rewrite!.topicId, rewrite!.verdict)).toBe(true)
    expect(
      evaluateAutoMergeVerdictGate({
        ...rewrite!,
        surfaceClass: 'auto-fixable',
      }).allowed,
    ).toBe(false)
  })

  it('does not queue report-only health kinds', () => {
    expect(
      healthFindingCandidate(
        issue({ kind: 'generic-anchor', mechanical: false, hint: 'Write a descriptive anchor.' }),
      ),
    ).toBeNull()
  })
})
