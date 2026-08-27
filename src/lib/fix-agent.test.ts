/**
 * Fix Agent classification + HTML mutations — unit tests (no live CMS).
 */

import { describe, expect, it } from 'vitest'
import { classifyAuditIssue, classifyAuditIssues } from './fix-agent-classification'
import {
  buildBreadcrumbSchema,
  buildLlmsTxt,
  buildOrganizationSchema,
  deriveDescriptionFromHtml,
  injectSchemaIntoHtml,
  mutateHtmlStructure,
  mutateImageAlt,
  mutateLangAttribute,
  mutateMetaDescription,
  mutateMetaTitle,
  mutateMissingH1,
} from './fix-agent-html-mutations'
import type { PageAuditIssue } from './page-audit-engine'
import { encryptCredentialsJson, decryptCredentialsJson, loadConnectionCredentials } from './site-connection-crypto'

function issue(partial: Partial<PageAuditIssue> & Pick<PageAuditIssue, 'id' | 'title'>): PageAuditIssue {
  return {
    severity: 'warning',
    category: 'onpage',
    description: partial.title,
    ...partial,
  }
}

describe('fix-agent-classification', () => {
  it('never auto-fixes thin content', () => {
    const c = classifyAuditIssue(
      issue({
        id: 'ecom-description-thin',
        title: 'Thin product description',
        category: 'content',
      }),
    )
    expect(c.fixability).toBe('human')
    expect(c.humanKind).toBe('thin-content')
  })

  it('never auto-fixes internal linking', () => {
    const c = classifyAuditIssue(
      issue({
        id: 'ecom-related-links-missing',
        title: 'Related-product linking is weak',
        category: 'links',
      }),
    )
    expect(c.fixability).toBe('human')
    expect(c.humanKind).toBe('internal-linking')
  })

  it('never auto-fixes factual availability claims', () => {
    const c = classifyAuditIssue(
      issue({
        id: 'ecom-availability-mismatch',
        title: 'Availability mismatch vs schema',
        category: 'schema',
      }),
    )
    expect(c.fixability).toBe('human')
    expect(c.humanKind).toBe('factual-claim')
  })

  it('marks meta description as auto-fixable', () => {
    const c = classifyAuditIssue(
      issue({
        id: 'audit-meta_description',
        title: 'Meta description too short',
        category: 'onpage',
      }),
    )
    expect(c.fixability).toBe('auto')
    expect(c.autoKind).toBe('meta-description')
  })

  it('marks missing H1 and schema as auto-fixable', () => {
    const h1 = classifyAuditIssue(
      issue({ id: 'ecom-category-missing-h1', title: 'Category page missing H1', category: 'onpage' }),
    )
    expect(h1.autoKind).toBe('missing-h1')
    const sch = classifyAuditIssue(
      issue({ id: 'ecom-product-schema-missing', title: 'Product schema missing', category: 'schema' }),
    )
    expect(sch.autoKind).toBe('schema-product')
  })

  it('splits a mixed list into auto vs human', () => {
    const list = classifyAuditIssues([
      issue({ id: 'audit-meta_title', title: 'Title tag too long', category: 'onpage' }),
      issue({ id: 'ecom-description-thin', title: 'Thin content', category: 'content' }),
      issue({ id: 'x', title: 'No Organization schema', category: 'schema' }),
    ])
    expect(list.filter((x) => x.fixability === 'auto')).toHaveLength(2)
    expect(list.filter((x) => x.fixability === 'human')).toHaveLength(1)
  })
})

describe('fix-agent-html-mutations', () => {
  it('updates meta title and description from existing text', () => {
    const html = '<!DOCTYPE html><html><head><title>Old</title></head><body><p>Hello</p></body></html>'
    const t = mutateMetaTitle(html, 'Better title for the page about widgets')
    expect(t.changed).toBe(true)
    expect(t.html).toContain('<title>Better title for the page about widgets</title>')

    const body =
      '<p>' +
      'Word count filler text that is long enough to derive a real meta description without inventing facts. '.repeat(3) +
      '</p>'
    const d = mutateMetaDescription(html.replace('<p>Hello</p>', body), deriveDescriptionFromHtml(body, 'Widgets'))
    expect(d.changed).toBe(true)
    expect(d.html).toMatch(/meta name="description"/i)
  })

  it('inserts H1 from title when missing', () => {
    const html = '<div><p>Intro</p></div>'
    const r = mutateMissingH1(html, 'Existing Page Title')
    expect(r.changed).toBe(true)
    expect(r.html).toContain('<h1')
    expect(r.html).toContain('Existing Page Title')
  })

  it('sets lang on html and fills alt from filename', () => {
    const html = '<html><body><img src="/images/red-charger-cable.jpg"></body></html>'
    const lang = mutateLangAttribute(html, 'en-GB')
    expect(lang.html).toContain('lang="en-GB"')
    const alt = mutateImageAlt(lang.html)
    expect(alt.changed).toBe(true)
    expect(alt.needsHumanReview).toBe(true)
    expect(alt.html).toMatch(/alt="red charger cable"/i)
  })

  it('injects schema and builds breadcrumb from URL', () => {
    const org = buildOrganizationSchema({ name: 'Acme', url: 'https://acme.example' })
    const html = '<html><body><p>x</p></body></html>'
    const inj = injectSchemaIntoHtml(html, org)
    expect(inj.html).toContain('"Organization"')
    const bc = buildBreadcrumbSchema('https://acme.example/blog/post-one/')
    expect(bc?.['@type']).toBe('BreadcrumbList')
    expect((bc?.itemListElement as unknown[]).length).toBe(3)
  })

  it('strips stray wrappers on fragments only', () => {
    const frag = '<html><body><p>Hi</p></body></html>'
    const r = mutateHtmlStructure(frag)
    expect(r.changed).toBe(true)
    expect(r.html).not.toMatch(/<\/?html/i)
  })

  it('builds llms.txt from brand identity', () => {
    const txt = buildLlmsTxt({ brand: 'Acme', siteUrl: 'https://acme.example', title: 'Home' })
    expect(txt).toContain('# Acme')
    expect(txt).toContain('https://acme.example')
  })
})

describe('site-connection-crypto', () => {
  it('round-trips credentials', () => {
    process.env.SITE_CONNECTION_ENCRYPTION_KEY = 'test-key-for-fix-agent-unit-tests-32b'
    const blob = encryptCredentialsJson({ owner: 'o', repo: 'r', accessToken: 'tok' })
    expect(blob.startsWith('enc:v1:')).toBe(true)
    const out = decryptCredentialsJson(blob)
    expect(out.accessToken).toBe('tok')
    const loaded = loadConnectionCredentials({ credentials_ciphertext: blob })
    expect(loaded.repo).toBe('r')
  })

  it('reads legacy plaintext JSONB and __ciphertext wrapper', () => {
    process.env.SITE_CONNECTION_ENCRYPTION_KEY = 'test-key-for-fix-agent-unit-tests-32b'
    const legacy = loadConnectionCredentials({ credentials: { username: 'u', appPassword: 'p' } })
    expect(legacy.username).toBe('u')
    const enc = encryptCredentialsJson({ accessToken: 'x' })
    const wrapped = loadConnectionCredentials({ credentials: { __ciphertext: enc } })
    expect(wrapped.accessToken).toBe('x')
  })
})
