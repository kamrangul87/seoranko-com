import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  detectHtmlHeaderCanonicalDisagree,
  stripLinkCanonicalFromHeaderValue,
  verifyLiveSingleCanonicalDeclaration,
} from '@/lib/fix-strategies/topic-16'
import { resolveHeaderCanonicalScope } from '@/lib/fix-strategies/shared'

const ORIGIN = 'https://example.com'
const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function htmlCanonical(href: string): string {
  return `<!doctype html><html><head>
    <link rel="canonical" href="${href}">
  </head><body><p>hi</p></body></html>`
}

describe('topic 16 — HTML and HTTP Link disagree', () => {
  it('classifies the dossier fixture set', () => {
    const result = detectHtmlHeaderCanonicalDisagree(
      [
        // 1. different targets → conflict
        {
          url: `${ORIGIN}/conflict`,
          body: htmlCanonical(`${ORIGIN}/html-target`),
          headers: new Headers({
            link: `<${ORIGIN}/header-target>; rel="canonical"`,
            'content-type': 'text/html',
          }),
          preferredForm: `${ORIGIN}/html-target`,
        },
        // 2. identical → informational
        {
          url: `${ORIGIN}/same`,
          body: htmlCanonical(`${ORIGIN}/same`),
          headers: new Headers({
            link: `<${ORIGIN}/same>; rel="canonical"`,
            'content-type': 'text/html',
          }),
        },
        // 3. header-only PDF → suppressed
        {
          url: `${ORIGIN}/doc.pdf`,
          body: '%PDF-1.4',
          contentType: 'application/pdf',
          headers: new Headers({
            link: `<${ORIGIN}/doc.pdf>; rel="canonical"`,
            'content-type': 'application/pdf',
          }),
        },
        // 4. multi-route scope → indeterminate (override)
        {
          url: `${ORIGIN}/wide`,
          body: htmlCanonical(`${ORIGIN}/wide-html`),
          headers: new Headers({
            link: `<${ORIGIN}/wide-header>; rel="canonical"`,
            'content-type': 'text/html',
          }),
        },
        // 5. HTML target 404 → route topic 14
        {
          url: `${ORIGIN}/dead`,
          body: htmlCanonical(`${ORIGIN}/gone`),
          headers: new Headers({
            link: `<${ORIGIN}/other>; rel="canonical"`,
            'content-type': 'text/html',
          }),
          eitherTargetUnhealthy: true,
        },
      ],
      {
        headerScopeOverride: {
          kind: 'multi-route',
          file: 'next.config.js',
          detail: 'covers /:path*',
        },
      },
    )

    // First case uses multi-route override → indeterminate for all conflicts
    const conflict = result.findings.find(
      (f) => f.pageUrl === `${ORIGIN}/conflict`,
    )
    expect(conflict?.verdict).toBe('indeterminate-header-scope')
    expect(conflict?.scopedOutcomeNote).toMatch(/likely/i)
    expect(conflict?.scopedOutcomeNote).toMatch(/not ["']?always/i)
    expect(conflict?.scopedOutcomeNote).not.toMatch(/always ignores/i)

    expect(result.informational.map((i) => i.pageUrl)).toContain(
      `${ORIGIN}/same`,
    )

    expect(
      result.suppressed.some(
        (s) =>
          s.pageUrl === `${ORIGIN}/doc.pdf` &&
          s.verdict === 'suppress-non-html',
      ),
    ).toBe(true)

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/wide`)?.verdict,
    ).toBe('indeterminate-header-scope')

    expect(
      result.routed.find((r) => r.pageUrl === `${ORIGIN}/dead`)?.verdict,
    ).toBe('route-topic-14')
  })

  it('auto-fixable only when header scope is single-route', () => {
    const result = detectHtmlHeaderCanonicalDisagree(
      [
        {
          url: `${ORIGIN}/one`,
          body: htmlCanonical(`${ORIGIN}/one`),
          headers: new Headers({
            link: `<${ORIGIN}/other>; rel="canonical"`,
            'content-type': 'text/html',
          }),
          preferredForm: `${ORIGIN}/one`,
        },
      ],
      {
        headerScopeOverride: {
          kind: 'single-route',
          file: 'next.config.js',
          detail: 'source: /one',
        },
      },
    )
    expect(result.findings[0]?.verdict).toBe('auto-remove-header-single-route')
  })

  it('resolveHeaderCanonicalScope detects multi-route next.config', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 't16-scope-'))
    temps.push(root)
    fs.writeFileSync(
      path.join(root, 'next.config.js'),
      `
module.exports = {
  async headers() {
    return [{
      source: '/:path*',
      headers: [{ key: 'Link', value: '<https://example.com/>; rel="canonical"' }],
    }]
  }
}
`,
    )
    const scope = resolveHeaderCanonicalScope(root)
    expect(scope.kind).toBe('multi-route')
  })

  it('strip + verify leaves a single declaration', () => {
    const link = `<${ORIGIN}/other>; rel="canonical", </a.css>; rel="stylesheet"`
    const { value, removed } = stripLinkCanonicalFromHeaderValue(link)
    expect(removed).toBe(1)
    expect(value).toContain('stylesheet')
    expect(value).not.toMatch(/canonical/i)

    const headers = new Headers()
    if (value) headers.set('link', value)
    const v = verifyLiveSingleCanonicalDeclaration(
      htmlCanonical(`${ORIGIN}/one`),
      headers,
      `${ORIGIN}/one`,
      'text/html',
    )
    expect(v.ok).toBe(true)
  })
})
