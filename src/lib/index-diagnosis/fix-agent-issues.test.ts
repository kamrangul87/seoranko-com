import { describe, expect, it } from 'vitest'
import { classifyAuditIssue } from '@/lib/fix-agent-classification'
import { buildIndexDiagnosisFixAgentIssues } from '@/lib/index-diagnosis/fix-agent-issues'
import { mergeNextConfigRedirect } from '@/lib/fix-agent-redirect'
import { removeDeadLinkFromHtml } from '@/lib/fix-agent-dead-links'
import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'
import type { PageAuditIssue } from '@/lib/page-audit-engine'

function issue(partial: Partial<PageAuditIssue> & Pick<PageAuditIssue, 'id' | 'title'>): PageAuditIssue {
  return {
    severity: 'warning',
    category: 'index-diagnosis',
    description: partial.title,
    ...partial,
  }
}

describe('index-diagnosis fix-agent bridge', () => {
  it('classifies canonical redirect as auto on GitHub', () => {
    const c = classifyAuditIssue(
      issue({
        id: 'idx-canonical-test',
        title: 'index.html canonical points elsewhere — redirect needed',
        fixMetadata: {
          kind: 'redirect-canonical',
          fromUrl: 'https://autodun.com/blog/index.html',
          toUrl: 'https://autodun.com/blog/',
        },
      }),
      { connectionType: 'github' },
    )
    expect(c.fixability).toBe('auto')
    expect(c.autoKind).toBe('redirect-canonical')
  })

  it('classifies dead link removal as auto and missing page as human', () => {
    const remove = classifyAuditIssue(
      issue({
        id: 'idx-dead-link-remove-x',
        title: 'Remove dead internal link to /privacy',
        fixMetadata: { kind: 'remove-dead-link', deadUrl: 'https://autodun.com/privacy', sourceUrls: ['https://autodun.com/'] },
      }),
      { connectionType: 'github' },
    )
    expect(remove.autoKind).toBe('remove-dead-link')

    const human = classifyAuditIssue(
      issue({
        id: 'idx-dead-page-x',
        title: 'Destination page missing: /privacy',
        fixMetadata: { kind: 'missing-page-content', deadUrl: 'https://autodun.com/privacy' },
      }),
      { connectionType: 'github' },
    )
    expect(human.fixability).toBe('human')
    expect(human.humanKind).toBe('missing-page-content')
  })

  it('builds fix-agent issues from crawl including sitemap drift', () => {
    const result = {
      pages: [
        {
          url: 'https://autodun.com/blog/index.html',
          verdict: 'AT_RISK',
          steps: [
            {
              step: 'canonical',
              passed: false,
              evidence: 'Canonical points to different same-host URL: https://autodun.com/blog/ (page https://autodun.com/blog/index.html)',
            },
          ],
        },
      ],
      coverage: {
        excluded: [{ url: 'https://autodun.com/privacy', reason: 'NON_200', evidence: 'HTTP 404', httpStatus: 404 }],
        linkedOnlyUrls: [],
      },
      inboundLinksByUrl: {
        'https://autodun.com/privacy': [{ fromUrl: 'https://autodun.com/', fromDepth: 0 }],
      },
    } as IndexDiagnosisResult

    const drift = {
      hasDrift: true,
      missingFromLive: ['https://autodun.com/mot-predictor'],
      deadInLive: [],
      liveSitemapEvidence: 'sitemap.xml',
      expectedIndexableCount: 10,
      liveUrlCount: 8,
      liveSitemapFetched: true,
      generatedSitemapXml: '<?xml version="1.0"?><urlset></urlset>',
      generatedSitemapPath: 'public/sitemap.xml',
    }

    const issues = buildIndexDiagnosisFixAgentIssues(result, drift)
    expect(issues.some((i) => i.fixMetadata?.kind === 'redirect-canonical')).toBe(true)
    expect(issues.some((i) => i.fixMetadata?.kind === 'remove-dead-link')).toBe(true)
    expect(issues.some((i) => i.fixMetadata?.kind === 'missing-page-content')).toBe(true)
    expect(issues.some((i) => i.id === 'idx-sitemap-drift')).toBe(true)
  })
})

describe('fix-agent mechanical mutations', () => {
  it('merges redirect into existing next.config.js', () => {
    const existing = `module.exports = { async redirects() { return [{ source: '/old', destination: '/new', permanent: true }] } }`
    const merged = mergeNextConfigRedirect(existing, 'https://x.com/blog/index.html', 'https://x.com/blog/')
    expect(merged.changed).toBe(true)
    expect(merged.content).toContain("source: '/blog/index.html'")
    expect(merged.content).toContain("destination: '/blog/'")
  })

  it('removes dead anchor from HTML', () => {
    const html = '<footer><a href="/privacy">Privacy</a></footer>'
    const out = removeDeadLinkFromHtml(html, 'https://autodun.com/privacy')
    expect(out.changed).toBe(true)
    expect(out.html).not.toContain('href="/privacy"')
  })
})
