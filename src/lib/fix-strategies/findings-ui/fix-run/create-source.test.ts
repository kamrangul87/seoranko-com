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

describe('resolveSourceFile SPA shell strip (never create over live route)', () => {
  it('resolves to index.html shell strip — never public/privacy stub', async () => {
    const files: Record<string, string> = {
      'index.html':
        '<html><head><link rel="canonical" href="https://autodun.com" /><meta property="og:url" content="https://autodun.com" /></head><body><div id="root"></div></body></html>',
      'vercel.json': JSON.stringify({
        rewrites: [{ source: '/privacy', destination: '/index.html' }],
      }),
      'src/App.tsx': `
        import Privacy from "./pages/Privacy";
        import Index from "./pages/Index";
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/privacy" element={<Privacy />} />
        </Routes>
      `,
      'src/pages/Privacy.tsx':
        'setSEO({ canonical: "https://autodun.com/privacy", title: "Privacy" })',
      'src/pages/Index.tsx':
        'setSEO({ canonical: "https://autodun.com", title: "Home" })',
      'public/contact/index.html': '<html></html>',
    }
    const treePaths = Object.keys(files)
    const result = await resolveSourceFile({
      url: 'https://autodun.com/privacy',
      evidence: { needle: 'https://autodun.com/', expectedCount: 1 },
      treePaths,
      treeShas: { 'index.html': 'sha-shell' },
      readFile: async (path) => files[path] ?? null,
    })
    expect(result).toMatchObject({
      status: 'resolved',
      path: 'index.html',
      blobSha: 'sha-shell',
      spaShellStrip: true,
    })
    expect(result.status === 'resolved' && result.path).not.toBe(
      'public/privacy/index.html',
    )
  })

  it('fail closed: does not create when live route exists (fixture)', async () => {
    const files: Record<string, string> = {
      'index.html':
        '<link rel="canonical" href="https://autodun.com" />',
      'vercel.json': JSON.stringify({
        rewrites: [{ source: '/privacy', destination: '/index.html' }],
      }),
      'src/pages/Privacy.tsx': 'export default function Privacy(){ return null }',
      'src/App.tsx': `
        import Privacy from "./pages/Privacy";
        <Route path="/privacy" element={<Privacy />} />
      `,
    }
    const result = await resolveSourceFile({
      url: 'https://autodun.com/privacy',
      evidence: { needle: 'https://autodun.com', expectedCount: 1 },
      treePaths: Object.keys(files),
      treeShas: { 'index.html': 'sha-shell' },
      readFile: async (path) => files[path] ?? null,
    })
    // Missing client canonical on Privacy → human-review / unresolved
    expect(result.status).toBe('unresolved')
  })
})
