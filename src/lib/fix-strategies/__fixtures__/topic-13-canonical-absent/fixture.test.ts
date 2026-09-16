import { describe, expect, it, vi } from 'vitest'
import {
  detectCanonicalAbsent,
  addHeadCanonical,
  removeBodyCanonicals,
  verifyLiveCanonicalPresent,
} from '@/lib/fix-strategies/topic-13'

const ORIGIN = 'https://example.com'

function pageHtml(opts: {
  headCanonical?: string
  bodyCanonical?: string
  noindex?: boolean
}): string {
  const headBits = [
    opts.noindex ? '<meta name="robots" content="noindex">' : '',
    opts.headCanonical
      ? `<link rel="canonical" href="${opts.headCanonical}">`
      : '',
  ].join('')
  const bodyBits = opts.bodyCanonical
    ? `<link rel="canonical" href="${opts.bodyCanonical}">`
    : ''
  return `<!doctype html><html><head><title>t</title>${headBits}</head><body>${bodyBits}<p>hi</p></body></html>`
}

describe('topic 13 — canonical tag absent', () => {
  it('classifies the dossier fixture set', () => {
    const pages = [
      // 1. duplicates + no canonical → finding / auto
      {
        url: `${ORIGIN}/dup`,
        body: pageHtml({}),
        duplicatesProven: true,
        preferredForm: `${ORIGIN}/dup`,
        artefactPath: 'app/dup/page.tsx',
      },
      // 2. no duplicates + no canonical → informational
      {
        url: `${ORIGIN}/unique`,
        body: pageHtml({}),
        duplicatesProven: false,
        artefactPath: 'app/unique/page.tsx',
      },
      // 3. body only → body-misplaced finding
      {
        url: `${ORIGIN}/body-only`,
        body: pageHtml({ bodyCanonical: `${ORIGIN}/body-only` }),
        duplicatesProven: true,
        preferredForm: `${ORIGIN}/body-only`,
        artefactPath: 'app/body-only/page.tsx',
      },
      // 4. header canonical → not raised
      {
        url: `${ORIGIN}/header`,
        body: pageHtml({}),
        headers: new Headers({
          link: `<${ORIGIN}/header>; rel="canonical"`,
          'content-type': 'text/html',
        }),
        duplicatesProven: true,
        preferredForm: `${ORIGIN}/header`,
        artefactPath: 'app/header/page.tsx',
      },
      // 5. conditional generateMetadata → indeterminate
      {
        url: `${ORIGIN}/draft`,
        body: pageHtml({}),
        duplicatesProven: true,
        preferredForm: `${ORIGIN}/draft`,
        artefactPath: 'app/draft/page.tsx',
      },
    ]

    const result = detectCanonicalAbsent(pages, {
      repoSiteByUrl: {
        [`${ORIGIN}/dup`]: { kind: 'page', files: ['app/dup/page.tsx'] },
        [`${ORIGIN}/unique`]: { kind: 'none', files: [] },
        [`${ORIGIN}/body-only`]: { kind: 'page', files: ['app/body-only/page.tsx'] },
        [`${ORIGIN}/header`]: { kind: 'page', files: ['app/header/page.tsx'] },
        [`${ORIGIN}/draft`]: {
          kind: 'generateMetadata-indeterminate',
          files: ['app/draft/page.tsx'],
        },
      },
    })

    expect(result.findings.map((f) => f.pageUrl)).toContain(`${ORIGIN}/dup`)
    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/dup`)?.verdict,
    ).toBe('auto-add-self-canonical')

    expect(result.informational.map((i) => i.pageUrl)).toContain(
      `${ORIGIN}/unique`,
    )

    const bodyFinding = result.findings.find(
      (f) => f.pageUrl === `${ORIGIN}/body-only`,
    )
    expect(bodyFinding?.kind).toBe('canonical/body-misplaced')
    expect(bodyFinding?.verdict).toBe('finding-body-misplaced')

    expect(
      result.suppressed.some(
        (s) =>
          s.pageUrl === `${ORIGIN}/header` &&
          s.verdict === 'suppress-header-present',
      ),
    ).toBe(true)

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/draft`)?.verdict,
    ).toBe('indeterminate-generateMetadata')
  })

  it('never raises absence without duplicate proof (site-wide rejected)', () => {
    const result = detectCanonicalAbsent(
      [
        {
          url: `${ORIGIN}/a`,
          body: pageHtml({}),
          duplicatesProven: false,
        },
        {
          url: `${ORIGIN}/b`,
          body: pageHtml({}),
          duplicatesProven: false,
        },
      ],
      {
        repoSiteByUrl: {
          [`${ORIGIN}/a`]: { kind: 'none' },
          [`${ORIGIN}/b`]: { kind: 'none' },
        },
      },
    )
    expect(result.findings).toHaveLength(0)
    expect(result.informational).toHaveLength(2)
  })

  it('never proposes layout-level fix', () => {
    const result = detectCanonicalAbsent(
      [
        {
          url: `${ORIGIN}/x`,
          body: pageHtml({}),
          duplicatesProven: true,
          preferredForm: `${ORIGIN}/x`,
        },
      ],
      {
        repoSiteByUrl: {
          [`${ORIGIN}/x`]: {
            kind: 'layout',
            files: ['app/layout.tsx'],
          },
        },
      },
    )
    expect(result.findings[0]?.verdict).toBe('human-review-layout-cascade')
  })

  it('fixer + verifier: add head canonical then live postcondition passes', async () => {
    const before = pageHtml({})
    const { html, added } = addHeadCanonical(before, `${ORIGIN}/dup`)
    expect(added).toBe(true)

    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    const v = await verifyLiveCanonicalPresent(
      html,
      new Headers(),
      `${ORIGIN}/dup`,
      'text/html',
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(v.ok).toBe(true)
  })

  it('removeBodyCanonicals strips body-only misplaced tags', () => {
    const html = pageHtml({ bodyCanonical: `${ORIGIN}/body-only` })
    const { html: next, removed } = removeBodyCanonicals(html)
    expect(removed).toBe(1)
    expect(next).not.toMatch(/rel="canonical"/)
  })
})
