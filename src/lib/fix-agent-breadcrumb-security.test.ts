import { describe, expect, it } from 'vitest'
import {
  buildBreadcrumbSchema,
  isRootPageUrl,
} from './fix-agent-html-mutations'
import { classifyAuditIssue, classifyAuditIssues } from './fix-agent-classification'
import type { PageAuditIssue } from './page-audit-engine'

function issue(partial: Partial<PageAuditIssue> & Pick<PageAuditIssue, 'id' | 'title'>): PageAuditIssue {
  return {
    severity: 'warning',
    category: 'schema',
    description: partial.title,
    ...partial,
  }
}

describe('breadcrumb root exemption', () => {
  it('treats / and /index.html as root', () => {
    expect(isRootPageUrl('https://example.com/')).toBe(true)
    expect(isRootPageUrl('https://example.com/index.html')).toBe(true)
    expect(isRootPageUrl('https://example.com/blog/')).toBe(false)
  })

  it('buildBreadcrumbSchema returns null on homepage', () => {
    expect(buildBreadcrumbSchema('https://example.com/')).toBeNull()
    expect(buildBreadcrumbSchema('https://example.com/blog/post/')?.['@type']).toBe('BreadcrumbList')
  })

  it('skips homepage breadcrumb issues in classification', () => {
    const c = classifyAuditIssue(
      issue({
        id: 'bc1',
        title: 'No BreadcrumbList schema — missing breadcrumb in SERPs',
        category: 'schema',
      }),
      { connectionType: 'github', pageUrl: 'https://example.com/' },
    )
    expect(c.fixability).toBe('skip')
  })

  it('dedupes schema + AI breadcrumb into one auto attempt', () => {
    const list = classifyAuditIssues(
      [
        issue({
          id: 'bc-schema',
          title: 'No BreadcrumbList schema — missing breadcrumb in SERPs',
          category: 'schema',
        }),
        issue({
          id: 'bc-ai',
          title: 'Missing breadcrumb schema — reduces site structure clarity for AI crawlers',
          category: 'ai',
        }),
      ],
      { connectionType: 'github', pageUrl: 'https://example.com/blog/post/' },
    )
    const breadcrumb = list.filter((c) => c.autoKind === 'schema-breadcrumb')
    expect(breadcrumb).toHaveLength(1)
  })

  it('dedupes three security header issues into one auto attempt', () => {
    const list = classifyAuditIssues(
      [
        issue({
          id: 's1',
          title: 'No X-Frame-Options header — clickjacking protection missing',
          category: 'security',
        }),
        issue({
          id: 's2',
          title: 'Missing X-Content-Type-Options header — browsers may sniff MIME types',
          category: 'security',
        }),
        issue({
          id: 's3',
          title: 'No Content-Security-Policy header — adds XSS protection layer',
          category: 'security',
        }),
      ],
      { connectionType: 'github', pageUrl: 'https://example.com/' },
    )
    expect(list.filter((c) => c.autoKind === 'security-headers')).toHaveLength(1)
  })
})
