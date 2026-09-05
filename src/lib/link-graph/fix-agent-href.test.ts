import { describe, expect, it } from 'vitest'
import {
  formatHrefForRewrite,
  rewriteHrefInHtml,
  rewriteHrefsInHtml,
  verifyHrefRewriteInHtml,
} from '@/lib/fix-agent-href-rewrite'
import {
  buildLinkGraphFixAgentIssues,
  buildRedirectHopBulkIssue,
  buildSingleHrefRewriteIssue,
} from '@/lib/link-graph/fix-agent-issues'
import { applyPasteAndFix } from '@/lib/manual-paste-fix'
import { classifyAuditIssue } from '@/lib/fix-agent-classification'
import type { LinkFinding, LinkGraphResult } from '@/lib/link-graph/types'

function finding(partial: Partial<LinkFinding> & Pick<LinkFinding, 'ruleId'>): LinkFinding {
  return {
    severity: 'FAIL',
    sourceUrl: 'https://fixture.test/',
    targetUrl: 'https://fixture.test/old',
    suggestedTarget: 'https://fixture.test/new',
    evidence: { hrefRaw: '/old' },
    ...partial,
  }
}

function emptyResult(findings: LinkFinding[]): LinkGraphResult {
  return {
    edges: [],
    targets: [],
    findings,
    rankedFindings: findings,
    trailingSlashConvention: false,
    jsSuspected: false,
    jsSuspectedUrls: [],
    verdictHeadline: 'test',
    topCauses: [],
    ranAt: new Date().toISOString(),
  }
}

describe('fix-agent-href-rewrite', () => {
  it('rewrites relative href to suggested path', () => {
    const html = '<p><a href="/old">Go</a></p>'
    const result = rewriteHrefInHtml(html, 'https://fixture.test/old', 'https://fixture.test/new')
    expect(result.changed).toBe(true)
    expect(result.html).toContain('href="/new"')
    expect(result.html).not.toContain('href="/old"')
    expect(result.html).toContain('>Go</a>')
  })

  it('rewrites absolute href and preserves other anchors', () => {
    const html =
      '<a href="https://fixture.test/old">A</a><a href="/keep">B</a>'
    const result = rewriteHrefInHtml(
      html,
      'https://fixture.test/old',
      'https://fixture.test/new',
    )
    expect(result.html).toContain('href="https://fixture.test/new"')
    expect(result.html).toContain('href="/keep"')
  })

  it('applies bulk rewrites on one page', () => {
    const html = '<a href="/a">A</a><a href="/b">B</a>'
    const result = rewriteHrefsInHtml(html, [
      { fromHref: 'https://fixture.test/a', toHref: 'https://fixture.test/a2' },
      { fromHref: 'https://fixture.test/b', toHref: 'https://fixture.test/b2' },
    ])
    expect(result.replaced).toBe(2)
    expect(result.html).toContain('href="/a2"')
    expect(result.html).toContain('href="/b2"')
  })

  it('formatHrefForRewrite keeps relative style', () => {
    expect(formatHrefForRewrite('/old', 'https://x.test/new')).toBe('/new')
    expect(formatHrefForRewrite('https://x.test/old', 'https://x.test/new')).toBe(
      'https://x.test/new',
    )
  })

  it('verifyHrefRewriteInHtml confirms destination and absence of old', () => {
    const html = '<a href="/new">x</a>'
    const ok = verifyHrefRewriteInHtml(
      html,
      'https://fixture.test/old',
      'https://fixture.test/new',
    )
    expect(ok.ok).toBe(true)
    const bad = verifyHrefRewriteInHtml(
      '<a href="/old">x</a>',
      'https://fixture.test/old',
      'https://fixture.test/new',
    )
    expect(bad.ok).toBe(false)
  })
})

describe('link-graph fix-agent issues', () => {
  it('builds bulk redirect-hop issue and per-finding rewrite issues', () => {
    const result = emptyResult([
      finding({
        ruleId: 'L05',
        targetUrl: 'https://fixture.test/single-old',
        suggestedTarget: 'https://fixture.test/single-new',
        evidence: { hrefRaw: '/single-old' },
      }),
      finding({
        ruleId: 'L04',
        targetUrl: 'https://fixture.test/hop-a',
        suggestedTarget: 'https://fixture.test/hop-c',
        evidence: { hrefRaw: '/hop-a' },
      }),
      finding({
        ruleId: 'L06',
        targetUrl: 'https://fixture.test/blog/index.html',
        suggestedTarget: 'https://fixture.test/blog',
        evidence: { hrefRaw: '/blog/index.html' },
      }),
      finding({
        ruleId: 'L01',
        targetUrl: 'https://fixture.test/missing',
        suggestedTarget: null,
        evidence: { hrefRaw: '/missing' },
      }),
    ])

    const issues = buildLinkGraphFixAgentIssues(result)
    expect(issues.some((i) => i.id === 'link-bulk-redirect-hops')).toBe(true)
    expect(issues.some((i) => i.id === 'link-bulk-non-canonical')).toBe(true)
    expect(issues.some((i) => i.fixMetadata?.kind === 'rewrite-link-href')).toBe(true)
    expect(issues.some((i) => i.fixMetadata?.kind === 'remove-dead-link')).toBe(true)

    const bulk = buildRedirectHopBulkIssue(result)
    expect(bulk).toBeTruthy()
    expect(bulk!.fixMetadata?.hrefFixes?.length).toBe(2)

    const classified = classifyAuditIssue(bulk!, { connectionType: 'github' })
    expect(classified.fixability).toBe('auto')
    expect(classified.autoKind).toBe('rewrite-link-href')

    const tag = classifyAuditIssue(bulk!, { connectionType: 'universal-tag' })
    expect(tag.fixability).not.toBe('auto')
  })

  it('buildSingleHrefRewriteIssue returns paste-ready metadata', () => {
    const issue = buildSingleHrefRewriteIssue(
      finding({
        ruleId: 'L05',
        sourceUrl: 'https://fixture.test/',
        targetUrl: 'https://fixture.test/single-old',
        suggestedTarget: 'https://fixture.test/single-new',
        evidence: { hrefRaw: '/single-old' },
      }),
    )
    expect(issue).toBeTruthy()
    expect(issue!.fixMetadata?.kind).toBe('rewrite-link-href')
    expect(issue!.fixMetadata?.hrefFixes?.[0]?.toHref).toContain('/single-new')
  })
})

describe('manual paste link_href', () => {
  it('rewrites only the flagged href in pasted HTML', () => {
    const html =
      '<html><body><a href="/single-old">Old</a><a href="/ok">OK</a></body></html>'
    const result = applyPasteAndFix({
      html,
      fixKind: 'link_href',
      hrefFixes: [
        {
          fromHref: 'https://fixture.test/single-old',
          toHref: 'https://fixture.test/single-new',
        },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.html).toContain('href="/single-new"')
    expect(result.html).toContain('href="/ok"')
    expect(result.html).not.toContain('href="/single-old"')
  })
})
