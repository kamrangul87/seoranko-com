import { describe, expect, it } from 'vitest'
import {
  classifyFinding,
  findingCodeForTopic,
  isSingleFileChange,
} from './classify-finding'
import type { ClassifiableFinding, ClassifySiteContext } from './types'

const githubConnected: ClassifySiteContext = {
  connector: 'github',
  connected: true,
}

const noConnector: ClassifySiteContext = {
  connector: null,
  connected: false,
}

const wordpressConnected: ClassifySiteContext = {
  connector: 'wordpress',
  connected: true,
}

function finding(
  overrides: Partial<ClassifiableFinding> &
    Pick<ClassifiableFinding, 'id' | 'topicId' | 'verdict'>,
): ClassifiableFinding {
  return {
    bucket: 'actionable',
    affectedUrlCount: 1,
    declarationSite: null,
    sourcePath: 'app/page.tsx',
    surfaceClass: 'auto-fixable',
    ...overrides,
  }
}

describe('classifyFinding', () => {
  it('SAFE: auto-fixable + registered transform + github + single-file', () => {
    const r = classifyFinding(
      finding({
        id: 'a',
        topicId: '49',
        verdict: 'auto-set-dimensions',
      }),
      githubConnected,
    )
    expect(r.eligibility).toBe('safe')
    expect(r.strategyId).toBe('49:auto-set-dimensions')
    expect(r.findingCode).toBe('performance__images_missing_width_height')
    expect(r.reason).not.toMatch(/\d+%|confidence/i)
  })

  it('REVIEW: human-review verdict', () => {
    const r = classifyFinding(
      finding({
        id: 'b',
        topicId: '42',
        verdict: 'human-review-temporary-redirect',
        surfaceClass: 'human-review',
      }),
      githubConnected,
    )
    expect(r.eligibility).toBe('review')
    expect(r.reason).toMatch(/human/i)
  })

  it('REVIEW: multi-file / rolled-up blast radius', () => {
    const r = classifyFinding(
      finding({
        id: 'c',
        topicId: '49',
        verdict: 'auto-set-dimensions',
        affectedUrlCount: 12,
        declarationSite: 'components/Hero.tsx',
      }),
      githubConnected,
    )
    expect(r.eligibility).toBe('review')
    expect(r.reason).toMatch(/more than one file|shared/i)
  })

  it('REVIEW: connector not connected (transform exists)', () => {
    const r = classifyFinding(
      finding({
        id: 'd',
        topicId: '26',
        verdict: 'auto-remove-injected-noindex',
      }),
      noConnector,
    )
    expect(r.eligibility).toBe('review')
    expect(r.reason).toMatch(/[Cc]onnect/)
  })

  it('BLOCKED: not_mechanically_fixable', () => {
    const r = classifyFinding(
      finding({
        id: 'e',
        topicId: '22',
        verdict: 'not_mechanically_fixable',
        surfaceClass: 'finding',
      }),
      githubConnected,
    )
    expect(r.eligibility).toBe('blocked')
    expect(r.reason).toMatch(/cannot be fixed mechanically/i)
  })

  it('BLOCKED: no transform registered', () => {
    const r = classifyFinding(
      finding({
        id: 'f',
        topicId: '15',
        verdict: 'finding-soft-404',
        surfaceClass: 'report-only',
      }),
      githubConnected,
    )
    expect(r.eligibility).toBe('blocked')
    expect(r.reason).toMatch(/No automatic fix/i)
  })

  it('BLOCKED: transform exists but connector cannot execute it', () => {
    const r = classifyFinding(
      finding({
        id: 'g',
        topicId: '1',
        verdict: 'auto-fixable',
      }),
      wordpressConnected,
    )
    expect(r.eligibility).toBe('blocked')
    expect(r.reason).toMatch(/platform/i)
  })

  it('REVIEW: site-wide source path is not single-file safe', () => {
    expect(
      isSingleFileChange(
        finding({
          id: 'h',
          topicId: '22',
          verdict: 'auto-remove-crawl-delay',
          sourcePath: 'public/robots.txt',
        }),
      ),
    ).toBe(false)
    const r = classifyFinding(
      finding({
        id: 'h',
        topicId: '22',
        verdict: 'auto-remove-crawl-delay',
        sourcePath: 'public/robots.txt',
      }),
      githubConnected,
    )
    expect(r.eligibility).toBe('review')
  })

  it('findingCode maps topic via dossier slug', () => {
    expect(findingCodeForTopic('42')).toBe(
      'internal-links__pointing_at_redirects',
    )
    expect(findingCodeForTopic('999')).toBe('topic-999')
  })
})
