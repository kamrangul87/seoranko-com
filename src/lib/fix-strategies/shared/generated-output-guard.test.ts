import { describe, expect, it } from 'vitest'
import { resolveFixTarget } from './generated-output-guard'

describe('resolveFixTarget', () => {
  it('generated + known generator → fix-generator (never the output)', () => {
    const result = resolveFixTarget({
      artefactPath: 'public/sitemap.xml',
      generatorPath: 'src/app/sitemap.ts',
      isGenerated: true,
    })
    expect(result.action).toBe('fix-generator')
    expect(result.targetPath).toBe('src/app/sitemap.ts')
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('generated + unknown generator → human-review', () => {
    const result = resolveFixTarget({
      artefactPath: 'public/sitemap.xml',
      generatorPath: null,
      isGenerated: true,
    })
    expect(result.action).toBe('human-review')
    expect(result.targetPath).toBeNull()
  })

  it('not generated → fix-artefact', () => {
    const result = resolveFixTarget({
      artefactPath: 'public/robots.txt',
      generatorPath: null,
      isGenerated: false,
    })
    expect(result.action).toBe('fix-artefact')
    expect(result.targetPath).toBe('public/robots.txt')
  })
})
