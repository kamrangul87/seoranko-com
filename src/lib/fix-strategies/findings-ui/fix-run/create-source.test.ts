import { describe, expect, it } from 'vitest'
import {
  CREATE_SOURCE_BLOB_SHA,
  buildSelfCanonicalStaticHtml,
  isCreateSourceBlobSha,
  proposedStaticCreatePath,
} from './create-source'
import { resolveSourceFile } from './resolve-source-file'

describe('create-source helpers', () => {
  it('proposedStaticCreatePath maps /privacy → public/privacy/index.html', () => {
    expect(
      proposedStaticCreatePath('https://autodun.com/privacy', ['public']),
    ).toBe('public/privacy/index.html')
  })

  it('buildSelfCanonicalStaticHtml includes self canonical only', () => {
    const html = buildSelfCanonicalStaticHtml({
      selfCanonicalUrl: 'https://autodun.com/privacy',
      title: 'Privacy Policy',
    })
    expect(html).toContain(
      '<link rel="canonical" href="https://autodun.com/privacy">',
    )
    expect(html).not.toContain('href="https://autodun.com/"')
  })

  it('isCreateSourceBlobSha recognizes sentinel', () => {
    expect(isCreateSourceBlobSha(CREATE_SOURCE_BLOB_SHA)).toBe(true)
    expect(isCreateSourceBlobSha('abc123')).toBe(false)
  })
})

describe('resolveSourceFile SPA create path', () => {
  it('creates public/privacy/index.html when shell has broken canonical', async () => {
    const result = await resolveSourceFile({
      url: 'https://autodun.com/privacy',
      evidence: { needle: 'https://autodun.com/', expectedCount: 1 },
      treePaths: ['index.html', 'public/contact/index.html', 'src/pages/Privacy.tsx'],
      treeShas: { 'index.html': 'sha-shell' },
      readFile: async (path) => {
        if (path === 'index.html') {
          return '<html><head><link rel="canonical" href="https://autodun.com" /></head></html>'
        }
        return null
      },
    })
    expect(result).toMatchObject({
      status: 'resolved',
      path: 'public/privacy/index.html',
      blobSha: CREATE_SOURCE_BLOB_SHA,
    })
  })
})
