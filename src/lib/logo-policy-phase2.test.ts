/**
 * Phase 2 — unified Organization/logo Quality Gate policy regressions.
 *
 * A–H from the Phase 2 master prompt. Does not alter Phase 1 Article.image
 * behavior; uses the shared resolveLogoPolicy everywhere.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { validateSchema } from './schema-validator'
import { runQualityGate } from './article-quality-gate'
import { fixAllArticleIssues } from './article-fix-all'
import {
  resolveLogoPolicy,
  expectOrganizationLogoFromPolicy,
  logoGateOptions,
} from './quality-gate-policy'

const LOGO_URL = 'https://cdn.example.com/logo.png'
const HERO = 'https://cdn.example.com/hero.webp'

function articleHtml(opts: {
  publisherLogo?: boolean
  organizationLogo?: boolean
  organizationUrl?: string
}): string {
  const pubLogo = opts.publisherLogo
    ? `,"logo":{"@type":"ImageObject","url":"${LOGO_URL}"}`
    : ''
  const orgLogo = opts.organizationLogo
    ? `,"logo":{"@type":"ImageObject","url":"${LOGO_URL}"}`
    : ''
  const orgUrl = opts.organizationUrl
    ? `,"url":"${opts.organizationUrl}"`
    : ''
  return `
<h1>Home EV charger guide</h1>
<p>By Kamran Gul. Installing a home EV charger needs a qualified electrician and a confirmed supply capacity for the chosen unit.</p>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"Home EV charger guide","author":{"@type":"Person","name":"Kamran Gul"},"datePublished":"2026-08-18","dateModified":"2026-08-18","inLanguage":"en-GB","image":["${HERO}"],"publisher":{"@type":"Organization","name":"Example Brand"${orgUrl}${pubLogo}}}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Example Brand"${orgUrl}${orgLogo}}
</script>
`
}

function logoIssuesFromValidate(html: string, expectOrganizationLogo: boolean) {
  return validateSchema(html, { expectOrganizationLogo }).issues.filter(
    i => /logo/i.test(i.property + i.message),
  )
}

function logoIssuesFromGate(issues: Array<{ category: string; title: string; description: string; id: string }>) {
  return issues.filter(
    i =>
      i.category === 'schema' &&
      (/logo/i.test(i.title + i.description) || /logo/i.test(i.id)),
  )
}

const GATE_BASE = {
  brand: 'Example Brand',
  keyword: 'home EV charger',
  authorName: 'Kamran Gul',
  registeredLinkDomains: ['example.com'],
  minWordCount: 20,
  maxWordCount: 500,
}

describe('Phase 2 logo policy A–H', () => {
  it('A. logo configured + required → missing logo produces warning', async () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: true, logoUrl: LOGO_URL },
    })
    expect(policy.mode).toBe('require')
    const html = articleHtml({ publisherLogo: false, organizationLogo: false })
    const validated = logoIssuesFromValidate(html, true)
    expect(validated.length).toBeGreaterThan(0)

    const qr = await runQualityGate(html, {
      ...GATE_BASE,
      ...logoGateOptions(policy),
    })
    expect(logoIssuesFromGate(qr.issues).length).toBeGreaterThan(0)
  })

  it('B. logo configured + present → zero logo warning', async () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: true, logoUrl: LOGO_URL },
    })
    const html = articleHtml({
      publisherLogo: true,
      organizationLogo: true,
      organizationUrl: 'https://example.com',
    })
    expect(logoIssuesFromValidate(html, true)).toHaveLength(0)

    const qr = await runQualityGate(html, {
      ...GATE_BASE,
      ...logoGateOptions(policy),
    })
    expect(logoIssuesFromGate(qr.issues)).toHaveLength(0)
  })

  it('C. logo omitted by policy → no Organization.logo requirement', async () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: true, logoUrl: null },
    })
    expect(expectOrganizationLogoFromPolicy(policy)).toBe(false)
    const html = articleHtml({ publisherLogo: false, organizationLogo: false })
    expect(logoIssuesFromValidate(html, false)).toHaveLength(0)

    const qr = await runQualityGate(html, {
      ...GATE_BASE,
      ...logoGateOptions(policy),
    })
    expect(logoIssuesFromGate(qr.issues)).toHaveLength(0)
  })

  it('D. logo omitted + domain exists → domain alone does not require logo', async () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: false, logoUrl: null },
    })
    expect(policy.mode).toBe('omit')
    const html = articleHtml({
      publisherLogo: false,
      organizationLogo: false,
      organizationUrl: 'https://example.com',
    })
    // Domain/URL present but policy omit — no logo warnings
    expect(logoIssuesFromValidate(html, false)).toHaveLength(0)
    const qr = await runQualityGate(html, {
      ...GATE_BASE,
      ...logoGateOptions(policy),
    })
    expect(logoIssuesFromGate(qr.issues)).toHaveLength(0)
  })

  it('E. generation → recheck: same policy and same logo result', async () => {
    const brandSettings = { configured: true, logoUrl: null as string | null }
    const genPolicy = resolveLogoPolicy({ brandSettings })
    const recheckPolicy = resolveLogoPolicy({ brandSettings })
    expect(genPolicy).toEqual(recheckPolicy)

    const html = articleHtml({
      publisherLogo: false,
      organizationLogo: false,
      organizationUrl: 'https://example.com',
    })
    const gen = await runQualityGate(html, {
      ...GATE_BASE,
      ...logoGateOptions(genPolicy),
    })
    const recheck = await runQualityGate(html, {
      ...GATE_BASE,
      ...logoGateOptions(recheckPolicy),
    })
    expect(logoIssuesFromGate(gen.issues)).toHaveLength(0)
    expect(logoIssuesFromGate(recheck.issues)).toHaveLength(0)
    expect(logoIssuesFromGate(gen.issues).length).toBe(
      logoIssuesFromGate(recheck.issues).length,
    )
  })

  it('F. generation → Fix All: same omit policy, no new logo warning', async () => {
    const html = articleHtml({
      publisherLogo: false,
      organizationLogo: false,
      organizationUrl: 'https://example.com',
    })
    const policy = resolveLogoPolicy({
      brandSettings: { configured: true, logoUrl: null },
    })
    const before = await runQualityGate(html, {
      ...GATE_BASE,
      ...logoGateOptions(policy),
    })
    const fix = await fixAllArticleIssues({
      html,
      keyword: GATE_BASE.keyword,
      brand: GATE_BASE.brand,
      registeredLinkDomains: GATE_BASE.registeredLinkDomains,
      targetWordCount: 80,
      expectOrganizationLogo: expectOrganizationLogoFromPolicy(policy),
    })
    expect(logoIssuesFromGate(before.issues)).toHaveLength(0)
    expect(logoIssuesFromGate(fix.qualityGateAfter.issues)).toHaveLength(0)
  })

  it('G. generation → improve Quality Gate: same omit policy', async () => {
    // article-improver defaults expectOrganizationLogo to false when unset —
    // matches omit policy when brand has no logo_url.
    const html = articleHtml({
      publisherLogo: false,
      organizationLogo: false,
      organizationUrl: 'https://example.com',
    })
    const policy = resolveLogoPolicy({
      brandSettings: { configured: false, logoUrl: null },
    })
    const gen = await runQualityGate(html, {
      ...GATE_BASE,
      ...logoGateOptions(policy),
    })
    const improveGate = await runQualityGate(html, {
      ...GATE_BASE,
      expectOrganizationLogo: false, // improveArticle default
    })
    expect(logoIssuesFromGate(gen.issues)).toHaveLength(0)
    expect(logoIssuesFromGate(improveGate.issues)).toHaveLength(0)
  })

  it('H. every production runQualityGate caller uses shared logo policy (or documents omit)', () => {
    const roots = [join(process.cwd(), 'src'), join(process.cwd(), 'scripts')]
    const files: string[] = []
    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        const st = statSync(p)
        if (st.isDirectory()) {
          if (name === 'node_modules' || name === '.next') continue
          walk(p)
        } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) {
          files.push(p)
        }
      }
    }
    for (const r of roots) walk(r)

    const callerFiles = files.filter(file => {
      const text = readFileSync(file, 'utf8')
      return /runQualityGate\s*\(/.test(text)
    })

    expect(callerFiles.length).toBeGreaterThan(0)

    const productionFiles = callerFiles.filter(file => {
      const rel = file.replace(process.cwd() + '/', '')
      return (
        rel.startsWith('src/app/') ||
        rel === 'src/lib/article-fix-all.ts' ||
        rel === 'src/lib/article-improver.ts'
      )
    })

    for (const file of productionFiles) {
      const rel = file.replace(process.cwd() + '/', '')
      const text = readFileSync(file, 'utf8')
      const ok =
        /expectOrganizationLogo/.test(text) &&
        (/resolveLogoPolicy|expectOrganizationLogoFromPolicy|logoGateOptions|expectOrganizationLogo\s*[:=]/.test(text))
      expect(
        ok,
        `${rel} must wire shared LogoPolicy (resolveLogoPolicy / expectOrganizationLogo)`,
      ).toBe(true)
    }

    // Scripts must document explicit omit/require (never rely on silent default alone)
    const scriptFiles = callerFiles.filter(f => f.includes('/scripts/'))
    for (const file of scriptFiles) {
      const text = readFileSync(file, 'utf8')
      expect(
        /expectOrganizationLogo\s*:/.test(text),
        `${file} script runQualityGate must set expectOrganizationLogo explicitly`,
      ).toBe(true)
    }
  })

  it('exact HTML: publisher.logo present, Organization.logo absent — require policy still flags Organization', () => {
    const html = articleHtml({
      publisherLogo: true,
      organizationLogo: false,
      organizationUrl: 'https://example.com',
    })
    const issues = logoIssuesFromValidate(html, true)
    expect(issues.some(i => i.property === 'logo' || i.schemaType === 'Organization')).toBe(true)
  })

  it('exact HTML: both logos absent under omit → clean; under require → warnings', () => {
    const html = articleHtml({ publisherLogo: false, organizationLogo: false })
    expect(logoIssuesFromValidate(html, false)).toHaveLength(0)
    expect(logoIssuesFromValidate(html, true).length).toBeGreaterThan(0)
  })

  it('forceRequire audit mode requires logo even without brand logo_url', () => {
    const policy = resolveLogoPolicy({
      brandSettings: { configured: false, logoUrl: null },
      forceRequire: true,
    })
    expect(policy.mode).toBe('require')
    expect(expectOrganizationLogoFromPolicy(policy)).toBe(true)
  })

  it('validateSchema default (no options) is omit — no silent require', () => {
    const html = articleHtml({
      publisherLogo: false,
      organizationLogo: false,
      organizationUrl: 'https://example.com',
    })
    const result = validateSchema(html)
    expect(logoIssuesFromValidate(html, false)).toHaveLength(0)
    expect(result.issues.filter(i => /logo/i.test(i.property + i.message))).toHaveLength(0)
  })
})
