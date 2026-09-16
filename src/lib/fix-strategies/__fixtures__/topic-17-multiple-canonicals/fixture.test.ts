import { describe, expect, it } from 'vitest'
import {
  detectMultipleCanonicals,
  collapseToSingleHeadCanonical,
  removeBodyCanonicalLinks,
  verifyLiveSingleHeadCanonical,
} from '@/lib/fix-strategies/topic-17'

const ORIGIN = 'https://example.com'

describe('topic 17 — multiple canonical declarations', () => {
  it('classifies the dossier fixture set', () => {
    const result = detectMultipleCanonicals([
      // 1. two different targets → human-review conflicting
      {
        url: `${ORIGIN}/conflict`,
        body: `<!doctype html><html><head>
          <link rel="canonical" href="${ORIGIN}/a">
          <link rel="canonical" href="${ORIGIN}/b">
        </head><body></body></html>`,
      },
      // 2. two same target → auto-collapse redundant
      {
        url: `${ORIGIN}/redundant`,
        body: `<!doctype html><html><head>
          <link rel="canonical" href="${ORIGIN}/redundant">
          <link rel="canonical" href="${ORIGIN}/redundant">
        </head><body></body></html>`,
      },
      // 3. head + body → auto-remove body
      {
        url: `${ORIGIN}/misplaced`,
        body: `<!doctype html><html><head>
          <link rel="canonical" href="${ORIGIN}/misplaced">
        </head><body>
          <link rel="canonical" href="${ORIGIN}/misplaced">
        </body></html>`,
      },
      // 4. page + layout sites → both reported
      {
        url: `${ORIGIN}/cascade`,
        body: `<!doctype html><html><head>
          <link rel="canonical" href="${ORIGIN}/cascade">
          <link rel="canonical" href="${ORIGIN}/cascade">
        </head><body></body></html>`,
        repoSites: ['app/cascade/page.tsx', 'app/layout.tsx'],
      },
      // 5. one correct → suppressed
      {
        url: `${ORIGIN}/ok`,
        body: `<!doctype html><html><head>
          <link rel="canonical" href="${ORIGIN}/ok">
        </head><body></body></html>`,
      },
    ])

    const conflict = result.findings.find(
      (f) => f.pageUrl === `${ORIGIN}/conflict`,
    )
    expect(conflict?.verdict).toBe('human-review-conflicting')
    expect(conflict?.collapseTo).toBeNull()
    expect(conflict?.distinctTargets).toHaveLength(2)
    expect(conflict?.scopedOutcomeNote).toMatch(/likely/i)
    expect(conflict?.scopedOutcomeNote).toMatch(/not ["']?always/i)
    expect(conflict?.scopedOutcomeNote).not.toMatch(/always ignores/i)

    const redundant = result.findings.find(
      (f) => f.pageUrl === `${ORIGIN}/redundant`,
    )
    expect(redundant?.verdict).toBe('auto-collapse-redundant')
    expect(redundant?.collapseTo).toBe(`${ORIGIN}/redundant`)

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/misplaced`)
        ?.verdict,
    ).toBe('auto-remove-body-misplaced')

    const cascade = result.findings.find(
      (f) => f.pageUrl === `${ORIGIN}/cascade`,
    )
    expect(cascade?.verdict).toBe('human-review-multi-site')
    expect(cascade?.repoSites).toEqual([
      'app/cascade/page.tsx',
      'app/layout.tsx',
    ])

    expect(result.ok.map((o) => o.pageUrl)).toContain(`${ORIGIN}/ok`)
  })

  it('never keeps the first by document order for conflicting targets', () => {
    const result = detectMultipleCanonicals([
      {
        url: `${ORIGIN}/x`,
        body: `<!doctype html><html><head>
          <link rel="canonical" href="${ORIGIN}/first">
          <link rel="canonical" href="${ORIGIN}/second">
        </head><body></body></html>`,
      },
    ])
    expect(result.findings[0]?.verdict).toBe('human-review-conflicting')
    expect(result.findings[0]?.collapseTo).toBeNull()
  })

  it('routes one HTML + header to topic 16', () => {
    const result = detectMultipleCanonicals([
      {
        url: `${ORIGIN}/h`,
        body: `<!doctype html><html><head>
          <link rel="canonical" href="${ORIGIN}/h">
        </head><body></body></html>`,
        headers: new Headers({
          link: `<${ORIGIN}/other>; rel="canonical"`,
        }),
      },
    ])
    expect(result.routed[0]?.verdict).toBe('route-topic-16')
  })

  it('fixer + verifier collapse redundant to one head canonical', () => {
    const before = `<!doctype html><html><head>
      <link rel="canonical" href="${ORIGIN}/redundant">
      <link rel="canonical" href="${ORIGIN}/redundant">
    </head><body></body></html>`
    const { html, removed } = collapseToSingleHeadCanonical(
      before,
      `${ORIGIN}/redundant`,
    )
    expect(removed).toBe(2)
    const v = verifyLiveSingleHeadCanonical(
      html,
      new Headers(),
      `${ORIGIN}/redundant`,
      'text/html',
    )
    expect(v.ok).toBe(true)
  })

  it('removeBodyCanonicalLinks leaves head intact', () => {
    const before = `<!doctype html><html><head>
      <link rel="canonical" href="${ORIGIN}/misplaced">
    </head><body>
      <link rel="canonical" href="${ORIGIN}/other">
    </body></html>`
    const { html, removed } = removeBodyCanonicalLinks(before)
    expect(removed).toBe(1)
    const v = verifyLiveSingleHeadCanonical(
      html,
      new Headers(),
      `${ORIGIN}/misplaced`,
      'text/html',
    )
    expect(v.ok).toBe(true)
  })
})
